# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`agent-learnings` is a common feedback mechanism for AI components (skills, agents, hooks, commands, MCP servers, plugins, prompts). It is a zero-dependency Node.js CLI (TypeScript, ESM) plus plugin packaging for Claude Code, Codex and OpenCode. Users capture human-approved "learnings" (situation / change tried / observed result) as Markdown in their repository and can share them with the component's maintainers as GitHub issues or comments through `gh`. README.md is the user-facing spec and docs/maintainers.md specifies the maintainer settings file and issue marker; keep both in sync with code changes.

## Commands

```sh
npm ci
npm run build                 # tsc -> plugins/agent-learnings/dist, then scripts/sync-plugin.mjs regenerates plugins/agent-learnings/skills
npm test                      # build, then `node --test` over test/*.test.mjs
npm pack --dry-run            # CI also runs this

# Single file / single test (tests import the compiled output, so build first)
npm run build && node --test test/core.test.mjs
npm run build && node --test --test-name-pattern="manual body edits" test/core.test.mjs

node plugins/agent-learnings/dist/cli.js --help
claude plugin validate . --strict                         # marketplace
claude plugin validate plugins/agent-learnings --strict   # plugin
```

No linter or formatter is configured; `npm run build` is the strict typecheck. CI runs on ubuntu, macOS and Windows with Node 20, 22 and 24, so code must run on Node 20 and handle Windows paths and CRLF. CI also fails if the committed build differs from a fresh one (`git diff --exit-code -- plugins/agent-learnings`).

## Layout and build output

- The repository root is a marketplace: `.claude-plugin/marketplace.json` (Codex reads it too) points at `plugins/agent-learnings/`, which is the plugin. The plugin directory deliberately has no package.json: with package.json plus a lockfile, Claude Code would install the dev dependencies into every user's plugin cache.
- `plugins/agent-learnings/dist/` (compiled CLI) and `plugins/agent-learnings/skills/` (generated from `src/skills.ts`) are **committed**, because git-installed plugins get no build step. Rebuild and commit them with every source change; `test/plugin.test.mjs` fails when the skills are stale.
- `packageVersion()` reads the version from `plugins/agent-learnings/.claude-plugin/plugin.json` (shipped in the plugin and in the npm package). A test keeps `package.json`, both plugin manifests and the marketplace entry consistent. A version bump changes the `npx --yes agent-learnings@<version>` command in skills written by `init`.

## Architecture

- `src/cli.ts` is the entry point (`bin`). It parses arguments with `node:util` `parseArgs` (strict, one shared options table). Each command checks its positional count and allowed flags with `expect()`, so unknown or misplaced flags are errors. It runs at module load: `hook ...` goes to `hookMain` (never fails, 2 s watchdog), everything else to `main()`. Tests use it only by spawning the built `cli.js`.
- `src/project.ts`: `findProjectRoot` walks up to the nearest directory containing `.git` (falls back to cwd). All data lives under `<root>/.agent-learnings/`, including with `init --scope user`.
- `src/store.ts` holds validation and persistence:
  - `config.json`: `{ schemaVersion: 1, targets: { <id>: { repo } }, reminders?: boolean, mode?: 'manual' | 'auto' }`. Unknown keys are preserved; target lookups use `Object.hasOwn`.
  - `learnings/<YYYYMMDD>-<8 hex>.md`: one `key: <JSON value>` front-matter line per field (keys must match `^[A-Za-z]+$`), approved text in a `content` object. `parseLearning` re-renders the body and **throws if the file body differs**. `renderBody` is a frozen on-disk format: new fields (`kind`, `component`, `category`, `origin`, `commentUrl`) go in the front matter only, and are written only when set, so 0.1.0 records round-trip byte for byte. Defaults (`kind` other, `category` improvement) are applied at read time by `effectiveKind`/`effectiveCategory`, never written.
  - `normalizeInput` rejects unknown fields. New records use `flag: 'wx'`; rewrites go through `writeReplace` (temp file + rename, copy fallback on EPERM/EXDEV).
  - `withLearningLock` (`<id>.share.lock`, created with `open(..., 'wx')`) guards publish, comment, attach, status refresh, `editLearning` and `removeLearning`. `updateLearning` is the lock-free internal writer for share state; callers hold the lock.
- `src/privacy.ts`: regex scan with `block` findings (tokens, keys, credentials) that `assertNoSecrets` turns into errors on add, edit and every share path, and `warn` findings (email, home paths, IPs). Messages carry hints, never the value; tests build fake secrets by string concatenation so secret scanners do not flag them.
- `src/manifest.ts`: parses maintainer settings (`.github/agent-learnings.json`) strictly and decides the `Policy` (accepted / blocked / redirect). No free-text fields by design.
- `src/github.ts`: all `gh` calls go through an injectable `GhRunner` (default `runGh`, which honours `AGENT_LEARNINGS_GH`). `previewShare` fetches the manifest and searches related issues using only the component name or title prefix; GitHub text is cleaned of control and bidi characters. `publishIssue`/`commentIssue` share `shareable()` checks, send the body through `--body-file`, fall back to manual-submission text when `gh` is missing (`ENOENT`) or unauthenticated, and validate URLs with `parseIssueUrl`. Issue bodies end with an escaped `<!-- agent-learnings {...} -->` marker.
- `src/reminders.ts`: opt-in reminders and auto mode behind `hook <platform:Event>`. Settings resolve env (`AGENT_LEARNINGS_REMINDERS`, `AGENT_LEARNINGS_MODE`) over `config.json`. In auto mode the first Stop of a session that used a component returns `decision: block` with `autoCaptureInstructions` (from `skills.ts`), skipped when `stop_hook_active`; the agent then saves with `learn add --auto` (front matter `origin: "auto"`). Publishing is never automatic: `share --pending` previews auto-saved learnings and `share <id>... --publish` sends the approved batch. The `claude` adapter maps PostToolUse (Skill, Agent/Task, `mcp__*`), UserPromptExpansion, Stop and SessionEnd; state is a hashed session file holding component names only. `runHook` never throws. Hook wiring lives in `plugins/agent-learnings/hooks/hooks.json`; `test/plugin.test.mjs` checks that its events match `claudeEvents`.
- `src/skills.ts` is the single source of the agent instructions: `pluginFiles()` for the plugin, `renderSkill`/`renderOpencodeCommand`/`renderOpenaiYaml` for `src/install.ts` (`init --platform`, which never overwrites files).

## Conventions

- ESM with `module: NodeNext`: relative imports in `src/` need `.js` extensions.
- No runtime dependencies (Node built-ins only).
- Enumerations live in `store.ts` (`platforms`, `kinds`, `categories`); the interactive prompts in `cli.ts`, the skill text in `skills.ts`, README and docs/maintainers.md repeat them.
- Tests are `.mjs` files using `node:test` and `node:assert/strict`, each in a fresh `mkdtemp` directory. GitHub tests use the routed `fakeGh` helper; CLI tests set `AGENT_LEARNINGS_GH` to a missing binary so they never reach the network.
