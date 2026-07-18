import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const COMMON_REQUIREMENTS = `
State Management:
- Add \`.slim/tier_state/\` to \`.gitignore\` if missing.
- Keep a progress file at \`.slim/tier_state/progress.md\`.
`;

const TIER_1_VARIANTS = [
  `**TIER 1 (Supervised) - IMMEDIATE NEXT STEP:**
Before writing any code, formulate a plan and invoke the \`task\` tool to send it to \`@oracle\` for review. 
Note: @oracle is a sparring partner, not an absolute dictator. If you disagree with its critique, push back and debate it.
Do not proceed with implementation until you and \`@oracle\` align on the plan. 
At the end of the task, you must invoke \`@oracle\` again for a final code review.`,

  `**TIER 1 PROTOCOL - ACTION REQUIRED:**
Stop. Draft your technical approach and send it to \`@oracle\` via the \`task\` tool.
Critically evaluate Oracle's feedback—do not blindly accept bad suggestions. You are the lead.
Once the plan is solid, implement it. Call \`@oracle\` one last time when you are finished for a sanity check.`,

  `**WORKFLOW LOCK: TIER 1 ENGAGED:**
Your first step is an architectural review with \`@oracle\`. 
Maintain your own agency. If Oracle suggests something flawed, explain why and suggest a better way. 
Implement only after reaching an agreement, and get a final code review at the end.`
];

const TIER_2_VARIANTS = [
  `**TIER 2 (High Performance) - IMMEDIATE NEXT STEP:**
Before writing any code, formulate a detailed technical plan and invoke the \`task\` tool to send it to \`@oracle\`.
You are STRICTLY FORBIDDEN from writing implementation code until \`@oracle\` reviews the plan.
*Crucial:* You do not have to blindly implement what Oracle says. If you disagree, debate it!
During implementation, you must frequently loop back to \`@oracle\`. You cannot finish this task until \`@oracle\` explicitly outputs "VERDICT: SHIP IT".`,

  `**TIER 2 PROTOCOL - STRICT GATING:**
First, send your proposed implementation to \`@oracle\`. 
Evaluate Oracle's feedback critically—push back if their logic is flawed or over-engineered. 
You must iterate and spar with Oracle until issues are resolved and Oracle issues the exact phrase "VERDICT: SHIP IT". Do not finish until you get that exact string.`,

  `**WORKFLOW LOCK: TIER 2 ENGAGED:**
Stop and call \`@oracle\` with your plan. Treat Oracle as a rigorous sparring partner. 
Think for yourself and challenge bad suggestions. Do not treat Oracle's word as absolute truth.
The loop continues back-and-forth until alignment is reached and Oracle formally clears you with "VERDICT: SHIP IT".`
];

const TIER_3_VARIANTS = [
  `**TIER 3 (All Out) - IMMEDIATE NEXT STEP:**
If this task involves ideation, ambiguity, or high-stakes decisions, your FIRST step must be to invoke the \`roundtable\` tool.
After the debate, formulate an implementation plan and spar with \`@oracle\`.
You must use everything available to you (@designer, @explorer, etc.). Maintain your agency and challenge bad advice from reviewers.`,

  `**TIER 3 PROTOCOL - MAXIMUM COLLABORATION:**
Call the \`roundtable\` tool to ideate and map out the best approach. 
Post-debate, formulate a plan and invoke \`@oracle\` for review. 
You are the lead—don't treat reviews as absolute truth, but as inputs to your judgment. Get frequent Oracle reviews.`,

  `**WORKFLOW LOCK: TIER 3 ENGAGED:**
Use the \`roundtable\` tool to resolve architectural ambiguity and expand the user's vision.
Loop in \`@oracle\` for code reviews, but explicitly push back if their suggestions introduce unnecessary complexity or flaws. You are ultimately in charge of the implementation quality.`
];

function getRandomVariant(variants: string[]): string {
  return variants[Math.floor(Math.random() * variants.length)];
}

function getTierPrompt(tier: number, task?: string): string {
  let instructions = '';

  if (tier === 1) {
    instructions = getRandomVariant(TIER_1_VARIANTS);
  } else if (tier === 2) {
    instructions = getRandomVariant(TIER_2_VARIANTS);
  } else if (tier === 3) {
    instructions = getRandomVariant(TIER_3_VARIANTS);
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
