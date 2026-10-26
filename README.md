# Agent Learnings

**Turn "this skill just did something great (or terrible)" into feedback its maintainers can actually use.**

Agent Learnings is a common feedback mechanism for the AI components you work with: skills, agents, hooks, slash commands, MCP servers, plugins and prompts. When one of them helps, misbehaves, or gets better after a local tweak, your agent drafts a short, structured **learning**. You review it, it is saved in your repository, and, if you choose, it goes to the component's maintainers as a GitHub issue or comment.

Works in **Claude Code**, **Codex** and **OpenCode**.

- **You decide what is published.** Nothing reaches GitHub without your explicit approval.
- **Manual or automatic saving.** By default you approve every learning before it is saved. In [auto mode](#auto-mode-claude-code), your agent saves worthwhile learnings on its own and you review them all at once before sharing.
- **No transcripts.** Only a short situation, change tried and observed result are stored, never the conversation.
- **No surprise uploads.** Nothing is used for training, and upstream components are never changed automatically.

---

## Contents

- [Why](#why)
- [Use cases](#use-cases)
- [Quick start](#quick-start)
- [Step by step: from experience to issue](#step-by-step-from-experience-to-issue)
- [Auto mode](#auto-mode-claude-code)
- [Feedback reminders](#feedback-reminders-claude-code-opt-in)
- [CLI reference](#cli-reference)
- [What a learning contains](#what-a-learning-contains)
- [Privacy](#privacy)
- [For maintainers](#for-maintainers)
- [Troubleshooting](#troubleshooting)
- [Upgrading from 0.1](#upgrading-from-01)
- [Development](#development)

## Why

Every day, people find out that a skill skips a step, that an agent works much better with one extra instruction, or that a hook breaks on Windows. That knowledge usually disappears with the chat session. When it does reach a maintainer, it is often a vague "it didn't work" without context.

Agent Learnings gives that feedback a common shape:

| Field | Question it answers |
|---|---|
| **Situation** | What were you doing, and what went wrong or well? |
| **Change tried** | What did you change: a prompt, a skill instruction, a setting? |
| **Observed result** | What happened after the change? |

Each learning also says which component it is about (`kind`, `component`), what kind of feedback it is (`category`), and where it was observed (`platform`, `version`). Maintainers get comparable, reproducible reports. Your team gets a reviewable history of what you learned, in Git.

## Use cases

**1. Report a bug in a skill, with the workaround you found**
The `brainstorming` skill keeps ignoring your deadline. You ask it to list constraints first, and the problem disappears. Capture it as a `bug` with that workaround, and the maintainers get both the problem and a candidate fix.

**2. Propose an improvement you have already tested**
You add a review step to a planning skill's instructions locally, and it starts catching missing tests. Record it as an `improvement` before it becomes a forgotten local patch.

**3. Flag a regression after an update**
A subagent behaves worse after upgrading a plugin from 7.0.1 to 7.1.0. A `regression` learning with both versions tells maintainers exactly where to look.

**4. Tell maintainers what works**
`praise` matters too: knowing which prompts and workflows succeed helps maintainers avoid breaking them.

**5. Build a team knowledge base**
Learnings are Markdown files in `.agent-learnings/learnings/`, so they go through code review. New teammates can read what the team already discovered about its tools, even if nothing is ever published.

**6. Add evidence to an existing issue**
The preview shows issues that already exist for that component. If one matches, your learning is added there as a comment instead of opening a duplicate.

**7. Collect structured feedback as a maintainer**
If you maintain a skill or plugin, your users can send feedback in a predictable format. A small optional settings file lets you choose what you accept, and a hidden marker makes automatic labelling easy. See [For maintainers](#for-maintainers).

## Quick start

You need **Node.js 20+** and a **Git repository**. Install the GitHub CLI ([`gh`](https://cli.github.com/)) and run `gh auth login` if you want issues opened for you. Without it you still get ready-to-paste text.

### Claude Code

```
/plugin marketplace add shenmali/awesome-agent-learnings
/plugin install agent-learnings@awesome-agent-learnings
```

On Claude Code 2.1.275 or later, one command is enough:

```
/plugin install agent-learnings --marketplace shenmali/awesome-agent-learnings
```

Restart or run `/reload-plugins`. You now have:

| Command | Does |
|---|---|
| `/agent-learnings:capture-learning` | Draft and save a learning |
| `/agent-learnings:share-learning` | Preview and send it to the maintainers |
| `/agent-learnings:manage-learnings` | List, edit, remove, check status, switch reminders |

The plugin bundles its own CLI; nothing else to install.

### Codex

```
codex plugin marketplace add shenmali/awesome-agent-learnings
codex plugin add agent-learnings@awesome-agent-learnings
```

Start a new session and use `$capture-learning`, `$share-learning` and `$manage-learnings`, or pick them from `/skills`.

### OpenCode (or skills committed to your repository)

OpenCode has no compatible plugin format, so the skills and slash commands are written into your project. The npm package is not published yet; until it is, install the CLI from source:

```sh
git clone https://github.com/shenmali/awesome-agent-learnings
cd awesome-agent-learnings
npm ci && npm run build && npm link
```

Then, from anywhere inside your project:

```sh
agent-learnings init --platform opencode
```

You get `/capture-learning`, `/share-learning` and `/manage-learnings` in OpenCode. Commit the generated files to share them with your team. After npm publication, `npx --yes agent-learnings@0.2.0 init --platform opencode` will work without the clone.

<details>
<summary>All <code>init</code> options</summary>

| `--platform` | Writes |
|---|---|
| `opencode` | `.agents/skills/<skill>/` (read by OpenCode and Codex) and `.opencode/commands/<skill>.md` |
| `codex` | `.agents/skills/<skill>/`, including `agents/openai.yaml`, which turns off implicit invocation |
| `claude` | `.claude/skills/<skill>/` |
| `all` (default) | All of the above |

- `--scope project` (default) writes into the repository. The skills call the pinned CLI with `npx --yes agent-learnings@<version>`.
- `--scope user` writes under your home directory (OpenCode commands go to `~/.config/opencode/commands/`) and calls a globally installed `agent-learnings`. Learnings are still stored in the active project.
- `init` never overwrites an existing file. To update a customised copy, review the new instructions and merge them yourself.

</details>

## Step by step: from experience to issue

The walkthrough uses Claude Code command names. In Codex use `$capture-learning`, in OpenCode `/capture-learning`.

### Step 1: Use your tools as usual

Work normally. When a component surprises you, good or bad, note what you changed and what happened. That is all a learning needs.

> You used `superpowers:brainstorming`. It proposed a plan that ignored your Friday deadline. You told it to "list the constraints before proposing options", and the next plan fitted.

### Step 2: Capture the learning

Run the capture skill, optionally with a hint:

```
/agent-learnings:capture-learning the brainstorming skill ignored my deadline until I asked for constraints first
```

The agent drafts the learning from the current session and shows it to you. Example:

```
Target:     superpowers            Kind: skill     Component: brainstorming
Category:   bug                    Platform: claude  Version: 7.0.1
Situation:  The brainstorming skill proposed a plan that ignored a stated deadline.
Change:     Asked it to list all constraints before proposing options.
Result:     The next plan respected the deadline on the first try.
```

### Step 3: Review and approve

Edit anything in chat ("make the situation shorter", "category is improvement, not bug"). The agent saves the learning only after you approve it:

```
Saved learning 20261026-cc902940
```

The record is now in `.agent-learnings/learnings/20261026-cc902940.md`. If the text contains a token or key, saving is refused and the agent asks you to remove it. Emails, home paths and IP addresses produce a warning.

### Step 4: Map the component to its repository (once per component)

Sharing needs the GitHub repository behind the component. The agent looks for it in the plugin's manifest or marketplace and asks you to confirm, then runs:

```sh
agent-learnings target add superpowers obra/superpowers
```

The mapping is stored in `.agent-learnings/config.json`, so your team does this only once.

### Step 5: Commit, if you want a team history

```sh
git add .agent-learnings
git commit -m "Add learning about the brainstorming skill"
```

You can stop here. A learning is useful even if it is never published.

### Step 6: Preview the issue

```
/agent-learnings:share-learning 20261026-cc902940
```

The agent runs `agent-learnings share <id>` and shows the full preview. Nothing is published yet:

```
Repository: obra/superpowers
New issue: https://github.com/obra/superpowers/issues/new
Title: [agent-learnings] bug: brainstorming - The brainstorming skill proposed a plan that ignored a stated deadline.
Maintainer settings: default (no .github/agent-learnings.json in obra/superpowers)
Policy: accepted

## Target
- Plugin or skill: superpowers
- Kind: skill
- Component: brainstorming
...

Privacy: no sensitive values detected (the scan is a heuristic; review the text yourself)
Possible related issues (titles written by others):
  #12 [OPEN] brainstorming forgets deadlines https://github.com/obra/superpowers/issues/12

To submit after review: agent-learnings share 20261026-cc902940 --publish
To add it to an existing issue instead: agent-learnings share 20261026-cc902940 --comment <issue-url>
```

Read it carefully:

- **Maintainer settings / Policy:** the maintainers may accept only some categories, prefer a form, or not accept feedback at all. A blocked learning cannot be published.
- **Privacy:** anything flagged here must be fixed before publishing.
- **Possible related issues:** if one describes the same problem, a comment is better than a new issue.

### Step 7: Publish or comment, after a second approval

Tell the agent which option you want. It runs one of these:

```sh
agent-learnings share 20261026-cc902940 --publish
# https://github.com/obra/superpowers/issues/101

agent-learnings share 20261026-cc902940 --comment https://github.com/obra/superpowers/issues/12
# https://github.com/obra/superpowers/issues/12#issuecomment-555
```

Unless you have pre-approved it, Claude Code also asks permission to run this command: a second safety gate before anything leaves your machine.

**No `gh`, or not signed in?** You get the complete text and the link to paste it into. After submitting, link the record:

```sh
agent-learnings share 20261026-cc902940 --attach https://github.com/obra/superpowers/issues/101
```

### Step 8: Follow up

```
/agent-learnings:manage-learnings what's the status of my brainstorming learning?
```

The skill runs `agent-learnings share <id> --status` to refresh whether the issue is open or closed, and `learn list` to show all your learnings:

```
20261026-cc902940  superpowers  claude  OPEN   skill  bug
20261026-4e2b3e12  superpowers  claude  LOCAL  other  improvement
```

Unshared learnings can be edited (`learn edit`) or removed (`learn remove --yes`). Shared ones are locked so the issue and the record never disagree.

## Auto mode (Claude Code)

Don't want to approve every learning? In auto mode the agent captures learnings on its own, and you only review them in one batch before anything is shared.

**Turn it on**

```sh
agent-learnings config mode auto       # for the whole project (stored in .agent-learnings/config.json)
```

or ask `/agent-learnings:manage-learnings` to switch to auto mode. To use it only yourself, set `AGENT_LEARNINGS_MODE=auto` in your environment, for example in the `env` block of Claude Code's `settings.json`. `AGENT_LEARNINGS_MODE=manual` turns it off for you even when the project uses auto mode.

**What happens**

1. You work as usual. The plugin notes which skills, subagents, MCP servers and plugin commands the session used (names only).
2. At the end of the first turn that used one, Claude Code shows `agent-learnings auto mode: checking this session for learnings worth saving`, and the agent decides whether something is worth reporting: a bug, a workaround, a change that clearly helped, a regression or notable praise. This happens once per session.
3. If there is, it saves the learning without asking and tells you in one line:
   ```
   Saved learning 20261026-a1b2c3d4 automatically; review and share it with /agent-learnings:share-learning.
   ```
   If not, it says so and stops. Auto-saved learnings are marked `origin: auto` and show `auto` in `learn list`.
4. When you are ready, run `/agent-learnings:share-learning` and ask for pending learnings. The agent runs `agent-learnings share --pending`, which shows the preview of every unshared auto-saved learning:
   ```
   === Learning 20261026-a1b2c3d4 ===
   Repository: obra/superpowers
   Title: [agent-learnings] bug: brainstorming - ...
   ...
   === Learning 20261026-e5f6a7b8 ===
   ...
   To publish the approved ones together: agent-learnings share 20261026-a1b2c3d4 20261026-e5f6a7b8 --publish
   ```
5. Approve all, some or none in one reply. The approved ones are published together; the rest can be edited, commented onto an existing issue, or removed.

**What stays the same**

- Publishing always needs your approval. Auto mode never opens issues or comments by itself.
- The privacy scan still applies: drafts with tokens or keys are refused, and the agent is told not to copy conversation text or personal details.
- At most one check per session, and none when no component was used.
- Auto mode needs the Claude Code plugin hooks. In Codex and OpenCode, saving stays manual.

## Feedback reminders (Claude Code, opt-in)

Want a nudge when there might be something worth reporting? Turn on reminders, and at the end of a session's first turn that used a skill, subagent, MCP server or plugin command, Claude Code shows you one line:

```
agent-learnings: this session used skill:superpowers:brainstorming, mcp:github. If something worked well or could be better, run /agent-learnings:capture-learning to record it.
```

- **For the whole project:** `agent-learnings config reminders on`, or ask `/agent-learnings:manage-learnings` to turn reminders on. Stored in `.agent-learnings/config.json`.
- **Just for you:** set `AGENT_LEARNINGS_REMINDERS=1` (or `0` to silence a project setting), for example in the `env` block of Claude Code's `settings.json`.
- **What is stored:** only a hash of the session id and component names, deleted when the session ends or after a day. The reminder is shown to you, not sent to the model. When reminders are off, nothing is stored.

Reminders are off by default and are not yet available in Codex or OpenCode. In auto mode the reminder is replaced by the automatic check.

## CLI reference

The skills drive the CLI for you, but you can use it directly from any directory inside your project.

| Command | Purpose |
|---|---|
| `init [--scope project\|user] [--platform all\|claude\|codex\|opencode]` | Write skills and commands into a project or home directory |
| `target add <id> <owner/repo>` | Map a component id to its GitHub repository |
| `target list` | Show mappings |
| `learn add [--json <file\|->]` | Save a learning (interactive prompts without `--json`) |
| `learn add --json <file\|-> --auto` | Save without approval, marked as auto-saved (used by auto mode) |
| `learn list` | id, target, platform, status, kind, category, origin |
| `learn show <id>` | Full record |
| `learn edit <id> [--json <file\|->]` | Change an unshared learning |
| `learn remove <id> --yes` | Delete a learning (a shared issue stays on GitHub) |
| `share <id>` | Preview only: issue text, maintainer settings, privacy, related issues |
| `share <id> --publish` | Open a new issue |
| `share <id> <id>... --publish` | Publish several approved learnings at once; failures are reported per id |
| `share --pending` | Preview every unshared auto-saved learning, with one combined publish command |
| `share <id> --comment <issue-url>` | Add the learning to an existing issue |
| `share <id> --attach <issue-or-comment-url>` | Link a manually submitted issue or comment |
| `share <id> --status` | Refresh open/closed state |
| `config mode [manual\|auto]` | Show or change the project mode |
| `config reminders [on\|off]` | Show or change the project reminder setting |
| `--version`, `--help` | |

## What a learning contains

A JSON draft for `learn add --json`:

```json
{
  "target": "superpowers",
  "platform": "claude",
  "version": "7.0.1",
  "kind": "skill",
  "component": "brainstorming",
  "category": "bug",
  "situation": "The brainstorming skill proposed a plan that ignored a stated deadline.",
  "change": "Asked it to list all constraints before proposing options.",
  "result": "The next plan respected the deadline on the first try."
}
```

| Field | Required | Values |
|---|---|---|
| `target` | yes | Your id for the plugin or package: lowercase letters, numbers and single hyphens |
| `platform` | yes | `claude`, `codex` or `opencode` |
| `situation`, `change`, `result` | yes | Free text |
| `version` | no | Component version, one line |
| `kind` | no, default `other` | `skill`, `agent`, `hook`, `command`, `mcp`, `plugin`, `prompt`, `other` |
| `component` | no | Specific skill, agent, hook or command name, one line |
| `category` | no, default `improvement` | `improvement`, `bug`, `regression`, `praise` |

Unknown fields are rejected so typos never disappear silently. With `learn edit`, `null` clears `version` or `component`.

Learning files are Markdown: structured data in the front matter, a readable body below. The body mirrors the front matter, and a hand-edited body is reported as a mismatch so stale text can never be published. Use `learn edit` to change a record.

## Privacy

The CLI scans text when saving, editing and sharing. The scan is a heuristic, not a guarantee, so always read the preview.

| Result | Detects |
|---|---|
| **Blocked** | GitHub, OpenAI, Anthropic, AWS, Slack, npm, Google and Stripe keys, private keys, JSON Web Tokens, credentials in URLs, bearer tokens, password or secret assignments with real-looking values. The value is never repeated in messages. |
| **Warned** | Email addresses, home directory paths, IP addresses |

Nothing from the learning text leaves your machine until you run `--publish` or `--comment`. The preview contacts GitHub only to read the maintainers' settings and to search issue titles for the component name (or title prefix), information that would be published anyway.

## For maintainers

Feedback arrives as ordinary GitHub issues or comments with a fixed layout and a hidden, machine-readable marker:

```
<!-- agent-learnings {"v":1,"kind":"skill","component":"brainstorming","category":"bug","platform":"claude","version":"7.0.1"} -->
```

You don't have to do anything to receive it. Optionally, add `.github/agent-learnings.json` to your default branch:

```json
{
  "schemaVersion": 1,
  "accepting": true,
  "categories": ["bug", "regression", "improvement"],
  "kinds": ["skill", "agent"],
  "titlePrefix": "[learning]"
}
```

Set `"accepting": false` to opt out, or `"feedbackUrl"` to send people to a form or discussion instead. [docs/maintainers.md](docs/maintainers.md) has the full format and a ready-made GitHub Actions workflow that labels incoming learnings.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `No GitHub repository mapped for <target>` | Run `agent-learnings target add <target> <owner/repo>`. |
| `GitHub CLI is unavailable` / `authentication is unavailable` | Install `gh` and run `gh auth login`, or paste the printed text manually and then use `--attach`. |
| `Refusing to save this learning: possible ... token` | Remove the value from the text. The scan does not have an override, by design. |
| `Not sharing <id>: category ... is not accepted` | The maintainers limit what they accept. Change the category with `learn edit` if it was wrong, or keep the learning local. |
| `Learning body differs from metadata` | The Markdown body was edited by hand. Restore it from Git and use `learn edit`. |
| `Another agent-learnings operation is in progress` | A previous run crashed and left a `.share.lock` file. Check the repository for an issue or comment from that attempt; if one exists, remove the lock and `--attach` its URL, otherwise remove the lock and retry. |
| Codex or OpenCode does not show the skills | Start a new session after installing. For `init`, run it inside the Git repository. |

## Environment variables

| Variable | Effect |
|---|---|
| `AGENT_LEARNINGS_MODE` | `manual` or `auto`: overrides the project mode |
| `AGENT_LEARNINGS_REMINDERS` | `1`/`on` or `0`/`off`: overrides the project reminder setting |
| `AGENT_LEARNINGS_GH` | Path of the GitHub CLI to use instead of `gh` |
| `AGENT_LEARNINGS_STATE_DIR` | Where reminder state is kept (default: the plugin data directory, or a private folder in the system temp directory) |
| `AGENT_LEARNINGS_DEBUG` | `1` prints hook errors to standard error |

## Upgrading from 0.1

- The single `agent-learnings` skill became three: `capture-learning`, `share-learning` and `manage-learnings`. After installing the plugin or running `init`, delete the old `.agents/skills/agent-learnings/` and `.claude/skills/agent-learnings/` folders.
- Existing learning files keep working unchanged, and the 0.1 CLI can read new ones. Rewriting a record with 0.1 (publishing, attaching, refreshing status) drops `kind`, `component`, `category` and comment links, so use the same version across a team.
- The CLI is stricter: unknown options and unknown JSON fields are errors.

## Development

```sh
npm ci
npm test                                          # build, then node --test
npm run build && node --test test/core.test.mjs   # one file
npm pack --dry-run
claude plugin validate . --strict                 # marketplace
claude plugin validate plugins/agent-learnings --strict
```

- The repository root is the marketplace (`.claude-plugin/marketplace.json`, also read by Codex). `plugins/agent-learnings/` is the plugin.
- TypeScript in `src/` compiles into `plugins/agent-learnings/dist/`, and the build generates `plugins/agent-learnings/skills/` from `src/skills.ts`. Both are committed because Git-installed plugins have no build step. Run `npm run build` and commit the output with your change.
- No runtime dependencies. CI runs on Windows, macOS and Linux with Node.js 20, 22 and 24, checks that the committed build is current, and validates the plugin.

## License

MIT. See [LICENSE](LICENSE).
