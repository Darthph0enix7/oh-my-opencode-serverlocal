import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const COMMON_REQUIREMENTS = `
State Management:
- Add \`.slim/tier_state/\` to \`.gitignore\` if missing.
- Keep a progress file at \`.slim/tier_state/progress.md\`.
`;

const TIER_1_VARIANTS = [
  `**TIER 1 (Supervised) - IMMEDIATE NEXT STEP:**
Before writing any code, formulate a plan and consult the oracle via the \`oracle_session\` tool. 
Note: the oracle agent is a sparring partner, not an absolute dictator. If you disagree with its critique, push back and debate it.
Do not proceed with implementation until you and \`the oracle agent\` align on the plan. 
At the end of the task, you must invoke \`the oracle agent\` again for a final code review.`,

  `**TIER 1 PROTOCOL - ACTION REQUIRED:**
Stop. Draft your technical approach and consult \`the oracle agent\` via the \`oracle_session\` tool.
Critically evaluate the oracle agent's feedback—do not blindly accept bad suggestions. You are the lead.
Once the plan is solid, implement it. Call \`the oracle agent\` one last time when you are finished for a sanity check.`,

  `**WORKFLOW LOCK: TIER 1 ENGAGED:**
Your first step is an architectural review with \`the oracle agent\`. 
Maintain your own agency. If the oracle agent suggests something flawed, explain why and suggest a better way. 
Implement only after reaching an agreement, and get a final code review at the end.`
];

const TIER_2_VARIANTS = [
  `**TIER 2 (High Performance) - IMMEDIATE NEXT STEP:**
Before writing any code, formulate a detailed technical plan and consult \`the oracle agent\` via the \`oracle_session\` tool.
You are STRICTLY FORBIDDEN from writing implementation code until \`the oracle agent\` reviews the plan.
*Crucial:* You do not have to blindly implement what the oracle agent says. If you disagree, debate it!
During implementation, you must frequently loop back to \`the oracle agent\`. You cannot finish this task until \`the oracle agent\` explicitly outputs "VERDICT: SHIP IT".`,

  `**TIER 2 PROTOCOL - STRICT GATING:**
First, send your proposed implementation to \`the oracle agent\`. 
Evaluate the oracle agent's feedback critically—push back if their logic is flawed or over-engineered. 
You must iterate and spar with the oracle agent until issues are resolved and the oracle agent issues the exact phrase "VERDICT: SHIP IT". Do not finish until you get that exact string.`,

  `**WORKFLOW LOCK: TIER 2 ENGAGED:**
Stop and call \`the oracle agent\` with your plan. Treat the oracle agent as a rigorous sparring partner. 
Think for yourself and challenge bad suggestions. Do not treat the oracle agent's word as absolute truth.
The loop continues back-and-forth until alignment is reached and the oracle agent formally clears you with "VERDICT: SHIP IT".`
];

const TIER_3_VARIANTS = [
  `**TIER 3 (All Out) - IMMEDIATE NEXT STEP:**
If this task involves ideation, ambiguity, or high-stakes decisions, your FIRST step must be to invoke the \`roundtable\` tool.
After the debate, formulate an implementation plan and spar with \`the oracle agent\`.
You must use everything available to you (the designer agent, the explorer agent, etc.). Maintain your agency and challenge bad advice from reviewers.`,

  `**TIER 3 PROTOCOL - MAXIMUM COLLABORATION:**
Call the \`roundtable\` tool to ideate and map out the best approach. 
Post-debate, formulate a plan and invoke \`the oracle agent\` for review. 
You are the lead—don't treat reviews as absolute truth, but as inputs to your judgment. Get frequent the oracle agent reviews.`,

  `**WORKFLOW LOCK: TIER 3 ENGAGED:**
Use the \`roundtable\` tool to resolve architectural ambiguity and expand the user's vision.
Loop in \`the oracle agent\` for code reviews, but explicitly push back if their suggestions introduce unnecessary complexity or flaws. You are ultimately in charge of the implementation quality.`
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
