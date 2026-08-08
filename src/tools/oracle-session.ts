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
 * Lifecycle:
 * - First call for a session: creates a fresh oracle subagent session.
 * - Subsequent calls WITHOUT session_id: reuse the same session (the oracle
 *   accumulates the conversation and remembers its prior verdicts).
 * - Calls WITH session_id (returned by the tool): resume that exact session
 *   (explicit continuation handle — the id is a real session id).
 * - A new call WITHOUT session_id that starts a fresh unit deletes the old
 *   oracle session first (bounded: at most one tracked oracle session per
 *   parent session; the tool never leaks sessions).
 * - Safety rails: max prompts per unit, estimated token cap.
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
}

interface OracleSessionState {
  sessionId: string;
  prompts: number;
  estTokens: number;
}

export function createOracleSessionTool(options: OracleSessionToolOptions) {
  const maxPrompts = options.maxPromptsPerUnit ?? 10;
  const tokenCap = options.estTokenCap ?? 50_000;
  /** parentSessionID → active oracle session state */
  const sessionsByParent = new Map<string, OracleSessionState>();

  async function cleanupSession(parentSessionID: string): Promise<void> {
    const st = sessionsByParent.get(parentSessionID);
    if (!st) return;
    sessionsByParent.delete(parentSessionID);
    try {
      await options.client.session
        .delete({ path: { id: st.sessionId } })
        .catch(() => {});
    } catch {
      /* best-effort cleanup */
    }
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
              'explicitly continue that same conversation. Omit to auto-resume the active ' +
              'oracle session for this task, or to start a fresh one.',
          ),
      },
      async execute(
        args: Record<string, unknown>,
        context: ToolContext,
      ): Promise<string> {
        const parentID = context.sessionID;
        const promptText = typeof args.prompt === 'string' ? args.prompt : '';
        const explicitSessionId =
          typeof args.session_id === 'string' && args.session_id.trim() !== ''
            ? args.session_id
            : undefined;

        let st = sessionsByParent.get(parentID);

        // Explicit continuation: adopt the given session id.
        if (explicitSessionId) {
          if (!st || st.sessionId !== explicitSessionId) {
            st = { sessionId: explicitSessionId, prompts: 0, estTokens: 0 };
            sessionsByParent.set(parentID, st);
          }
        } else if (st) {
          // Auto-continuation within a unit — enforce safety rails.
          if (st.prompts >= maxPrompts || st.estTokens >= tokenCap) {
            await cleanupSession(parentID);
            st = undefined;
          }
        }

        if (!st) {
          // Fresh unit: drop any stale tracked session, then create.
          await cleanupSession(parentID);
          const created = await options.client.session.create({
            query: { directory: context.directory },
          });
          if (created.error) {
            return `Oracle session error: ${JSON.stringify(created.error)}`;
          }
          st = { sessionId: created.data.id, prompts: 0, estTokens: 0 };
          sessionsByParent.set(parentID, st);
        }

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

        const text = (resp.data.parts as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('');

        return JSON.stringify({
          response: text,
          session_id: st.sessionId,
          prompts: st.prompts,
        });
      },
    },
  };
}
