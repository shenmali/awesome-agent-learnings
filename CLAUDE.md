# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`agent-learnings` is a zero-dependency Node.js CLI (TypeScript, ESM) that installs an agent skill for Codex, Claude Code, and OpenCode. It stores human-approved "learnings" (situation / change tried / observed result) as Markdown in the user's repository, and can propose them to a plugin's maintainers as GitHub issues through `gh`. README.md is the user-facing spec. Keep its CLI and storage descriptions in sync with code changes.

## Commands

```sh
npm ci
npm run build                 # tsc -> dist/ (this is also the typecheck; strict mode)
npm test                      # build, then `node --test` over test/*.test.mjs
npm pack --dry-run            # CI also runs this; checks published contents (dist, README, LICENSE)

# Single file / single test (tests import ../dist, so build first)
npm run build && node --test test/core.test.mjs
npm run build && node --test --test-name-pattern="manual body edits" test/core.test.mjs

node dist/cli.js --help       # run the built CLI locally
```

No linter or formatter is configured. CI runs `npm ci && npm test && npm pack --dry-run` on ubuntu, macOS, and Windows with Node 20, 22, and 24. Code must therefore run on Node 20 and handle Windows paths and CRLF line endings.

## Architecture

- `src/cli.ts` is the entry point (`bin`). It parses arguments by position as `[command, action, value, extra]`. For `share`, `action` is the learning id and `value` is the flag. It calls `main()` at module load, so importing it runs the CLI. Tests use it only by spawning `dist/cli.js`.
- `src/project.ts` (`findProjectRoot`) walks up from cwd to the nearest directory containing `.git` and falls back to cwd. All commands resolve this root first. Learnings always live in the project, including with `init --scope user`.
- `src/store.ts` holds all validation and persistence, under `<root>/.agent-learnings/`:
  - `config.json`: `{ schemaVersion: 1, targets: { <id>: { repo: "owner/repo" } } }`. Target ids match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Lookups use `Object.hasOwn`, which keeps prototype keys out. `normalizeRepo` accepts only `owner/repo` or a plain `https://github.com/...` URL.
  - `learnings/<YYYYMMDD>-<8 hex>.md`: front matter with one `key: <JSON value>` per line. The approved text sits in a `content` JSON object. `parseLearning` re-renders the Markdown body from the metadata and **throws if the file body differs**, so a hand-edited body cannot be silently published. As a result, any change to `renderBody` or `renderLearning` makes existing records unreadable. Treat those functions as an on-disk format.
  - New records are written with `flag: 'wx'` and are never overwritten. Updates go through `writeReplace`: write a temp file, then rename, falling back to copy on `EPERM`/`EXDEV` for Windows.
- `src/github.ts` handles sharing. All `gh` calls go through an injectable `GhRunner`, whose default is `runGh` (`execFile`). Tests pass fake runners and never call real `gh`.
  - `prepareIssue` builds the preview. `publishIssue` and `attachIssue` run inside a per-learning `<id>.share.lock` created with `open(..., 'wx')`, and both refuse a learning that already has an `issueUrl`.
  - The issue body goes to `gh` through `--body-file` (a temp file), never through `--body`.
  - When `gh` is missing (`ENOENT`) or reports an auth error in stderr, the code returns manual-submission text instead of throwing. Any other non-zero exit throws.
  - Issue URLs from `gh` stdout or `--attach` must match `https://github.com/<mapped repo>/issues/<n>`.
- `src/install.ts` (`initSkills`) generates two `SKILL.md` files and never overwrites existing ones:
  - `.agents/skills/agent-learnings/` for Codex and OpenCode, with `opencode/*` metadata.
  - `.claude/skills/agent-learnings/` with `disable-model-invocation: true`.
  - Project scope pins `npx --yes agent-learnings@<version>`, reading the version at runtime from `../package.json` relative to `dist/`. A version bump changes generated skills and requires updating the `0.1.0` assertion in `test/core.test.mjs` and the README.

## Conventions

- ESM with `module: NodeNext`, so relative imports in `src/` need `.js` extensions.
- Keep the package free of runtime dependencies (Node built-ins only).
- Platform values (`codex | claude | opencode`) are repeated in several places: the `Platform` type and `requirePlatform` in `store.ts`, the interactive prompt in `cli.ts`, and the README. Adding a platform means updating all of them.
- Tests are plain `.mjs` files using `node:test` and `node:assert/strict`. Each test runs in a fresh `mkdtemp` directory.
