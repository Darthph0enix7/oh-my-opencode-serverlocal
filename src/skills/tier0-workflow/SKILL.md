---
name: tier0-workflow
description: Fast, direct implementation workflow for routine tasks. Basic state documentation, low cooperation overhead.
---

# Tier 0 Workflow: Basic Mode

Tier 0 is the default workflow for fast, direct implementation. Use it when the task is clear, routine, and does not require heavy supervision or ideation.

## Core Contract
- **State Management:** You must create and maintain a progress file at `.slim/tier_state/<short-task-slug>.md`.
- **Git Ignore:** Before creating the state file, ensure `.gitignore` contains `.slim/tier_state/` and `.ignore` contains `!.slim/tier_state/` and `!.slim/tier_state/**`.
- **Implementation:** You (Orchestrator) do the main implementation work. Use `@fixer` only for parallelizing simple, scoped file modifications across different folders.
- **Review:** High threshold for asking for review. No mandatory `@oracle` review is required unless you encounter a critical roadblock.
- **Research:** Use `@explorer` and `@librarian` freely for basic context gathering.
- **Design:** If visual design is needed, call `@designer`. For vision extraction from images, call `@observer`.

## Documentation Structure
Your `.slim/tier_state/<short-task-slug>.md` file MUST follow this standard structure:

### 1. Goal
A concise statement of what needs to be implemented.

### 2. Context
Any researched facts, library documentation links from `@librarian`, or structural maps from `@explorer`. (Do not paste full file contents, use paths).

### 3. Execution Plan
A simple checklist of files to modify and steps to take. Keep OpenCode todos synced with this plan.

### 4. Implementation Log
Record task IDs of any spawned background sub-agents (e.g., `@fixer`). Record terminal results and completed steps.

### 5. Final Validation
A brief note confirming the code runs and meets the goal.
