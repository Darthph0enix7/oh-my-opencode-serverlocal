---
name: tier2-workflow
description: Sophisticated ideation and planning. Mandatory roundtable tool usage for vision expansion before technical implementation.
---

# Tier 2 Workflow: Ideation & Planning

Tier 2 is a high-value, high-performance workflow designed for vision expansion, feature ideation, and resolving highly ambiguous technical directions BEFORE implementation begins.

## Core Contract
- **State Management:** Create and maintain `.slim/tier_state/<short-task-slug>.md`. Ensure git ignore rules are set. Keep OpenCode todos synced.
- **MANDATORY Roundtable Ideation:** The user has provided a vision or basic idea. You MUST FIRST invoke the \`roundtable\` tool (`roundtable({ query: "...", maxRounds: 5 })`) to ideate, get creative feature suggestions, and refine the perfected version of the user's vision.
- **Technical Translation:** Once the roundtable outputs its Council Report, translate its findings into a concrete technical implementation plan in your state file.
- **Mandatory Plan Review:** Call `@oracle` to review your technical translation of the roundtable's plan.
- **Implementation & Final Review:** Proceed with implementation. Call `@oracle` for a final code review at the end.

## Documentation Structure
Your `.slim/tier_state/<short-task-slug>.md` file MUST follow this standard structure:

### 1. Initial Vision
The raw goal or idea provided by the user.

### 2. Roundtable Council Report
Record the synthesized results from the `roundtable` debate (Decision, Dissent, Open Questions).

### 3. Technical Translation & Oracle Review
- The concrete technical plan derived from the roundtable report.
- **Oracle Review Notes:** `@oracle`'s critique of the technical plan.

### 4. Execution Log
Phases, task IDs, and parallel workers used.

### 5. Final Oracle Review & Validation
Record the final sign-off from `@oracle` and validation results.
