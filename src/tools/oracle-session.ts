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
  /** parentSessionID → active oracle session state */
  const sessionsByParent = new Map<string, OracleSessionState>();
  /** parentSessionID → mutex chain serializing state resolution per parent */
  const locks = new Map<string, Promise<void>>();
  /** ids of every oracle session this tool has created — the recursion guard */
  const oracleSessionIds = new Set<string>();
  registerOracleSessionIds(oracleSessionIds);

  async function cleanupSession(parentSessionID: string): Promise<void> {
    const st = sessionsByParent.get(parentSessionID);
    if (!st) return;
    sessionsByParent.delete(parentSessionID);
    oracleSessionIds.delete(st.sessionId);
    try {
      await options.client.session
        .delete({ path: { id: st.sessionId } })
        .catch(() => {});
    } catch {
      /* best-effort cleanup */
    }
  }

  /** Delete tracked sessions of parent sessions idle longer than the TTL. */
  function sweepStale(): void {
    const now = Date.now();
    for (const [pid, st] of sessionsByParent) {
      if (now - st.lastUsedAt > ttlMs) {
        sessionsByParent.delete(pid);
        try {
          void options.client.session
            .delete({ path: { id: st.sessionId } })
            .catch(() => {});
        } catch {
          /* best-effort */
        }
      }
    }
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
