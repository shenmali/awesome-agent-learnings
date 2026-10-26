---
name: manage-learnings
description: "List, show, edit or remove saved agent learnings, refresh the status of their GitHub issues, and switch auto mode or feedback reminders on or off."
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn *), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" target *), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js learn *), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js target *)
---

# Manage learnings

CLI: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`. If that path was not filled in for you (for example in Codex), use `node "<plugin root>/dist/cli.js"`, where the plugin root is two folders above this skill's folder. Run it from the user's project. Learnings are stored in `.agent-learnings/` at the repository root, so the team can review them in Git.

Use when the user asks to list, show, edit or remove learnings, check issue status, or turn feedback reminders on or off.

- List: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn list` prints id, target, platform, status, kind, category and origin.
- Show: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn show <id>`.
- Edit an unshared learning: show the proposed change and get approval, write only the changed fields as JSON to a temporary file, then run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn edit <id> --json <file>`. Use null to clear version or component. Shared learnings cannot be edited; suggest a new learning instead.
- Remove: confirm with the user, then run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn remove <id> --yes`. The GitHub issue of a shared learning stays open.
- Issue status: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" share <id> --status`.
- Auto mode: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config mode` shows it, `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config mode auto` or `manual` changes it for the whole project. AGENT_LEARNINGS_MODE=auto or manual overrides it for one user. In auto mode the Claude Code plugin asks the agent, once per session, to save worthwhile learnings without approval; publishing still needs approval through the share-learning skill. Auto-saved learnings show `auto` in the last column of `learn list`.
- Reminders: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config reminders` shows the setting, and `on` or `off` changes it for the whole project (stored in .agent-learnings/config.json). For a personal setting, the user can set AGENT_LEARNINGS_REMINDERS=1 or 0 in their environment, for Claude Code in the `env` block of settings.json. Reminders are delivered by the Claude Code plugin hooks.
