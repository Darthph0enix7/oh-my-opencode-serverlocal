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
 * allowlisted subagent that already has a COMPLETED (reusable) session, we
 * silently inject that session's task_id into the call, so the native task
 * tool resumes the same session and the subagent retains its history.
 *
 * Safety rails:
 * - Allowlist (default: oracle only) — conversational/review agents only.
 * - Resume budget per session-chain (default 3) — then fresh session.
 * - Estimated token cap per session (default 40K), seeded from the job's
 *   context files so history weight is counted, not just incoming prompts.
 * - In-flight guard: a resumed session that is still running is never
 *   reused a second time concurrently (prevents interleaved corruption).
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

export interface QuerySessionReuseOptions {
  enabled: boolean;
  agents: string[];
  maxResumesPerQuery: number;
  estTokenCap: number;
  backgroundJobBoard: BackgroundJobStore & {
    findReusable?: (
      parentSessionID: string,
      agent: string,
    ) => { taskID: string; contextFiles?: { lineCount: number }[] } | undefined;
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

interface MessageLike {
  role?: string;
  info?: { id?: string };
}

export function createQuerySessionReuseHook(options: QuerySessionReuseOptions) {
  const workUnits = new Map<string, WorkUnit>();
  /** callID → taskID injected for that call (cleared in tool.execute.after) */
  const injectedCalls = new Map<string, string>();

  function getUnit(sessionID: string): WorkUnit {
    let unit = workUnits.get(sessionID);
    if (!unit) {
      unit = { agents: new Map(), inFlight: new Set() };
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
    if (unit.inFlight.has(st.taskID)) return false;
    return true;
  }

  return {
    /** Reset the work unit for a session (used by /fresh, unit detection, session deletion). */
    resetUnit,

    /**
     * tool.execute.before on `task`: auto-inject the remembered task_id
     * when the subagent is allowlisted and a reusable session exists and
     * is not already in flight.
     */
    'tool.execute.before': async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args?: unknown },
    ): Promise<void> => {
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
      if (!board || typeof board.findReusable !== 'function') {
        console.error('[qsr] no board');
        return;
      }

      const unit = getUnit(input.sessionID);
      console.error('[qsr] before-hook', { agentType, unitSize: unit.agents.size });

      // On-the-fly promotion: the board is the source of truth. The
      // transform-hook promotion can race the job-completion signal
      // (idle-reconcile delay), so if the unit has no state for this
      // agent yet — or the job changed — resolve it HERE at call time.
      const job = board.findReusable(input.sessionID, agentType);
      console.error('[qsr] findReusable', job ? job.taskID : 'none');
      if (!job) return; // no reusable session yet → fresh session

      let st = unit.agents.get(agentType);
      if (!st || st.taskID !== job.taskID) {
        st = { taskID: job.taskID, resumes: 0, estTokens: seedTokensFromJob(job) };
        unit.agents.set(agentType, st);
      }

      if (!canReuse(unit, st)) return;

      args.task_id = st.taskID;
      st.resumes += 1;
      unit.inFlight.add(st.taskID);
      if (input.callID) injectedCalls.set(input.callID, st.taskID);
      if (typeof args.prompt === 'string') {
        st.estTokens += estimateTokens(args.prompt);
      }
      log('[query-session-reuse] auto-resumed session', {
        sessionID: input.sessionID,
        agentType,
        taskID: st.taskID,
        resumes: st.resumes,
        estTokens: st.estTokens,
      });
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
      if (!input.sessionID) return;

      const messages = output.messages;
      if (!Array.isArray(messages) || messages.length === 0) return;

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
          const unit = workUnits.get(input.sessionID);
          if (!unit || unit.lastUserMsgId !== userMsgId) {
            // New user message → new work unit.
            resetUnit(input.sessionID);
            const fresh = getUnit(input.sessionID);
            fresh.lastUserMsgId = userMsgId;
            return; // do not promote old jobs into a fresh unit
          }
        }
      }

      // Promote completed jobs into the unit so subsequent calls resume them.
      const board = options.backgroundJobBoard;
      if (!board || typeof board.findReusable !== 'function') return;
      const unit = workUnits.get(input.sessionID);
      if (!unit) return;
      for (const agentType of options.agents) {
        const job = board.findReusable(input.sessionID, agentType);
        if (!job) continue;
        const st = unit.agents.get(agentType);
        if (!st || st.taskID !== job.taskID) {
          unit.agents.set(agentType, {
            taskID: job.taskID,
            resumes: 0,
            estTokens: seedTokensFromJob(job),
          });
        }
      }
    },
  };
}
