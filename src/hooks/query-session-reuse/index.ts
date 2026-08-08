/**
 * Query-scoped subagent session reuse.
 *
 * Problem: every `task` dispatch to a subagent (e.g. the oracle) spawns a
 * fresh session. Within ONE user query the orchestrator may consult the
 * oracle 3-5 times, each time with amnesia — the oracle re-reviews code it
 * already approved and forgets its own previous verdicts.
 *
 * Solution: track "work units" — everything between two user messages in an
 * orchestrator session. Within a work unit, if the orchestrator calls an
 * allowlisted subagent that already has a COMPLETED session, we silently
 * inject that session's task_id into the call, so the native task tool
 * resumes the same session and the subagent retains its history.
 *
 * Why not the board's own `isReusable`/`resolveReusable`: that machinery
 * requires `!terminalUnreconciled`, which only clears via the background-
 * task reconcile flow. FOREGROUND task calls (what the orchestrator makes)
 * keep terminalUnreconciled=true forever, so the board never considers them
 * reusable — but their sessions are fully complete and perfectly resumable
 * via task_id. `terminalState === 'completed'` is the right signal.
 *
 * Safety rails:
 * - Allowlist (default: oracle only) — conversational/review agents only.
 * - Resume budget per session-chain (default 3) — then fresh session.
 * - Estimated token cap per session (default 40K), seeded from the job's
 *   context files so history weight is counted, not just incoming prompts.
 * - In-flight guard: a resumed session that is still running is never
 *   reused a second time concurrently (prevents interleaved corruption).
 * - Cross-query exclusion: only jobs launched AFTER the work unit began are
 *   reusable, so a new user query always starts with a fresh session.
 * - Fresh-session fallback: if the remembered session is gone or errored,
 *   the stale task_id is dropped so the native tool creates a fresh one.
 *
 * The work unit resets when a NEW user message arrives. Detection scans for
 * the last USER message (injected reminders/nudges may trail it), and tracks
 * the user message id so repeated transform passes don't double-reset.
 */

import { log } from '../../utils/logger';
import { isRecord as isObjectRecord } from '../../utils/guards';
import type { BackgroundJobStore } from '../../utils/background-job-store';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * TEMP DIAGNOSTIC — server-side self-report. The openchamber-hosted opencode
 * server's stdout is not journaled, so plugin logs are invisible. This writes
 * a trace the server process itself can produce. Remove after diagnosis.
 */
