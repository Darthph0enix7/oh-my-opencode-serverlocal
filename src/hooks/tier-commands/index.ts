import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const COMMON_REQUIREMENTS = `
State Management:
- Add \`.slim/tier_state/\` to \`.gitignore\` if missing.
- Keep a progress file at \`.slim/tier_state/progress.md\`.
`;

function getTierPrompt(tier: number, task?: string): string {
  let instructions = '';

  if (tier === 1) {
    instructions = `**TIER 1 (Supervised) - IMMEDIATE NEXT STEP:**
Before writing any code, formulate a plan and invoke the \`task\` tool to send it to \`@oracle\` for review. 
Do not proceed with implementation until \`@oracle\` has reviewed the plan. 
At the end of the task, you must invoke \`@oracle\` again for a final code review.`;
  } else if (tier === 2) {
    instructions = `**TIER 2 (High Performance) - IMMEDIATE NEXT STEP:**
Before writing any code, formulate a detailed technical plan and invoke the \`task\` tool to send it to \`@oracle\`.
You are STRICTLY FORBIDDEN from writing implementation code until \`@oracle\` reviews the plan.
During implementation, you must frequently loop back to \`@oracle\` to review your code. You cannot finish this task until \`@oracle\` explicitly outputs "VERDICT: SHIP IT".`;
  } else if (tier === 3) {
    instructions = `**TIER 3 (All Out) - IMMEDIATE NEXT STEP:**
If this task involves ideation, ambiguity, or high-stakes decisions, your FIRST step must be to invoke the \`roundtable\` tool.
After the debate, formulate an implementation plan and invoke \`@oracle\` for review.
You must use everything available to you (@designer, @explorer, etc.) and get frequent Oracle reviews.`;
  }

  const parts = [
    `[SYSTEM DIRECTIVE: You are now locked into TIER ${tier} WORKFLOW]`,
    '',
    instructions,
    '',
    COMMON_REQUIREMENTS,
  ];
  
  if (task) {
    parts.push('', `**USER TASK:**\n${task}`);
  }

  return parts.join('\n');
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
      registerCommandHook(opencodeConfig, 'tier1', 'Start a Tier 1 session', 'Tier 1');
      registerCommandHook(opencodeConfig, 'tier2', 'Start a Tier 2 session', 'Tier 2');
      registerCommandHook(opencodeConfig, 'tier3', 'Start a Tier 3 session', 'Tier 3');
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
    }
  };
}
