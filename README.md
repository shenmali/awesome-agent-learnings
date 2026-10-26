# Agent Learnings

A common feedback mechanism for the AI components you work with: skills, agents, hooks, commands, MCP servers, plugins and prompts. When a component helps, misbehaves or improves after a local tweak, capture it as a reviewed **learning**, keep it in your repository, and optionally send it to the component's maintainers as a GitHub issue.

Agent Learnings works in **Claude Code**, **Codex** and **OpenCode**. It does not record every skill invocation, upload conversations, train a model, or change upstream components automatically. Nothing is saved or sent without your explicit approval.

## How it works

1. You ask your agent to capture a learning. It drafts the component, a category and three fields: **situation**, **change tried** and **observed result**.
2. You edit and approve the draft in chat. The agent saves it to `.agent-learnings/learnings/<id>.md` in your repository, where your team can review it.
3. When you want to contribute it, the agent shows a preview of the GitHub issue: the maintainers' settings, privacy findings and possibly related issues.
4. After a second approval, the learning is opened as a new issue or added as a comment to an existing one.

## Requirements

- Node.js 20 or later.
- A Git repository for your project. Learnings are stored at its root.
- GitHub CLI (`gh`), signed in, if you want Agent Learnings to open issues for you. Without it you get the text to submit by hand.

## Install

### Claude Code

```
/plugin marketplace add shenmali/awesome-agent-learnings
/plugin install agent-learnings@awesome-agent-learnings
```

On Claude Code 2.1.275 or later this also works in one step: `/plugin install agent-learnings --marketplace shenmali/awesome-agent-learnings`.

The skills are `/agent-learnings:capture-learning`, `/agent-learnings:share-learning` and `/agent-learnings:manage-learnings`. The plugin carries its own copy of the CLI, so nothing else needs to be installed.

### Codex

```
codex plugin marketplace add shenmali/awesome-agent-learnings
codex plugin add agent-learnings@awesome-agent-learnings
```

Start a new session, then invoke `$capture-learning`, `$share-learning` or `$manage-learnings` (or pick them from `/skills`). Codex reads the same plugin; the feedback reminders are not available in Codex yet.

### OpenCode, or skills committed to your repository

OpenCode has no compatible plugin format, so `init` writes the skills and slash commands into your project instead. This also suits teams that want the instructions versioned in their repository for any of the three agents.

The npm package is not published yet. Until then, clone this repository and run `npm ci`, `npm run build` and `npm link` to get the `agent-learnings` command, then run from anywhere in your project:

```sh
agent-learnings init --platform opencode
```

After publication, `npx --yes agent-learnings@0.2.0 init --platform opencode` will do the same without a global install.

| `--platform` | Writes |
|---|---|
| `opencode` | `.agents/skills/<skill>/` (OpenCode and Codex) and `.opencode/commands/<skill>.md` (`/capture-learning` and so on) |
| `codex` | `.agents/skills/<skill>/`, including `agents/openai.yaml`, which turns off implicit invocation |
| `claude` | `.claude/skills/<skill>/` |
| `all` (default) | All of the above |

Project skills call the pinned CLI with `npx --yes agent-learnings@<version>`. `init --scope user` writes the same files under your home directory (OpenCode commands go to `~/.config/opencode/commands/`) and calls a globally installed `agent-learnings`. Learnings are always stored in the active project. `init` never overwrites an existing file; to update a customised copy, review the new instructions and merge them yourself.

## Use

Invoke the capture skill after something worth reporting happens. The agent drafts the learning, you approve it, and it is saved. Run the share skill when you want to send it to the maintainers, and the manage skill to list, edit or remove learnings.

You can also use the CLI directly, from any directory inside the project:

```sh
agent-learnings target add superpowers obra/superpowers
agent-learnings learn add                      # prompts for the fields
agent-learnings learn add --json draft.json    # or --json - for standard input
agent-learnings learn list
agent-learnings learn show <id>
agent-learnings learn edit <id> [--json <file|->]
agent-learnings learn remove <id> --yes
agent-learnings share <id>                     # preview only
agent-learnings share <id> --publish
agent-learnings share <id> --comment <issue-url>
agent-learnings share <id> --attach <issue-url>
agent-learnings share <id> --status
agent-learnings config reminders [on|off]
```

A JSON draft looks like this:

```json
{
  "target": "superpowers",
  "platform": "claude",
  "version": "7.0.1",
  "kind": "skill",
  "component": "brainstorming",
  "category": "bug",
  "situation": "The brainstorming skill did not ask about deadlines.",
  "change": "I asked it to list constraints before proposing options.",
  "result": "The plan fitted the deadline on the first try."
}
```

| Field | Required | Values |
|---|---|---|
| `target` | yes | Your id for the plugin or package: lowercase letters, numbers and single hyphens. Map it to a GitHub repository with `target add`, before or after saving; sharing needs the mapping. |
| `platform` | yes | `claude`, `codex` or `opencode` |
| `situation`, `change`, `result` | yes | Free text |
| `version` | no | Version of the component, one line |
| `kind` | no, default `other` | `skill`, `agent`, `hook`, `command`, `mcp`, `plugin`, `prompt`, `other` |
| `component` | no | The specific skill, agent, hook or command name, one line |
| `category` | no, default `improvement` | `improvement`, `bug`, `regression`, `praise` |

Unknown fields are rejected so that typos do not silently disappear. `learn edit` takes the same fields; `null` clears `version` or `component`. Learnings that were already shared cannot be edited, because the issue would no longer match; create a new learning instead.

