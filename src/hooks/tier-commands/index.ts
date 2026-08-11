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
Implement only after reaching an agreement, and get a final code review at the end.`,
];

const TIER_2_VARIANTS = [
  `**TIER 2 (Collaborative) - TWO-PHASE LOOP:**
You are the lead; \`the oracle agent\` is your rigorous reviewer. The oracle is not a dictator — if it suggests something flawed, debate it. The task is NOT done until BOTH of you are satisfied.

PHASE 1 - PLAN REVIEW:
1. Formulate a detailed technical plan.
2. Consult \`the oracle agent\` via the \`oracle_session\` tool.
3. Iterate on the plan with the oracle until it explicitly outputs "VERDICT: SHIP IT" — meaning the PLAN is agreed.

PHASE 2 - IMPLEMENTATION REVIEW (MANDATORY):
4. Implement the agreed plan. During implementation, loop back to the oracle whenever you hit a genuinely tricky decision.
5. When the implementation is complete, present the FULL implementation (files changed, key code paths, diff summary) to \`the oracle agent\` via \`oracle_session\` for a final code review.
6. Fix everything the oracle flags. Then re-present for review.
7. Iterate (fix → re-review) until the oracle explicitly outputs "VERDICT: SHIP IT" on the IMPLEMENTATION — and you agree its judgment is right. If it wrongly blocks something correct, push back and resolve it together.

FINAL REPORT:
8. Your last step before responding to the user must be the oracle's verdict on the implemented code ("VERDICT: SHIP IT"). Report both verdicts (plan + implementation) and what changed between them.`,

  `**TIER 2 PROTOCOL - COLLABORATIVE SHIP GATE:**
Phase A: Draft your technical plan and spar with \`the oracle agent\` via \`oracle_session\` until the plan converges — the oracle must explicitly output "VERDICT: SHIP IT" for the plan. Critically evaluate its feedback; you are the lead.
Phase B: Implement. For tricky spots, consult the oracle as you go.
Phase C: After implementation, present the actual code to the oracle for review. Fix its findings, re-present, and repeat until it explicitly outputs "VERDICT: SHIP IT" on the implementation — and you are satisfied the code is genuinely correct (push back if its objection is wrong).
Close: Your final message to the user must be preceded by the oracle's implementation verdict. Report plan verdict + implementation verdict.`,

  `**WORKFLOW LOCK: TIER 2 ENGAGED (PLAN + IMPLEMENTATION GATE):**
1. Plan first. Consult \`the oracle agent\` via \`oracle_session\`. Iterate until the oracle explicitly says "VERDICT: SHIP IT" on the plan. Challenge bad advice — keep your agency.
2. Implement the agreed plan.
3. THEN the oracle reviews the finished implementation via \`oracle_session\`. Iterate (fix → re-review) until it explicitly says "VERDICT: SHIP IT" on the code and you both agree the work is correct.
4. The user must NEVER receive a final report without the oracle's implementation verdict behind it. Report both the plan verdict and the implementation verdict.`,
];

const TIER_2_5_VARIANTS = [
  `**TIER 2.5 (Plan-Gate) - BASIC REVIEW LOOP:**
Before writing any code, formulate a detailed technical plan and consult \`the oracle agent\` via the \`oracle_session\` tool.
You are STRICTLY FORBIDDEN from writing implementation code until \`the oracle agent\` reviews the plan.
*Crucial:* You do not have to blindly implement what the oracle agent says. If you disagree, debate it!
Once the plan is cleared with "VERDICT: SHIP IT", implement it and finish — no mandatory post-implementation review.`,

  `**TIER 2.5 PROTOCOL - PLAN GATING ONLY:**
First, send your proposed plan to \`the oracle agent\` via \`oracle_session\`.
Evaluate the oracle agent's feedback critically—push back if their logic is flawed or over-engineered.
You must iterate and spar with the oracle agent until the plan is resolved and the oracle agent issues the exact phrase "VERDICT: SHIP IT". Then implement. The oracle does NOT need to re-review the implementation.`,

  `**WORKFLOW LOCK: TIER 2.5 ENGAGED:**
Stop and call \`the oracle agent\` via \`oracle_session\` with your plan. Treat the oracle agent as a rigorous sparring partner.
Think for yourself and challenge bad suggestions. Do not treat the oracle agent's word as absolute truth.
The loop continues back-and-forth until alignment is reached on the PLAN and the oracle agent formally clears you with "VERDICT: SHIP IT". Then implement and finish — no post-implementation review.`,
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
Loop in \`the oracle agent\` for code reviews, but explicitly push back if their suggestions introduce unnecessary complexity or flaws. You are ultimately in charge of the implementation quality.`,
];

function getRandomVariant(variants: string[]): string {
  return variants[Math.floor(Math.random() * variants.length)];
}

function getTierPrompt(tier: number, task?: string): string {
  let instructions = '';

  if (tier === 1) {
    instructions = getRandomVariant(TIER_1_VARIANTS);
  } else if (tier === 2.5) {
    instructions = getRandomVariant(TIER_2_5_VARIANTS);
  } else if (tier === 2) {
    instructions = getRandomVariant(TIER_2_VARIANTS);
  } else if (tier === 3) {
    instructions = getRandomVariant(TIER_3_VARIANTS);
  }

  const tierLabel = Number.isInteger(tier) ? String(tier) : String(tier);
  const parts = [
    `[SYSTEM DIRECTIVE: You are now locked into TIER ${tierLabel} WORKFLOW]`,
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
  const commands = ['tier1', 'tier2', 'tier2.5', 'tier3'];

  return {
    registerCommand: (opencodeConfig) => {
      registerCommandHook(
        opencodeConfig,
        'tier1',
        'Start a Tier 1 session',
        'Tier 1',
      );
      registerCommandHook(
        opencodeConfig,
        'tier2',
        'Start a Tier 2 session (collaborative: plan + implementation review)',
        'Tier 2',
      );
      registerCommandHook(
        opencodeConfig,
        'tier2.5',
        'Start a Tier 2.5 session (plan-gate only: oracle reviews the plan, no post-implementation review)',
        'Tier 2.5',
      );
      registerCommandHook(
        opencodeConfig,
        'tier3',
        'Start a Tier 3 session',
        'Tier 3',
      );
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

      const tierNum =
        input.command === 'tier2.5'
          ? 2.5
          : parseInt(input.command.replace('tier', ''), 10);
      output.parts.push({ type: 'text', text: getTierPrompt(tierNum, task) });
    },
  };
}