const QSR_TRACE = join(
  process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.config', 'opencode'),
  'qsr-trace.log',
);
function trace(msg: string): void {
  try {
    process.stderr.write(`[qsr] pid=${process.pid} ${msg}\n`);
    mkdirSync(join(process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.config', 'opencode')), { recursive: true });
    appendFileSync(QSR_TRACE, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`);
  } catch (e) {
    /* never throw from a hook */
  }
}

export interface QuerySessionReuseOptions {
  enabled: boolean;
  agents: string[];
  maxResumesPerQuery: number;
  estTokenCap: number;
  backgroundJobBoard: BackgroundJobStore & {
    list?: (parentSessionID?: string) => unknown[];
  };
}

interface UnitAgentState {
  taskID: string;
  resumes: number;
  estTokens: number;
}

interface WorkUnit {
  /** agentType → state of the active reusable session */
  agents: Map<string, UnitAgentState>;
  /** id of the last user message that started this unit (reset guard) */
  lastUserMsgId?: string;
  /** taskIDs of resumed sessions currently in flight (concurrency guard) */
  inFlight: Set<string>;
  /** when this unit began — used to exclude pre-reset sessions from reuse */
  createdAt: number;
}

/** Rough token estimate: ~1.3 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.3);
}

/** Seed token estimate from the job's read-context weight (~8 tok/line). */
function seedTokensFromJob(
  job: { contextFiles?: { lineCount: number }[] },
): number {
  const fileTokens = (job.contextFiles ?? []).reduce(
    (acc, f) => acc + (f.lineCount ?? 0) * 8,
    0,
  );
  return fileTokens + 2000; // + system prompt & prior turns baseline
}

interface BoardJobLike {
  taskID: string;
  agent?: string;
  state?: string;
  terminalState?: string;
  terminalUnreconciled?: boolean;
  lastUsedAt?: number;
  updatedAt?: number;
  launchedAt?: number;
  contextFiles?: { lineCount: number }[];
}

/**
 * Find the most recent COMPLETED job for an agent in this parent session.
 *
 * Deliberately does NOT use the board's `isReusable` semantics — foreground
 * task jobs are never "reconciled" (see module docstring). terminalState ===
 * 'completed' is the correct resumability signal here. Jobs launched before
 * the work unit began are excluded so sessions never bleed across queries.
 */
function findCompletedJob(
  board: unknown,
  parentSessionID: string,
  agentType: string,
  minLaunchedAt = 0,
): BoardJobLike | undefined {
  const list = (board as { list?: (s: string) => unknown[] }).list;
  if (typeof list !== 'function') return undefined;
  const jobs = (list.call(board, parentSessionID) ?? []) as BoardJobLike[];
  const candidates = jobs.filter(
    (j) =>
      j.agent === agentType &&
      (j.terminalState ?? j.state) === 'completed' &&
      j.state !== 'running' &&
      (j.launchedAt ?? 0) >= minLaunchedAt,
  );
  if (candidates.length === 0) return undefined;
  candidates.sort(
    (a, b) => (b.lastUsedAt ?? b.updatedAt ?? 0) - (a.lastUsedAt ?? a.updatedAt ?? 0),
  );
  return candidates[0];
}

interface MessageLike {
  role?: string;
  info?: { id?: string; sessionID?: string };
}

export function createQuerySessionReuseHook(options: QuerySessionReuseOptions) {
  const workUnits = new Map<string, WorkUnit>();
  /** callID → taskID injected for that call (cleared in tool.execute.after) */
  const injectedCalls = new Map<string, string>();

  function getUnit(sessionID: string): WorkUnit {
    let unit = workUnits.get(sessionID);
    if (!unit) {
      unit = { agents: new Map(), inFlight: new Set(), createdAt: Date.now() };
      workUnits.set(sessionID, unit);
    }
    return unit;
  }

  function resetUnit(sessionID: string): void {
    if (workUnits.delete(sessionID)) {
      log('[query-session-reuse] work unit reset', { sessionID });
    }
  }

  function canReuse(unit: WorkUnit, st: UnitAgentState): boolean {
    if (!options.enabled) return false;
    if (st.resumes >= options.maxResumesPerQuery) return false;
    if (st.estTokens >= options.estTokenCap) return false;
    // Precise concurrency guard: only block while the job is genuinely
    // STILL RUNNING. A completed session is never "running", so sequential
    // resumes always pass. (The local inFlight set failed here: task calls
    // spawn asynchronously and tool.execute.after never fires, so the set
    // never cleared and every resume after the first was blocked.)
    const board = options.backgroundJobBoard as unknown as {
      isRunning?: (taskID: string) => boolean;
    };
    if (typeof board.isRunning === 'function' && board.isRunning(st.taskID)) {
      return false;
    }
    return true;
  }

async function beforeLogic(
  input: { tool: string; sessionID?: string; callID?: string },
  output: { args?: unknown },
): Promise<void> {
  trace(`[before] entry tool=${input.tool} sessionID=${input.sessionID ?? 'UNDEFINED'} enabled=${options.enabled}`);
  if (!options.enabled) return;
  if (input.tool.toLowerCase() !== 'task') return;
  if (!input.sessionID) return;
  if (!isObjectRecord(output.args)) return;

  const args = output.args as { subagent_type?: unknown; task_id?: unknown; prompt?: unknown };
  if (typeof args.subagent_type !== 'string' || args.subagent_type.trim() === '') return;
  // Respect an explicit task_id from the model — it knows what it wants.
  if (typeof args.task_id === 'string' && args.task_id.trim() !== '') return;

  const agentType = args.subagent_type.trim();
  if (!options.agents.includes(agentType)) return;

  const board = options.backgroundJobBoard;
  if (!board || typeof board.list !== 'function') return;

  const unit = getUnit(input.sessionID);

  // On-the-fly promotion: the board is the source of truth. The
  // transform-hook promotion can race the job-completion signal, so if
  // the unit has no state for this agent yet — or the job changed —
  // resolve it HERE at call time (excluding pre-unit jobs).
  const job = findCompletedJob(board, input.sessionID, agentType, unit.createdAt);
  trace(`[before] agent=${agentType} job=${job ? job.taskID : 'NONE'} unitCreated=${unit.createdAt} now=${Date.now()}`);
  if (!job) return; // no completed session yet → fresh session

  let st = unit.agents.get(agentType);
  if (!st || st.taskID !== job.taskID) {
    st = { taskID: job.taskID, resumes: 0, estTokens: seedTokensFromJob(job) };
    unit.agents.set(agentType, st);
  }

  if (!canReuse(unit, st)) {
    trace(`[before] canReuse=false resumes=${st.resumes}/${options.maxResumesPerQuery} estTokens=${st.estTokens}/${options.estTokenCap} inFlight=${unit.inFlight.has(st.taskID)}`);
    return;
  }

  args.task_id = st.taskID;
  st.resumes += 1;
  unit.inFlight.add(st.taskID);
  if (input.callID) injectedCalls.set(input.callID, st.taskID);
  if (typeof args.prompt === 'string') {
    st.estTokens += estimateTokens(args.prompt);
  }
  trace(`[before] INJECTED task_id=${st.taskID} readback=${args.task_id} resumes=${st.resumes}`);
  log('[query-session-reuse] auto-resumed session', {
    sessionID: input.sessionID,
    agentType,
    taskID: st.taskID,
    resumes: st.resumes,
    estTokens: st.estTokens,
  });
}

  return {
    /** Reset the work unit for a session (used by /fresh, unit detection, session deletion). */
    resetUnit,

    /**
     * tool.execute.before on `task`: auto-inject the remembered task_id
     * when the subagent is allowlisted and a completed session exists that
     * is not already in flight. Wrapped in try/catch so a hook failure can
     * never break the task tool itself.
     */
    'tool.execute.before': async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args?: unknown },
    ): Promise<void> => {
      try {
        await beforeLogic(input, output);
      } catch (e) {
        trace(`[before] EXCEPTION tool=${input.tool} sessionID=${input.sessionID ?? '?'} err=${e instanceof Error ? e.message : String(e)} stack=${e instanceof Error ? (e.stack ?? '').slice(0, 300) : ''}`);
      }
    },

    /**
     * tool.execute.after: release the in-flight guard for the resumed
     * session (fires when the tool call completes or errors).
     */
    'tool.execute.after': async (
      input: { tool: string; sessionID?: string; callID?: string },
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== 'task') return;
      if (!input.sessionID) return;
      const taskID = input.callID ? injectedCalls.get(input.callID) : undefined;
      if (!taskID) return;
      injectedCalls.delete(input.callID as string);
      const unit = workUnits.get(input.sessionID);
      if (unit) {
        unit.inFlight.delete(taskID);
      }
    },

    /**
     * experimental.chat.messages.transform: detect a NEW user message and
     * reset the work unit. Also promote newly-completed jobs to the unit's
     * active taskID so the NEXT call within the same unit auto-resumes.
     *
     * User-message detection scans for the LAST user message (injected
     * reminders/nudges may trail it) and compares its id against the unit's
     * recorded id — this survives reminder injection and double-passes.
     */
    'experimental.chat.messages.transform': async (
      input: { sessionID?: string },
      output: { messages?: unknown[] },
    ): Promise<void> => {
      if (!options.enabled) return;

      const messages = output.messages;
      if (!Array.isArray(messages) || messages.length === 0) return;

      // NOTE: this hook's input carries NO sessionID — derive it from the
      // messages themselves (same approach as task-session-manager).
      let sessionID: string | undefined = input.sessionID;
      if (!sessionID) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = (messages[i] as MessageLike | undefined)?.info;
          if (info && typeof info.sessionID === 'string') {
            sessionID = info.sessionID;
            break;
          }
        }
      }
      if (!sessionID) return;

      // Find the last USER message, scanning from the end so trailing
      // injected system/assistant reminders don't mask it.
      let lastUser: MessageLike | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as MessageLike;
        if (m && m.role === 'user') {
          lastUser = m;
          break;
        }
      }

      if (lastUser) {
        const userMsgId = lastUser.info?.id;
        if (userMsgId) {
          const unit = workUnits.get(sessionID);
          if (!unit || unit.lastUserMsgId !== userMsgId) {
            trace(`[transform] NEW USER MSG session=${sessionID} msg=${userMsgId} — reset`);
            // New user message → new work unit.
            resetUnit(sessionID);
            const fresh = getUnit(sessionID);
            fresh.lastUserMsgId = userMsgId;
            return; // do not promote old jobs into a fresh unit
          }
        }
      }

      // Promote completed jobs into the unit so subsequent calls resume them.
      const board = options.backgroundJobBoard;
      if (!board || typeof board.list !== 'function') return;
      const unit = workUnits.get(sessionID);
      trace(`[transform] session=${sessionID} unitExists=${!!unit}`);
      if (!unit) return;
      for (const agentType of options.agents) {
        const job = findCompletedJob(board, sessionID, agentType, unit.createdAt);
        if (!job) continue;
        const st = unit.agents.get(agentType);
        if (!st || st.taskID !== job.taskID) {
          unit.agents.set(agentType, {
            taskID: job.taskID,
            resumes: 0,
            estTokens: seedTokensFromJob(job),
          });
          trace(`[transform] PROMOTED session=${sessionID} agent=${agentType} job=${job.taskID}`);
        }
      }
    },
  };
}
