# Tools & Capabilities

Built-in tools available to agents beyond the standard file and shell operations.

## apply_patch rescue

Slim only intercepts `apply_patch` before the native tool runs. It rewrites recoverable stale patches, canonizes safe tolerant matches against the real file when unicode/trim drift is the only mismatch, keeps the authored `new_lines` bytes intact, preserves the existing file EOL/final-newline state for updates, validates malformed patches strictly before helper execution, uses a conservative bounded LCS fallback, accumulates helper state when the same path appears in multiple `Update File` hunks, blocks `apply_patch` before native execution if any patch path falls outside the allowed root/worktree, and fails on ambiguity instead of guessing. It does not rewrite `edit` or `write` inputs.

---

## Oracle Session (persistent reviews)

| Tool | Description |
|------|-------------|
| `oracle_session` | Consult the oracle agent in a PERSISTENT session — one conversation per user query. The oracle remembers its previous verdicts across repeated reviews within a task. |

`oracle_session` is the single way to consult the oracle (never `task(subagent_type=oracle)`). Lifecycle: a fresh oracle session is created at the start of each user query, auto-continues within it, and resets automatically on the next user message (or via `/fresh`). Returns `{ response, session_id, prompts }`; pass `session_id` to explicitly continue. Bounded: max 10 prompts / 50K estimated tokens per chain, and the session is deleted on reset.

---

## Roundtable (multi-model debate)

Provided by the `opencode-roundtable` plugin. See that plugin's README for full parameter reference.

| Tool | Description |
|------|-------------|
| `roundtable` | Adversarial multi-perspective DEBATE — 3 debaters (skeptic, pragmatist, architect) cross-examine each other across rounds; a critic scores consensus and synthesizes a council report with dissents. Use for trade-off evaluation and decisions. |
| `chorus` | Constructive multi-model BRAINSTORMING — 3 creative lenses (visionary, experiencer, integrator) build on each other's ideas; a curator dedupes, groups themes, spots gems, and detects plateau. Use to EXPAND a vague vision into a menu of feature options. |

Both share the same engine: persistent per-participant sessions (deleted on completion), abort handling (user cancel stops everything via AbortSignal + `session.abort()`), hidden round limits, and mode presets (light/standard/heavy/free). Stop conditions: roundtable = consensus/quality/stall; chorus = idea plateau (< `minNewIdeas` per round).

---

## Web Fetch

Fetch remote pages with content extraction tuned for docs/static sites.

| Tool | Description |
|------|-------------|
| `webfetch` | Fetch a URL, optionally prefer `llms.txt`, extract main content from HTML, include metadata, and optionally save binary responses |

`webfetch` blocks cross-origin redirects unless the requested URL or derived permission patterns explicitly allow them, and it can fall back to the raw fetched content when secondary-model summarization is unavailable.

---

## Code Search Tools

Fast, structural code search and refactoring - more powerful than plain text grep.

| Tool | Description |
|------|-------------|
| `grep` | Fast content search using ripgrep |
| `ast_grep_search` | AST-aware code pattern matching across 25 languages |
| `ast_grep_replace` | AST-aware code refactoring with dry-run support |

`ast_grep` understands code structure, so it can find patterns like "all arrow functions that return a JSX element" rather than relying on exact text matching.

---

## Background Task Control

| Tool | Description |
|------|-------------|
| `cancel_task` | Cancel a tracked background specialist task by native task ID or Background Job Board alias |

`cancel_task` is orchestrator-only. It only cancels background tasks tracked for
the current orchestrator session, and it does not roll back partial edits. After
cancelling a write-capable task, inspect and reconcile file changes before
launching replacement work.

See the background orchestration concepts in
[Background Orchestration](background-orchestration.md) for the session
lifecycle and cancellation edge cases behind this tool.

---

## Formatters

OpenCode automatically formats files after they are written or edited, using language-specific formatters. No manual step needed.

Includes Prettier, Biome, `gofmt`, `rustfmt`, `ruff`, and 20+ others.

> See the [official OpenCode docs](https://opencode.ai/docs/formatters/#built-in) for the complete list.

---
