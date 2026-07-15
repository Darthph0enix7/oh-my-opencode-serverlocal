import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const COMMON_REQUIREMENTS = `
State Management Guidelines:
- Before planning or creating state, inspect \`.gitignore\` and \`.ignore\`. Add \`.slim/tier_state/\` if missing.
- Create and maintain a progress file at \`.slim/tier_state/progress.md\`.
- Keep OpenCode todos synced with the current phase.
- Execute phase by phase.
`;

function getTierPrompt(tier: number, task: string): string {
  let tierRules = '';

  if (tier === 1) {
    tierRules = `**Tier 1: Supervised Implementation**
Focus: Quality assurance through cooperation.
Guidelines:
1. Plan everything out first and have @oracle review the logical journal of your plan to find bugs or edge cases you might overlook.
2. Implement the work yourself, or offload parallel tasks to @fixer.
3. At the end of the implementation, have @oracle review the code to find logical errors.
4. Depending on how long the implementation goes or how many features are involved, call @oracle to cooperate with you as a supervisor when needed. At a minimum, let it review at the beginning and the end.`;
  } else if (tier === 2) {
    tierRules = `**Tier 2: Sophisticated & High Performance**
Focus: High value, high performance, high cost workflow.
Guidelines:
1. Deep cooperation with all sub-agents (@explorer, @librarian, @designer).
2. Work closely with @oracle as a strict supervisor. 
3. Expect to perform multiple reviews and corrections during the implementation process to ensure the highest quality output. Use your judgment to call for reviews frequently.`;
  } else if (tier === 3) {
    tierRules = `**Tier 3: The "All Out" Tier**
Focus: Maximum sophistication, ideation, and complex problem solving.
Guidelines:
1. Use everything available to you.
2. If the user provides a vision or wishes, ask the \`roundtable\` tool to plan out the non-technical implementation and create a perfected version of the vision. Let it suggest creative options and features.
3. You implement everything, occasionally asking @oracle for reviews.
4. If the task has more needs, multiple perspectives, or if it is not clearly decidable what the best course of action is, invoke the \`roundtable\` tool again to decide the path forward.`;
  }

  return [
    `Use the **tier${tier}-workflow** skill for this task to structure your documentation.`,
    `You are operating in **Tier ${tier}**.`,
    '',
    tierRules,
    '',
    COMMON_REQUIREMENTS,
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
      registerCommandHook(opencodeConfig, 'tier1', 'Start a Tier 1 session (Supervised Implementation)', 'Tier 1');
      registerCommandHook(opencodeConfig, 'tier2', 'Start a Tier 2 session (Sophisticated & High Performance)', 'Tier 2');
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
      output.parts.push({ type: 'text', text: getTierPrompt(tierNum, task) });
    },
  };
}
