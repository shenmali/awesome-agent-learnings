# Agent Learnings plugin

A common feedback mechanism for the skills, agents, hooks, commands and MCP servers you use. Capture what worked or what went wrong as a reviewed learning, then share it with the component's maintainers as a GitHub issue.

Install in Claude Code:

```
/plugin install agent-learnings --marketplace shenmali/awesome-agent-learnings
```

Skills (all user-invoked):

- `capture-learning`: draft a learning, approve it, save it in the project's `.agent-learnings/`.
- `share-learning`: preview the GitHub issue (maintainer settings, privacy findings, related issues) and publish or comment after approval.
- `manage-learnings`: list, show, edit, remove, refresh issue status, and switch the opt-in feedback reminders.

In Claude Code they are `/agent-learnings:capture-learning` and so on. The hooks in `hooks/hooks.json` only remind you to leave feedback when reminders are enabled.

`dist/` is the compiled CLI and `skills/` is generated; both come from the sources in the repository root. See the [main README](https://github.com/shenmali/awesome-agent-learnings#readme) for installation, the CLI and the maintainer settings format.
