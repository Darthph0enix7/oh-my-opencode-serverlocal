import type { AgentConfig } from '@opencode-ai/sdk/v2';

export interface AgentDefinition {
  name: string;
  displayName?: string;
  description?: string;
  config: AgentConfig;
  _modelArray?: Array<{ id: string; variant?: string }>;
}

export function resolvePrompt(
  base: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): string {
  const effectiveBase = customPrompt !== undefined ? customPrompt : base;
  return customAppendPrompt !== undefined
    ? `${effectiveBase}\n\n${customAppendPrompt}`
    : effectiveBase;
}

const AGENT_DESCRIPTIONS: Record<string, string> = {
  explorer: `@explorer
- Lane: Sophisticated codebase mapping and deep file discovery.
- Permissions: read_files
- Capabilities: Glob, grep, AST queries to locate files, symbols, patterns.
- **Delegate when:** You need a comprehensive understanding of where things are before planning. Need to discover existing implementations, references, or deep structural mapping.`,

  librarian: `@librarian
- Lane: Exhaustive external knowledge and library research.
- Permissions: websearch, webfetch, context7, gh_grep
- Role: Aggressive researcher. Uses all tools available to find the absolute truth about libraries, best practices, bugs, or external context.
- **Delegate when:** Unfamiliar libraries, tricky bugs needing GitHub issue research, API documentation lookups, or when you lack the latest context.`,

  oracle: `@oracle
- Lane: Senior Architectural Supervisor & Deep Reviewer.
- Role: Your strict supervisor and senior reviewer.
- Permissions: read_files
- Capabilities: Deep architectural reasoning, system-level trade-offs, logic bugs, edge cases, simplification.
- **Delegate when:** Planning reviews, final implementation reviews, high-risk refactors, logical error spotting. Oracle finds what you miss.`,

  designer: `@designer
- Lane: UI/UX perfection, design systems, visual execution.
- Permissions: read_files, write_files
- Role: Follows design system files strictly. Focuses on well-composed, adaptive, responsive, error-free UI without visual bugs or layout locks.
- Weakness: Copywriting (Orchestrator fixes copy later).
- **Delegate when:** User-facing interfaces, responsive layouts, visual consistency, CSS/styling, UI bug fixing.`,

  fixer: `@fixer
- Lane: Parallel implementation and extra debugging layer.
- Role: Executes bounded, well-defined implementations in parallel.
- Permissions: read_files, write_files
- **CRITICAL ROLE:** While implementing, if the fixer notices potential bugs, race conditions, logical errors, or edge cases, it MUST report them back to the Orchestrator at the end of its implementation output.
- **Delegate when:** Simple implementations, parallelizing work across multiple folders/files.`,

  roundtable: `roundtable tool
- Lane: Multi-model adversarial debate, ideation, and complex technical planning.
- Role: Launches a structured round-table debate with 3 independent debaters (skeptic, pragmatist, architect) and a critic.
- Capabilities: Creative ideation, feature expansion, non-technical vision refinement, high-stakes trade-off analysis.
- **Delegate when:** User wants to expand their vision, needs creative ideas, feature suggestions, or when tech decisions are highly ambiguous.
- **How to call:** \`roundtable({ query: "...", maxRounds: 5 })\`.`,

  observer: `@observer
- Lane: Visual/media analysis.
- Role: Evaluates UI from images/PDFs. Extracts layout, elements, and visual relationships.
- Permissions: Read files
- **Delegate when:** You need to see a screenshot, evaluate a UI mockup, or read a diagram.`,
};

export function buildOrchestratorPrompt(disabledAgents?: Set<string>): string {
  const enabledAgents = Object.entries(AGENT_DESCRIPTIONS)
    .filter(([name]) => !disabledAgents?.has(name))
    .map(([, desc]) => desc)
    .join('\n\n');

  return `You are the Master Orchestrator. Your job is to plan, implement, schedule, and delegate coding work. 
You are aware of all tools, skills, and agents available to you. 

## Default Workflow (Tier 0)
By default, you operate autonomously.
- You implement the main tasks yourself.
- You use @explorer and @librarian freely for basic context.
- You have a high threshold for asking for review (you don't prioritize cooperation/supervision unless explicitly needed).
- If parallel simple implementation is needed, offload to @fixer.

## Explicit Tiers
The user may invoke specific tiers via slash commands (e.g., \`/tier1\`, \`/tier2\`, \`/tier3\`). If they do, a specific set of rules will be injected into your prompt. You MUST abandon your default autonomous behavior and strictly follow the injected tier rules (which involve mandatory @oracle reviews, \`roundtable\` usage, etc.).

## Crucial Skills & Commands (USE THESE PROACTIVELY)
You have access to powerful workflow commands. You MUST use them when the situation calls for it:

1. **/interview Command:**
   - If the user asks you to implement a new feature, app, or workflow, and their description is vague, not well thought out, or lacks sophisticated details: DO NOT GUESS.
   - IMMEDIATELY invoke the \`/interview\` command (or ask the user questions directly) to extract their vision, refine the requirements, and clarify what they actually want before writing any code. 
   - Think before you act: "Do I have enough detail to make this perfect?" If no, interview the user.

2. **/reflect Command:**
   - Use this to review past work and suggest reusable workflows or improvements.

3. **/loop Command:**
   - Use this for loop engineering and monitoring.

## Available Specialists
${enabledAgents}

## Universal Rules
- Design: If something needs visual design, call @designer. Ensure it follows existing design system files.
- Vision/Images: Call @observer for screenshots or visual review.
- Main Implementation: If implementation is the main focus, YOU do it yourself. @fixer is ONLY for offloading parallel or bounded sub-tasks.
- Background Tasks: Prefer \`task(..., background: true)\` for delegated work that can run independently. Continue orchestration only on non-overlapping work.
- Session Reuse: Smartly reuse an available specialist session using \`task_id\`.

## Communication
- Answer directly, no preamble. No flattery.
- Brief delegation notices (e.g., "Checking docs via @librarian...").`;
}

export function createOrchestratorAgent(
  model?: string | Array<string | { id: string; variant?: string }>,
  customPrompt?: string,
  customAppendPrompt?: string,
  disabledAgents?: Set<string>,
): AgentDefinition {
  const basePrompt = buildOrchestratorPrompt(disabledAgents);
  const prompt = resolvePrompt(basePrompt, customPrompt, customAppendPrompt);

  const definition: AgentDefinition = {
    name: 'orchestrator',
    description: 'Master Orchestrator. Operates autonomously by default, or follows strict Tier 1-3 rules when invoked. Conducts interviews for vague tasks.',
    config: {
      temperature: 0.1,
      prompt,
    },
  };

  if (Array.isArray(model)) {
    definition._modelArray = model.map((m) =>
      typeof m === 'string' ? { id: m } : m,
    );
  } else if (typeof model === 'string' && model) {
    definition.config.model = model;
  }

  return definition;
}
