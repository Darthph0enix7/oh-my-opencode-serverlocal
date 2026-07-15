---
name: tier3-workflow
description: The "All Out" Tier. Complex implementation with continuous Oracle supervision and Roundtable ambiguity resolution.
---

# Tier 3 Workflow: Complex Implementation

Tier 3 is the highest level of execution for massive, complex, and highly ambiguous implementations. It utilizes every available tool and agent to ensure perfection.

## Core Contract
- **State Management:** Create and maintain `.slim/tier_state/<short-task-slug>.md`. Ensure git ignore rules are set. Keep OpenCode todos synced.
- **Continuous Supervision:** Work with `@oracle` for continuous, strict supervision. Ask for reviews not just at the beginning and end, but during major implementation milestones.
- **MANDATORY Ambiguity Resolution:** If, during implementation, the task has multiple perspectives, unexpected roadblocks, or it is not clearly decidable what the best course of action is, you MUST invoke the \`roundtable\` tool (`roundtable({ query: "..." })`) to decide the path forward.
- **Full Agent Utilization:** Offload parallel known tasks to `@fixer`. Use `@designer` for all UI. Aggressively use `@explorer` and `@librarian`.

## Documentation Structure
Your `.slim/tier_state/<short-task-slug>.md` file MUST follow this standard structure:

### 1. Master Goal & Context
The overarching objective and deep context gathered from specialists.

### 2. Strategic Plan & Oracle Sign-off
The high-level architectural plan and the initial `@oracle` review.

### 3. Phased Implementation Log
For each major phase:
- **Phase Goal**
- **Ambiguity Checks:** If a roadblock occurred, record the `roundtable` Council Report used to resolve it.
- **Execution:** Task IDs and parallel workers.
- **Mid-point Reviews:** `@oracle` spot-check notes.

### 4. Final Oracle Review & Validation
Record the final, rigorous sign-off from `@oracle` and comprehensive validation results.
