---
name: capture-learning
description: "Record a reviewed learning about a skill, agent, hook, command, MCP server, plugin or prompt the user works with, so it can later be shared with its maintainers. Use only when the user explicitly asks to capture feedback or a learning."
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn *), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" target *), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js learn *), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js target *)
---

# Capture a learning

CLI: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`. If that path was not filled in for you (for example in Codex), use `node "<plugin root>/dist/cli.js"`, where the plugin root is two folders above this skill's folder. Run it from the user's project. Learnings are stored in `.agent-learnings/` at the repository root, so the team can review them in Git.

Run only when the user explicitly asks to capture feedback or a learning. Never record one on your own initiative.

1. Identify from the current work:
   - target: the plugin or skill package the feedback is about, as a lowercase id such as `superpowers`.
   - kind: skill, agent, hook, command, mcp, plugin, prompt or other.
   - component: the specific skill, agent, hook or command name, if there is one.
   - category: improvement (a change that helped), bug, regression or praise.
   - situation, change tried and observed result, a few sentences each.
   - platform: the agent you are running in, claude (Claude Code), codex (Codex) or opencode (OpenCode), and the component version if known.
   Summarize; do not copy the conversation, prompts, file contents, tokens or personal details.
2. Show the draft in chat and ask the user to edit or approve it. Do not save anything before explicit approval.
3. After approval, write the draft as JSON to a temporary file and run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" learn add --json <file>`. Never put the learning text in a shell argument. Fields: target, platform, situation, change, result, and optional version, kind, component, category. The CLI rejects drafts that contain secrets; if that happens, remove the value and ask the user to approve the new text.
4. Report the saved learning id and any warnings the CLI printed.
5. If `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" target list` has no repository for the target, look for the component's source repository: the `repository` or `homepage` field of its plugin manifest, or the marketplace it was installed from (`claude plugin marketplace list --json` in Claude Code, `~/.codex/config.toml` in Codex). Confirm it with the user, then run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" target add <target> <owner/repo>`.
6. Offer to share the learning with the maintainers as a separate step (the share-learning skill). Never publish a learning just because it was saved.
