import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const COMMAND_NAME = 'deepwork';

function activationPrompt(tier: string, task: string): string {
  return [
    `Use the deepwork skill for this task. Treat it as a heavy coding session operating in **${tier}**.`,
    '',
    'Deepwork requirements:',
    '- before planning, delegation, or creating state, inspect existing `.gitignore` and `.ignore`; add only missing entries without duplicates: `.gitignore` must contain `.slim/deepwork/`, and `.ignore` must contain `!.slim/deepwork/` and `!.slim/deepwork/**`; this keeps state git-local yet OpenCode-readable;',
    '- create/update a `.slim/deepwork/` progress file;',
    '- keep OpenCode todos synced with the current phase;',
    '- **Follow the strict rules of your assigned Tier** (e.g., calling @oracle or the roundtable tool as mandated).',
    '- execute phase by phase with background specialists where useful;',
    '- wait for hook-driven background completion, reconcile results, validate, and adhere to your tier\'s review requirements;',
    '- fix actionable review issues before continuing.',
    '',
    'Task:',
    task,
  ].join('\n');
}

export function createDeepworkCommandHook(): {
  registerCommand: (config: Record<string, unknown>) => void;
  handleCommandExecuteBefore: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>;
} {
  return {
    registerCommand: (opencodeConfig) => {
      registerCommandHook(
        opencodeConfig,
        COMMAND_NAME,
        'Start a deepwork session with a specific Tier (e.g., /deepwork tier 2 <task>)',
        'Use the deepwork workflow with Tier 0, 1, 2, or 3',
      );
    },

    handleCommandExecuteBefore: async (input, output) => {
      if (input.command !== COMMAND_NAME) return;

      output.parts.length = 0;
      const rawArgs = input.arguments.trim();
      if (!rawArgs) {
        output.parts.push(
          createInternalAgentTextPart(
            'What task should deepwork manage? Run `/deepwork tier 1 <task>`. Defaults to Tier 1 if omitted.',
          ),
        );
        return;
      }

      let tier = "Tier 1: Guided / Supervised Mode";
      let task = rawArgs;

      const tierMatch = rawArgs.match(/^tier\s*([0-3])\s+(.*)/i);
      if (tierMatch) {
        const tierNum = tierMatch[1];
        task = tierMatch[2];
        if (tierNum === "0") tier = "Tier 0: Basic Mode";
        else if (tierNum === "1") tier = "Tier 1: Guided / Supervised Mode";
        else if (tierNum === "2") tier = "Tier 2: Sophisticated Ideation & Planning";
        else if (tierNum === "3") tier = "Tier 3: Sophisticated Implementation";
      }

      output.parts.push({ type: 'text', text: activationPrompt(tier, task) });
    },
  };
}
