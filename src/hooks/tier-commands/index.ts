import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

function activationPrompt(tier: number, task: string): string {
  let tierRules = '';

  if (tier === 1) {
    tierRules = `**Tier 1: Basic Collaboration**
Focus: Quality assurance through basic supervision.
Rules:
1. You must plan the work first.
2. MANDATORY: Call @oracle to review your plan BEFORE implementing.
3. Implement the work yourself, or offload parallel tasks to @fixer.
4. MANDATORY: Call @oracle at the end of the implementation to review the final code.`;
  } else if (tier === 2) {
    tierRules = `**Tier 2: Deep Collaboration & Multiple Reviews**
Focus: High-quality, heavily supervised implementation.
Rules:
1. You are working under the strict supervision of @oracle.
2. You must interact with @oracle multiple times: for initial planning, during major implementation steps, and for final corrections.
3. Utilize all normal sub-agents (@explorer, @librarian, @designer) extensively to gather perfect context before acting.
4. Expect and proactively seek multiple reviews and corrections.`;
  } else if (tier === 3) {
    tierRules = `**Tier 3: The "All Out" Tier**
Focus: Maximum sophistication, ideation, and complex problem solving.
Rules:
1. This is the highest level of execution. You use everything available.
2. **ROUNDTABLE MANDATORY:** Because task requirements at this tier are often vague or have multiple valid approaches, you MUST start by invoking the \`roundtable\` tool. Let the debaters ideate, refine the vision, and figure out the best approach.
3. Once the roundtable produces a council report, translate it into a technical plan and have @oracle review it.
4. During implementation, if any ambiguity arises, invoke the \`roundtable\` tool again.
5. Work with @oracle for continuous, strict supervision (multiple reviews/corrections).`;
  }

  return [
    `You are operating in **Tier ${tier}**. Follow these rules strictly:`,
    '',
    tierRules,
    '',
    'State Management Requirements:',
    '- Inspect `.gitignore` and `.ignore`. Add `.slim/tier_state/` to `.gitignore` and `!.slim/tier_state/` to `.ignore`.',
    '- Maintain a progress file at `.slim/tier_state/progress.md`.',
    '- Keep OpenCode todos synced.',
    '',
    'Task:',
    task,
  ].join('\n');
}

export function createTierCommandsHook(): {
  registerCommand: (config: Record<string, unknown>) => void;
  handleCommandExecuteBefore: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>;
} {
  const commands = ['tier1', 'tier2', 'tier3'];

  return {
    registerCommand: (opencodeConfig) => {
      registerCommandHook(opencodeConfig, 'tier1', 'Start a Tier 1 session (Basic Oracle Collaboration)', 'Tier 1');
      registerCommandHook(opencodeConfig, 'tier2', 'Start a Tier 2 session (Deep Collaboration & Multiple Reviews)', 'Tier 2');
      registerCommandHook(opencodeConfig, 'tier3', 'Start a Tier 3 session (All-Out: Roundtable + Deep Collaboration)', 'Tier 3');
    },

    handleCommandExecuteBefore: async (input, output) => {
      if (!commands.includes(input.command)) return;

      output.parts.length = 0;
      const task = input.arguments.trim();
      if (!task) {
        output.parts.push(
          createInternalAgentTextPart(
            `What task should this tier manage? Run \`/${input.command} <task>\`.`,
          ),
        );
        return;
      }

      const tierNum = parseInt(input.command.replace('tier', ''), 10);
      output.parts.push({ type: 'text', text: activationPrompt(tierNum, task) });
    },
  };
}