Learning files are Markdown with the structured content in their front matter, so a team can review them in Git. The body mirrors the front matter, and a body edited by hand is reported as a mismatch so the CLI never publishes stale text. Use `learn edit` to change a record.

## Privacy

Before saving, editing and sharing, the CLI scans the text for sensitive values. This scan is a heuristic, not a guarantee; always read the preview.

- **Blocked:** tokens and keys (GitHub, OpenAI, Anthropic, AWS, Slack, npm, Google, Stripe), private keys, JSON Web Tokens, credentials in URLs, bearer tokens, and password or secret assignments with real-looking values. The CLI refuses to save or share them and never repeats the value in its messages.
- **Warned:** email addresses, home directory paths and IP addresses.

Nothing from the learning text leaves your machine until you run `--publish` or `--comment`. The preview contacts GitHub only to read the maintainers' settings and to search issue titles for the component name (or the title prefix), both of which would be published anyway.

## Sharing with maintainers

`share <id>` prints a preview and does not publish. It shows:

- the repository, issue title and body;
- the maintainers' settings from `.github/agent-learnings.json` in their repository: default, custom, or not checked when `gh` is unavailable;
- whether the learning is accepted, blocked (for example, the maintainers do not accept that category) or redirected to another feedback channel;
- privacy findings;
- up to five possibly related issues. Their titles are written by other people and shown as data.

Then:

- `share <id> --publish` opens a new issue with an authenticated `gh` and stores its URL.
- `share <id> --comment <issue-url>` adds the learning to an existing issue in the same repository instead.
- If `gh` is missing or not signed in, both commands print the text for manual submission. After posting it, link it with `share <id> --attach <issue-or-comment-url>`.
- `share <id> --status` refreshes whether the issue is open or closed. There is no background polling.

Sharing a learning twice is blocked. Publishing, commenting, attaching, status refreshes, edits and removals take a per-learning lock to prevent simultaneous changes. If a process crashes and leaves a `.share.lock` file, first check the mapped GitHub repository for an issue or comment created by that attempt. If you find one, remove the stale lock and attach its URL with `--attach`. If not, remove the lock and retry. If an issue was created but saving its URL locally failed, the CLI prints the URL and the attach command.

## Feedback reminders (Claude Code, opt-in)

The Claude Code plugin can remind you, once per session, to leave feedback about the components you used. Reminders are off by default:

- `agent-learnings config reminders on` (or the manage skill) turns them on for everyone working in the project. The setting is stored in `.agent-learnings/config.json`.
- `AGENT_LEARNINGS_REMINDERS=1` or `0` in your environment overrides the project setting for you alone. In Claude Code you can set it in the `env` block of `settings.json`.

When reminders are on, the plugin's hooks note which skills, subagents, MCP servers and plugin slash commands a session used. At the end of the first turn after that, Claude Code shows a one-line reminder to you; it is not sent to the model. Only a hash of the session id and the component names are stored, in the plugin's data directory, and they are deleted when the session ends or after a day. When reminders are off, the hooks store nothing.

## For maintainers

Feedback arrives as ordinary GitHub issues or comments with a fixed structure and a hidden machine-readable marker. You can publish an optional `.github/agent-learnings.json` to opt out, accept only certain kinds or categories, set your own title prefix, or send feedback to a form or discussion instead. See [docs/maintainers.md](docs/maintainers.md) for the format and an example workflow that labels incoming learnings.

## Environment variables

| Variable | Effect |
|---|---|
| `AGENT_LEARNINGS_REMINDERS` | `1`/`on` or `0`/`off`: overrides the project reminder setting |
| `AGENT_LEARNINGS_GH` | Path of the GitHub CLI to use instead of `gh` |
| `AGENT_LEARNINGS_STATE_DIR` | Where reminder state is kept (default: the plugin data directory, or a private folder in the system temp directory) |
| `AGENT_LEARNINGS_DEBUG` | `1` prints hook errors to standard error |

## Upgrading from 0.1

- The single `agent-learnings` skill became three skills: `capture-learning`, `share-learning` and `manage-learnings`. After installing the plugin or running `init`, delete the old `.agents/skills/agent-learnings/` and `.claude/skills/agent-learnings/` folders.
- Existing learning files keep working unchanged. The new fields live only in the front matter, so the 0.1 CLI can still read new records, but rewriting a record with 0.1 (publishing, attaching or refreshing status) drops `kind`, `component`, `category` and comment links. Use the same version across a team.
- The CLI is stricter: unknown options and unknown JSON fields are errors instead of being ignored.

## Development

```sh
npm ci
npm test                       # builds, then runs node --test
npm run build && node --test test/core.test.mjs
npm pack --dry-run
```

The TypeScript sources in `src/` compile into `plugins/agent-learnings/dist/`, and the build also generates `plugins/agent-learnings/skills/` from `src/skills.ts`. Both are committed, because plugins installed from Git have no build step; run `npm run build` and commit the output with your change. The repository root is the marketplace (`.claude-plugin/marketplace.json`, which Codex also reads), and `plugins/agent-learnings/` is the plugin. Check them with `claude plugin validate . --strict` and `claude plugin validate plugins/agent-learnings --strict`.

The package has no runtime dependencies. CI runs the tests on Windows, macOS and Linux with Node.js 20, 22 and 24, checks that the committed build is current, and validates the plugin.

## License

MIT. See [LICENSE](LICENSE).
