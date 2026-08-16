/**
 * Oracle session tool — roundtable-style owned-session reviews.
 *
 * The orchestrator calls `oracle_session({ prompt })` instead of
 * `task(subagent_type=oracle)` when it needs the oracle to REMEMBER its
 * previous verdicts within the current task. The plugin owns the oracle
 * session directly via the SDK (create once, prompt repeatedly, delete on
 * reset) — the same pattern as roundtable's persistent debater sessions.
 * This works in EVERY environment (server + CLI) because it never relies
 * on the task tool's task_id resume semantics or on tool.execute hooks.
 *
 * Lifecycle (self-contained — no external hooks required):
 * - The tool detects the work unit itself: it reads the invoking session's
 *   message list and remembers the LAST USER MESSAGE id it saw. When that id
 *   changes, the user has sent a new query → the old oracle session is
 *   deleted and a fresh one is created. This works on every device even
 *   where opencode's messages.transform hook never fires (openchamber
 *   server) — the tool is the one that always runs.
 * - The new-query check runs FIRST, before any session_id handling: an
 *   explicit session_id from a PREVIOUS query is rejected (stale sessions
 *   would leak state across queries or 404 if already deleted). Only a
 *   session_id matching the CURRENT unit's tracked session is honored.
 * - Calls WITH session_id (returned by the tool) within the same query:
 *   resume that exact session (explicit continuation handle).
 * - Concurrency: all state resolution for one parent session is serialized
 *   with a per-parent mutex — concurrent calls in one turn can never create
 *   two sessions or prompt the same session in parallel (history corruption).
 * - Safety rails: max prompts per unit, estimated token cap, plus a TTL
 *   sweep that deletes tracked sessions of abandoned parent sessions.
 *
 * Verified API semantics (opencode 1.18.15, MessageV2.page):
 *   GET /session/{id}/message?limit=N returns the NEWEST N messages in
 *   ascending (chronological) order (DB desc + items.reverse()). Scanning
 *   the tail of that page finds the most recent user message correctly.
 */

import type { ToolContext } from '@opencode-ai/plugin';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Persisted registry of oracle sessions. Without this, the in-memory
 * sessionsByParent map dies with the server process: after a restart the old
 * oracle session becomes an untracked orphan (never deleted) and the next
 * call creates a fresh one — the exact leak observed in the field (96 leaked
 * sessions). Persisting lets cleanup survive restarts: the next tool call
 * for a parent loads the previous entry, detects the new query, and deletes
 * the orphan before creating the replacement.
 */
const REGISTRY_DIR = 'oh-my-opencode-serverlocal';
const REGISTRY_FILE = 'oracle-sessions.json';

interface PersistedOracleSession {
  /** id of the oracle session this parent was using. */
  sessionId: string;
  /** id of the last USER message in the parent at creation/resume time. */
  lastUserMsgId: string | null;
  /** last time this parent used the oracle (epoch ms). */
  lastUsedAt: number;
}

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  );
}

export function getOracleSessionsPath(): string {
  return path.join(dataDir(), 'opencode', 'storage', REGISTRY_DIR, REGISTRY_FILE);
}

function resolveRegistryPath(override?: string): string {
  return override ?? getOracleSessionsPath();
}

function loadPersistedRegistry(pathOverride?: string): Map<string, PersistedOracleSession> {
  const map = new Map<string, PersistedOracleSession>();
  try {
    const raw = fs.readFileSync(resolveRegistryPath(pathOverride), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, PersistedOracleSession>;
    for (const [parentID, entry] of Object.entries(parsed)) {
      if (
        typeof parentID === 'string' &&
        entry &&
        typeof entry.sessionId === 'string'
      ) {
        map.set(parentID, entry);
      }
    }
  } catch {
    /* missing/corrupt file — start empty */
  }
  return map;
}

function savePersistedRegistry(
  map: Map<string, PersistedOracleSession>,
  pathOverride?: string,
): void {
  try {
    const p = resolveRegistryPath(pathOverride);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(Object.fromEntries(map), null, 2));
  } catch {
    /* best-effort persistence */
  }
}


