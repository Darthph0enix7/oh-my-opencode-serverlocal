# oh-my-opencode-serverlocal — Agent Coding Guidelines

Customized fork of **alvinunreal/oh-my-opencode-slim** maintained by Adam (serverlocal).
Upstream: https://github.com/alvinunreal/oh-my-opencode-slim
Our fork: https://github.com/Darthph0enix7/oh-my-opencode-serverlocal

## What this fork is

A drop-in replacement for oh-my-opencode-slim that we own end-to-end. All upstream
inbound merges are manual (we don't auto-pull). All customization changes are
written by us and shipped under the npm name `oh-my-opencode-serverlocal`.

The upstream `AGENTS.md` covers build/test/lint conventions. This file covers the
**serverlocal-specific workflow** for our fork.

## Quick reference

| Task | Command |
|------|---------|
| Rebuild dist locally | `./scripts/build.sh` or `./scripts/build.sh --fast` |
| Stage dist to OpenCode cache (no publish) | `./scripts/dev.sh` |
| Run lint + types + tests | `./scripts/check.sh` |
| Publish patch/minor/major to npm | `./scripts/publish.sh patch` |
| Pull upstream changes | `./scripts/sync-upstream.sh merge` |
| Install published version locally | `./scripts/install-local.sh` |

After any of the above that change `dist/`, restart OpenCode:
```bash
op restart
```

## Customization workflow

When tweaking a prompt, behavior, or command:

1. **Edit the source** — changes happen in `src/`, never `dist/`.
   For example, orchestrator prompt: `src/agents/orchestrator.ts`.
   For council system: `src/council/`.
   For hooks: `src/hooks/`.
2. **Build** — `./scripts/build.sh` (or `--fast` during iteration).
3. **Stage to cache** — `./scripts/dev.sh` (overwrites the cache with the
   newly-built `dist/`).
4. **Restart** — `op restart`.
5. **Test** in OpenChamber or via `opencode attach`.
6. **Iterate**: edit → rebuild → dev.sh → restart — loop until satisfied.
7. **Ship** — once happy:
   ```bash
   ./scripts/check.sh              # gates
   ./scripts/publish.sh patch      # bumps version, publishes to npm, primes cache
   op restart                       # picks up the new published version
   ```

## Pulling upstream changes (when we want them)

We generally **don't** auto-pull upstream. When we want a specific upstream change:

```bash
./scripts/sync-upstream.sh fetch   # see what's new on upstream
# (read log, decide if we want it)
./scripts/sync-upstream.sh merge   # merges; expect conflicts in:
                                    #   - src/agents/    (prompts differ)
                                    #   - src/hooks/     (we've added hooks)
                                    #   - src/index.ts   (entry point)
                                    #   - package.json   (different name/keys)
./scripts/check.sh                 # make sure nothing broke
./scripts/dev.sh                   # rebuild + cache
```

Resolve any conflicts, then publish as you would for a customization.

## Publishing

We publish to **npm public registry** under the name `oh-my-opencode-serverlocal`.
The README and AGENTS.md from upstream are kept verbatim where they apply to our
fork; everything else is fair game to modify.

Publishing pipeline (in `./scripts/publish.sh`):
1. `npm version <bump>` — bumps version in `package.json`
2. `bun run build` — fresh `dist/`
3. `bun test --bail` — last sanity gate
4. `git commit + push` — version bump + dist push to fork
5. `npm publish --access public --otp=$OTP` — public registry
6. `npm install -g` + cache prime — local install

OpenCode's auto-update checker queries npm for `oh-my-opencode-serverlocal` on
startup. Once a new version is published, all devices get it within ~30 seconds.

## Sync to other devices (opencode-dotfiles)

The fork's source lives at `~/open-code-projects/oh-my-opencode-serverlocal/` on
the canonical device (serverlocal). The compiled `dist/` is intentionally NOT
synced through opencode-dotfiles — instead we publish to npm and let OpenCode's
auto-update pull it.

What IS in opencode-dotfiles:
- `/home/adam/.config/opencode/opencode.jsonc` — the plugin array, which
  references `oh-my-opencode-serverlocal` (not upstream `oh-my-opencode-slim`)
- `/home/adam/.config/opencode/oh-my-opencode-slim.jsonc` — the plugin
  config (presets, disabled_agents, custom agents)
- Our custom agents at `/home/adam/.config/opencode/agents/*`

## Conventions (inherited from upstream AGENTS.md)

This fork follows the upstream coding conventions exactly:

- **Formatter/Linter:** Biome (configured in `biome.json`)
- **Line width:** 80 characters
- **Indentation:** 2 spaces
- **Quotes:** Single quotes in JS/TS
- **Trailing commas:** Always
- **TypeScript:** Strict mode, no explicit `any` outside tests
- **Tests:** Bun test (1426 tests across 83 files in the upstream baseline)

Always run `./scripts/check.sh` before publishing.

## What we plan to redo (roadmap)

Some prompt rewrites and structural changes are planned for future versions.
Discuss before starting any:

| Area | What we want |
|------|--------------|
| Orchestrator | Custom debate-aware routing — see if we want to integrate @roundtable |
| Council | Custom councillor roles (skeptic/pragmatist/architect) replacing the stock @council flow |
| Hooks | Drop hooks we don't use, add serverlocal-specific ones |
| Skills | Replace `oh-my-opencode-slim` skill with `serverlocal` skill pointing at our customizations |
| Commands | Reorganize `/preset`-style commands to match our dotfiles workflow |

All changes are tracked in version bumps and visible in `git log`.
