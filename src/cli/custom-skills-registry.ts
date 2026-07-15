/**
 * A custom skill bundled in this repository.
 * Unlike npx-installed skills, these are copied from src/skills/ to the OpenCode skills directory
 */
export interface CustomSkill {
  /** Skill name (folder name) */
  name: string;
  /** Human-readable description */
  description: string;
  /** List of agents that should auto-allow this skill */
  allowedAgents: string[];
  /** Source path in this repo (relative to project root) */
  sourcePath: string;
}

/**
 * Registry of custom skills bundled in this repository.
 */
export const CUSTOM_SKILLS: CustomSkill[] = [
  {
    name: 'simplify',
    description: 'Code simplification and readability-focused refactoring',
    allowedAgents: ['oracle'],
    sourcePath: 'src/skills/simplify',
  },
  {
    name: 'codemap',
    description: 'Repository understanding and hierarchical codemap generation',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/codemap',
  },
  {
    name: 'clonedeps',
    description: 'Clone important dependency source for local inspection',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/clonedeps',
  },
  {
    name: 'verification-planning',
    description:
      'Plan credible, proportionate evidence before non-trivial implementation',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/verification-planning',
  },
  {
    name: 'reflect',
    description:
      'Review repeated work and suggest reusable workflow improvements',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/reflect',
  },
  {
    name: 'oh-my-opencode-serverlocal',
    description:
      'Configure, customize, and safely improve oh-my-opencode-serverlocal setups',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/oh-my-opencode-serverlocal',
  },
  {
    name: 'worktrees',
    description:
      'Manage Git worktrees as OMO safe isolated coding lanes for complex/risky/parallel work',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/worktrees',
  },
  {
    name: 'tier0-workflow',
    description: 'Fast, direct implementation workflow for routine tasks. Basic state documentation, low cooperation overhead.',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/tier0-workflow',
  },
  {
    name: 'tier1-workflow',
    description: 'Guided and supervised workflow. Mandatory Oracle reviews for planning and final implementation.',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/tier1-workflow',
  },
  {
    name: 'tier2-workflow',
    description: 'Sophisticated ideation and planning. Mandatory roundtable tool usage for vision expansion before technical implementation.',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/tier2-workflow',
  },
  {
    name: 'tier3-workflow',
    description: 'The "All Out" Tier. Complex implementation with continuous Oracle supervision and Roundtable ambiguity resolution.',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/tier3-workflow',
  },
];
