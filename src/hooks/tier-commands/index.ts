import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const COMMON_REQUIREMENTS = `
State Management Requirements:
- Before planning or creating state, inspect \`.gitignore\` and \`.ignore\`. Add missing entries: \`.gitignore\` must contain \`.slim/tier_state/\`, and \`.ignore\` must contain \`!.slim/tier_state/\` and \`!.slim/tier_state/**\`.
- Create and maintain a progress file at \`.slim/tier_state/progress.md\`.
- Keep OpenCode todos synced with the current phase.
- Execute phase by phase. Wait for hook-driven background completion, reconcile results, and fix actionable review issues before continuing.`;

function getTierPrompt(tier: number, task: string): string {
  let tierRules = '';

  switch (tier) {
    case 0:
      tierRules = `**Tier 0: Basic Mode**
Focus: Fast, direct implementation. Low cooperation overhead.
Rules:
1. You (Orchestrator) do the main implementation work.
2. High threshold for asking for review. No mandatory @oracle review.
3. Use @explorer and @librarian freely for basic context.
4. If parallel simple implementation is needed, offload to @fixer.
5. If visual design is needed, call @designer. If vision extraction is needed, call @observer.`;
      break;
    case 1:
      tierRules = `**Tier 1: Guided / Supervised Mode**
Focus: Quality and correctness over pure speed.
Rules:
1. You must plan the work first.
2. MANDATORY: Call @oracle to review your plan (logic, edge cases, overlooked items) BEFORE implementing.
3. Implement the work yourself, or offload parallel tasks to @fixer.
4. MANDATORY: Call @oracle at the end of the implementation to review the final code for bugs and logical errors. Treat @oracle as your strict supervisor.
5. Use @designer for UI, @observer for vision, @explorer/@librarian for context.`;
      break;
    case 2:
      tierRules = `**Tier 2: Sophisticated Ideation & Planning**
Focus: High value, high performance, high cost. Vision expansion.
Rules:
1. The user has provided a vision or basic idea.
2. MANDATORY: You must FIRST use the \`roundtable\` tool to plan the non-technical implementation, get creative feature suggestions, and refine the updated, perfected version of the user's vision.
3. Once the roundtable outputs its report, you must translate it into a technical implementation plan.
4. MANDATORY: Call @oracle to review your technical translation of the roundtable's plan BEFORE implementing.
5. Proceed with implementation. Call @oracle for a final code review at the end.`;
      break;
    case 3:
      tierRules = `**Tier 3: Sophisticated Implementation**
Focus: Complex, ambiguous implementation.
Rules:
1. You implement the main tasks. Occasionally ask @oracle for spot-checks.
2. AMBIGUITY RESOLUTION: If during implementation the task has multiple perspectives or it is not clearly decidable what the best course of action is, you MUST invoke the \`roundtable\` tool to decide the path forward.
3. Offload parallel known tasks to @fixer, UI to @designer.
4. MANDATORY: Call @oracle for a final code review at the end.`;
      break;
  }

  return [
    `You are operating in a strict structured workflow.`,
    '',
    COMMON_REQUIREMENTS,
    '',
    tierRules,
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
  const commands = ['tier0', 'tier1', 'tier2', 'tier3'];

  return {
    registerCommand: (opencodeConfig) => {
      registerCommandHook(opencodeConfig, 'tier0', 'Start a Tier 0 session (Fast, direct implementation)', 'Basic mode');
      registerCommandHook(opencodeConfig, 'tier1', 'Start a Tier 1 session (Guided/Supervised by Oracle)', 'Supervised mode');
      registerCommandHook(opencodeConfig, 'tier2', 'Start a Tier 2 session (Ideation via Roundtable -> Supervised)', 'Sophisticated Ideation');
      registerCommandHook(opencodeConfig, 'tier3', 'Start a Tier 3 session (Complex implementation with Roundtable fallback)', 'Sophisticated Implementation');
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
