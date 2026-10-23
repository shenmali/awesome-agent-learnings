# Agent Learnings

Capture useful changes to agent skills and plugins, review them with a person, keep a project history, and optionally propose selected learnings to maintainers through GitHub issues.

Agent Learnings supports **Codex**, **Claude Code**, and **OpenCode**. It does not record every skill invocation, upload conversations, train a model, or change the upstream plugin automatically.

## Requirements

- Node.js 20 or later and npm.
- GitHub CLI (`gh`) only if you want the CLI to create issues for you. Without it, Agent Learnings prepares text for a manual issue.

The source is available at [shenmali/awesome-agent-learnings](https://github.com/shenmali/awesome-agent-learnings). The npm package is not published yet. Until publication, clone this repository and run `npm ci`, `npm run build`, and `npm link` to use the `agent-learnings` command locally.

## Install after npm publication

### Project install

Run from anywhere in your Git repository:

```sh
npx --yes agent-learnings@0.1.0 init --scope project
```

This writes `.agents/skills/agent-learnings/SKILL.md` for Codex and OpenCode, plus `.claude/skills/agent-learnings/SKILL.md` for Claude Code. Commit these files to share the workflow with your team. The skill calls the same CLI version using `npx --yes agent-learnings@0.1.0`, so a global package installation is unnecessary. npm access is needed when the command is first fetched or its cache is empty. For a later release, update the package and review the generated skill instructions before replacing your pinned copies.

### User install

```sh
npm install --global agent-learnings
agent-learnings init --scope user
```

This writes the corresponding skills under your home directory. It does **not** change where learnings are saved: they remain in the active project. A project skill with the same name can take precedence according to the agent's own skill loading rules.

`init` never overwrites an existing skill file. To update a customized copy, review the new instructions and merge them yourself.

## Use

Invoke the `agent-learnings` skill in Codex, `/agent-learnings` in Claude Code, or `/agent-learnings` in OpenCode after a useful experiment. The agent drafts three fields: **situation**, **change tried**, and **observed result**. Review and edit the draft in chat. The agent saves it only after your approval.

You can also use the CLI directly. Run it from any directory inside the project:

```sh
agent-learnings target add superpowers obra/superpowers
agent-learnings learn add
agent-learnings learn list
agent-learnings learn show <learning-id>
agent-learnings share <learning-id>
```

`learn add` prompts for the fields and asks before saving. For agent-driven input, pass a UTF-8 JSON file with `--json <file>` or standard input with `--json -`:

```json
{
  "target": "superpowers",
  "platform": "codex",
  "version": "7.0.1",
  "situation": "A planning run missed a final review gate.",
  "change": "I added an explicit review step to my local workflow.",
  "result": "The review caught a missing test before handoff."
}
```

`target` uses lowercase letters, numbers, and single hyphens. `platform` is `codex`, `claude`, or `opencode`. `version` is optional. The target repository can be mapped before or after saving a learning, but is required for sharing.

### Superpowers example

1. Use a Superpowers skill in a real task and try a local prompt or skill adjustment.
2. Invoke Agent Learnings. Review the proposed situation, change, and observed result in chat.
3. Approve the record; it appears in `.agent-learnings/learnings/<id>.md` in your repository.
4. Map `superpowers` to `obra/superpowers`, then run `agent-learnings share <id>` to review the GitHub issue text.
5. After a separate approval, run `agent-learnings share <id> --publish`. The maintainer decides whether to use the proposal.

The project's `.agent-learnings/config.json` stores repository mappings. Learning files are Markdown so a team can review changes in Git. Only the approved fields are sent to GitHub; inspect them for private project details before publication.

The Markdown body mirrors the structured content in its front matter. Directly editing only the body is detected as a mismatch so the CLI cannot silently publish stale text. To revise an existing record, update the structured content and body together, or create a corrected learning; a dedicated edit command is planned for a later release.

## GitHub sharing and status

`share <id>` prints a preview and does not publish. `share <id> --publish` uses an authenticated `gh` to create an issue and saves its URL. If `gh` is absent or unauthenticated, the command prints a GitHub link and the full issue text for manual submission. After posting manually, link the issue to the record:

```sh
agent-learnings share <id> --attach https://github.com/obra/superpowers/issues/123
agent-learnings share <id> --status
```

Repeated publication of a linked learning is blocked. `--status` requires `gh` and refreshes the issue's open or closed state on request; there is no background polling.

Publishing uses a per-learning lock to prevent simultaneous submissions. If a process crashes and leaves a `.share.lock` file, first check the mapped GitHub repository for an issue created by that attempt. Attach its URL with `--attach` if found, then remove the stale lock. If no issue exists, remove the stale lock before retrying. If an issue was created but saving its URL locally failed, the CLI prints the URL and the attach command.

## Development and release

```sh
npm ci
npm test
npm pack --dry-run
```

The package has no runtime dependencies. CI runs the build and tests on Windows, macOS, and Linux with Node.js 20, 22, and 24. npm publishing requires an npm account and verifying the `agent-learnings` package name is available. Review the package contents before publication.

## License

MIT. See [LICENSE](LICENSE).
