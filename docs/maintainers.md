# Agent Learnings for maintainers

People who use your skill, agent, hook, command, MCP server or plugin can send you structured feedback with [Agent Learnings](../README.md). Each learning describes a situation, the change the user tried and the result they observed, and arrives as a GitHub issue (or a comment on an existing issue) only after the user has reviewed the exact text.

You do not need to do anything to receive feedback. This page describes the optional settings file and the machine-readable marker you can use to triage it.

## What an issue looks like

Title:

```
[agent-learnings] bug: brainstorming - Brainstorm skipped asking about constraints
```

The format is `<prefix> <category>: <component or target> - <first 80 characters of the situation>`.

Body:

```markdown
## Target
- Plugin or skill: superpowers
- Kind: skill
- Component: brainstorming
- Category: bug
- Platform: claude
- Version: 7.0.1

## Situation
...

## Change tried
...

## Observed result
...

Submitted from an explicitly reviewed Agent Learnings record.
<!-- agent-learnings {"v":1,"kind":"skill","component":"brainstorming","category":"bug","platform":"claude","version":"7.0.1"} -->
```

- **kind** is one of `skill`, `agent`, `hook`, `command`, `mcp`, `plugin`, `prompt`, `other`.
- **category** is one of `improvement` (a change that helped), `bug`, `regression`, `praise`.
- **platform** is `claude`, `codex` or `opencode`.
- "Plugin or skill" is the submitter's local name for your project, not necessarily your repository name.

The last line is a hidden HTML comment with the same metadata as JSON. `<`, `>` and `&` inside values are escaped as `<`, `>` and `&`, so the comment always ends at the first `-->`. `component` and `version` are left out when the submitter did not provide them. Comments added with `share --comment` use the same body.

Agent Learnings does not set labels: GitHub silently drops labels on issues opened by people without triage access. Use the marker instead (see the workflow below).

## Settings file: `.github/agent-learnings.json`

Put this file on your default branch to tell Agent Learnings how you want feedback. Every field except `schemaVersion` is optional.

```json
{
  "schemaVersion": 1,
  "accepting": true,
  "categories": ["bug", "regression", "improvement"],
  "kinds": ["skill", "agent"],
  "titlePrefix": "[learning]"
}
```

| Field | Type | Effect |
|---|---|---|
| `schemaVersion` | `1` | Required. |
| `accepting` | boolean, default `true` | `false` stops Agent Learnings from opening issues or comments in your repository. |
| `categories` | list of categories | Only these categories can be shared. Unknown values are ignored. |
| `kinds` | list of kinds | Only feedback about these kinds of components can be shared. Unknown values are ignored. |
| `titlePrefix` | 1 to 32 printable ASCII characters, no `<` or `>` | Replaces `[agent-learnings]` at the start of issue titles. |
| `feedbackUrl` | `https://` URL, at most 500 characters | Instead of creating an issue, Agent Learnings gives the user the text and asks them to submit it at this URL (a form, a discussion category, and so on). |

Unknown fields are ignored, so later versions can add fields without breaking older clients. There is deliberately no free-text field: the values are shown to the user's agent, and free text would be a way to inject instructions.

How Agent Learnings reacts:

| Situation | Preview | Publish or comment |
|---|---|---|
| No settings file | "default" | Allowed |
| GitHub CLI missing or not signed in | "not checked" | Falls back to text for manual submission |
| File is invalid, or GitHub returns another error | Shows the reason | Blocked until it can be read |
| `accepting: false`, or a kind or category you do not accept | "BLOCKED" with the reason | Blocked |
| `feedbackUrl` set | "feedback goes to ..." | Prints the text and your URL; no issue is created |

The file is read with `gh api repos/<owner>/<repo>/contents/.github/agent-learnings.json`, so it must be readable by the person sharing (public repositories, or private ones they can access).

## Labelling issues automatically

This workflow adds labels from the marker when an issue is opened. It runs with your repository's token, so it works for every submitter.

```yaml
name: Label agent learnings
on:
  issues:
    types: [opened]
permissions:
  issues: write
jobs:
  label:
    if: contains(github.event.issue.body, '<!-- agent-learnings ')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const match = /<!-- agent-learnings (\{.*?\}) -->/.exec(context.payload.issue.body);
            if (!match) return;
            const data = JSON.parse(match[1]);
            const labels = ['agent-learnings', `category:${data.category}`, `kind:${data.kind}`];
            await github.rest.issues.addLabels({ ...context.repo, issue_number: context.issue.number, labels });
```

Adjust the label names to the ones your repository uses.

## Duplicates

Before sharing, the preview searches your issues for the component name (or your title prefix when no component is given) and shows up to five matches, so the user can add their learning to an existing issue instead. Only that name is sent in the search; the learning text stays on the user's machine until they approve it.