export interface OracleSessionToolOptions {
  client: OpencodeClient;
  /** Max prompts in one session chain before a fresh session is forced. */
  maxPromptsPerUnit?: number;
  /** Estimated token cap for one session chain. */
  estTokenCap?: number;
  /** How many trailing parent-session messages to scan for the last user message. */
  scanLimit?: number;
  /** Idle time after which a tracked parent session is swept (ms). */
  ttlMs?: number;
  /** Override the persisted-registry file path (tests). */
  registryPath?: string;
}

interface OracleSessionState {
  sessionId: string;
  prompts: number;
  estTokens: number;
  /** id of the last USER message in the parent session when this unit began. */
  lastUserMsgId: string | null;
  lastUsedAt: number;
}

/** Module-level registry of every oracle-session id across all tool instances. */
const oracleSessionRegistries = new Set<Set<string>>();

/** Register the per-instance set of created oracle session ids. */
export function registerOracleSessionIds(ids: Set<string>): void {
  oracleSessionRegistries.add(ids);
}

/**
 * True when the given session is one of the oracle sessions this plugin
 * created. Used by the recursion guards (oracle_session tool + task tool).
 */
export function isOracleSession(sessionID: string | undefined): boolean {
  if (sessionID === undefined) return false;
  for (const ids of oracleSessionRegistries) {
    if (ids.has(sessionID)) return true;
  }
  return false;
}

/**
 * Find the id of the last user message in the parent session. Returns null
 * when the parent session has no user messages or the lookup fails (in which
 * case callers degrade to reuse, never to a spurious reset).
 */
async function getLastUserMessageId(
  client: OpencodeClient,
  parentID: string,
  limit: number,
): Promise<string | null> {
  try {
    const res = await client.session.messages({
      path: { id: parentID },
      query: { limit },
    });
    if (res.error || !res.data) return null;
    const messages = res.data as Array<{
      info?: { id?: string; role?: string };
    }>;
    // Newest-first in the DB, reversed to ascending by the server; the tail
    // of the page is the most recent message. Scan backwards for the last
    // USER message (tool-call/result messages are role=assistant).
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i]?.info;
      if (info && info.role === 'user' && typeof info.id === 'string') {
        return info.id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function createOracleSessionTool(options: OracleSessionToolOptions) {
  const maxPrompts = options.maxPromptsPerUnit ?? 10;
  const tokenCap = options.estTokenCap ?? 50_000;
  const scanLimit = options.scanLimit ?? 100;
  const ttlMs = options.ttlMs ?? 30 * 60_000;
  /** parentSessionID → active oracle session state (in-memory, current process). */
  const sessionsByParent = new Map<string, OracleSessionState>();
  /**
   * parentSessionID → persisted state (survives restarts). Loaded once at
   * tool creation so a restarted server can still find and delete the
   * oracle session its predecessor created for this parent.
   */
  const persistedByParent = loadPersistedRegistry(options.registryPath);
  /** parentSessionID → mutex chain serializing state resolution per parent */
  const locks = new Map<string, Promise<void>>();
  /** ids of every oracle session this tool has created — the recursion guard */
  const oracleSessionIds = new Set<string>();
  registerOracleSessionIds(oracleSessionIds);

  /** Persist the registry after any mutation. */
  function persist(): void {
    const merged = new Map(persistedByParent);
    for (const [pid, st] of sessionsByParent) {
      merged.set(pid, {
        sessionId: st.sessionId,
        lastUserMsgId: st.lastUserMsgId,
        lastUsedAt: st.lastUsedAt,
      });
    }
    savePersistedRegistry(merged, options.registryPath);
  }

  async function deleteSessionById(sessionId: string): Promise<void> {
    try {
      await options.client.session
        .delete({ path: { id: sessionId } })
        .catch(() => {});
    } catch {
      /* best-effort cleanup */
    }
  }

  async function cleanupSession(parentSessionID: string): Promise<void> {
    const st = sessionsByParent.get(parentSessionID);
    const persisted = persistedByParent.get(parentSessionID);
    sessionsByParent.delete(parentSessionID);
    persistedByParent.delete(parentSessionID);
    if (st) oracleSessionIds.delete(st.sessionId);
    if (st?.sessionId) await deleteSessionById(st.sessionId);
    if (persisted && persisted.sessionId !== st?.sessionId) {
      // Cross-restart cleanup: the persisted session belongs to a previous
      // server process — delete the orphan too.
      await deleteSessionById(persisted.sessionId);
    }
    persist();
  }

  /** Delete tracked sessions of parent sessions idle longer than the TTL. */
  function sweepStale(): void {
    const now = Date.now();
    for (const [pid, st] of sessionsByParent) {
      if (now - st.lastUsedAt > ttlMs) {
        sessionsByParent.delete(pid);
        persistedByParent.delete(pid);
        void deleteSessionById(st.sessionId);
      }
    }
    // Also sweep persisted entries of parents that never called back.
    for (const [pid, entry] of persistedByParent) {
      if (now - entry.lastUsedAt > ttlMs) {
        persistedByParent.delete(pid);
        void deleteSessionById(entry.sessionId);
      }
    }
    persist();
  }

  /** Serialize per-parent state resolution + prompts (no concurrent creates
   *  or parallel prompts on the same oracle session). */
  async function withParentLock<T>(
    parentID: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = locks.get(parentID) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    locks.set(
      parentID,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 1.3);
  }

  return {
    /** Delete the tracked oracle session for a parent (used on /fresh, session deletion). */
    resetForSession: cleanupSession,

    tool: {
      description:
        'Run a single review/consultation with the oracle agent in a PERSISTENT session. ' +
        'The oracle remembers everything you asked it in this session — its previous ' +
        'verdicts, what it already reviewed, what it approved. Use this INSTEAD of ' +
        'task(subagent_type=oracle) when you will consult the oracle multiple times ' +
        'for the current task. Returns { response, session_id, prompts }.',
      args: {
        prompt: z
          .string()
          .describe(
            'The question or review request for the oracle. Include the files, code, or context it needs to evaluate.',
          ),
        session_id: z
          .string()
          .optional()
          .describe(
            'Optional. Pass the session_id returned by a previous oracle_session call to ' +
              'continue that same conversation. Only honored within the current user query — ' +
              'the session resets automatically on your next message. Omit to auto-resume ' +
              'the active oracle session for this query, or to start a fresh one.',
          ),
      },
      async execute(
        args: Record<string, unknown>,
        context: ToolContext,
      ): Promise<string> {
        const parentID = context.sessionID;
        // Recursion guard: an oracle session must never spawn another oracle.
        if (parentID !== undefined && oracleSessionIds.has(parentID)) {
          return (
            'BLOCKED: an oracle session cannot call oracle_session again ' +
            '(recursion guard). You are the oracle — review and advise; the ' +
            'orchestrator handles further oracle consultations. Continue your ' +
            'current review instead.'
          );
        }
        const promptText = typeof args.prompt === 'string' ? args.prompt : '';
        const explicitSessionId =
          typeof args.session_id === 'string' && args.session_id.trim() !== ''
            ? args.session_id
            : undefined;

        return withParentLock(parentID, async () => {
          sweepStale();

          // ── Work-unit detection: what is the user's current query? ──────
          // If we cannot read the parent's messages, currentUserMsgId is null
          // and we degrade to reuse (never a spurious reset).
          const currentUserMsgId = await getLastUserMessageId(
            options.client,
            parentID,
            scanLimit,
          );

          let st = sessionsByParent.get(parentID);

          // ── CROSS-RESTART HYDRATION ────────────────────────────────────
          // This server process has no in-memory state for this parent, but
          // a previous process may have created an oracle session for it.
          // Load it so the new-query check can delete the orphan instead of
          // letting it leak.
          if (st === undefined) {
            const persisted = persistedByParent.get(parentID);
            if (persisted) {
              st = {
                sessionId: persisted.sessionId,
                prompts: 0,
                estTokens: 0,
                lastUserMsgId: persisted.lastUserMsgId,
                lastUsedAt: persisted.lastUsedAt,
              };
              // Remember it in-process too (recursion guard + tracking).
              oracleSessionIds.add(persisted.sessionId);
              sessionsByParent.set(parentID, st);
            }
          }

          // ── NEW QUERY DETECTION runs FIRST (even for explicit ids) ──────
          // The user sent a new message since this unit began → the old
          // oracle session belongs to the previous query: delete it and
          // start fresh. Without this, sessions leak across queries until
          // the safety rails fire or the process restarted.
          if (
            currentUserMsgId !== null &&
            st !== undefined &&
            st.lastUserMsgId !== currentUserMsgId
          ) {
            await cleanupSession(parentID);
            st = undefined;
          }

          if (explicitSessionId !== undefined) {
            // Honored ONLY when it matches the current unit's tracked session.
            // A stale/foreign id (previous query, or already deleted) is
            // rejected — adopting it would leak state or 404 on prompt.
            if (st !== undefined && st.sessionId === explicitSessionId) {
              st.lastUserMsgId = currentUserMsgId;
            } else {
              await cleanupSession(parentID);
              st = undefined;
            }
          } else if (st !== undefined) {
            // Auto-continuation within a unit — enforce safety rails.
            if (st.prompts >= maxPrompts || st.estTokens >= tokenCap) {
              await cleanupSession(parentID);
              st = undefined;
            }
          }

          if (st === undefined) {
            // Fresh unit: drop any stale tracked session, then create.
            await cleanupSession(parentID);
            const created = await options.client.session.create({
              query: { directory: context.directory },
            });
            if (created.error) {
              return `Oracle session error: ${JSON.stringify(created.error)}`;
            }
            st = {
              sessionId: created.data.id,
              prompts: 0,
              estTokens: 0,
              lastUserMsgId: currentUserMsgId,
              lastUsedAt: Date.now(),
            };
            sessionsByParent.set(parentID, st);
            oracleSessionIds.add(created.data.id);
            persistedByParent.set(parentID, {
              sessionId: created.data.id,
              lastUserMsgId: currentUserMsgId,
              lastUsedAt: Date.now(),
            });
            persist();
            // Auto-title the oracle session so it is identifiable in the
            // session list (parent session short id keeps queries distinct).
            try {
              const short = (parentID ?? '').replace(/^ses_/, '').slice(0, 6);
              await options.client.session
                .update({
                  path: { id: created.data.id },
                  body: { title: `Oracle${short ? ` (${short})` : ''}` },
                })
                .catch(() => {});
            } catch {
              /* best-effort titling */
            }
          }

          st.lastUsedAt = Date.now();
          persistedByParent.set(parentID, {
            sessionId: st.sessionId,
            lastUserMsgId: st.lastUserMsgId,
            lastUsedAt: st.lastUsedAt,
          });
          persist();

          const resp = await options.client.session.prompt({
            path: { id: st.sessionId },
            body: {
              agent: 'oracle',
              parts: [{ type: 'text', text: promptText }],
            },
          });

          st.prompts += 1;
          st.estTokens += estimateTokens(promptText);

          if (resp.error) {
            return `Oracle error: ${JSON.stringify(resp.error)}`;
          }
          if (resp.data.info.error) {
            return `Oracle error: ${resp.data.info.error.name}`;
          }

          const text = (
            resp.data.parts as Array<{ type: string; text?: string }>
          )
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('');

          return JSON.stringify({
            response: text,
            session_id: st.sessionId,
            prompts: st.prompts,
          });
        });
      },
    },
  };
}
