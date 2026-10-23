#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { initSkills } from './install.js';
import { addLearning, addTarget, getLearning, listLearnings, listTargets, type LearningInput } from './store.js';
import { attachIssue, prepareIssue, publishIssue, refreshIssue } from './github.js';
import { findProjectRoot } from './project.js';

const help = `Agent Learnings\n\nCommands:\n  init --scope project|user\n  target add <id> <github-owner/repo>\n  target list\n  learn add [--json <file|->]\n  learn list\n  learn show <id>\n  share <id> [--publish|--status|--attach <issue-url>]\n`;

async function readStdin(): Promise<string> {
  let value = '';
  for await (const chunk of input) value += chunk.toString();
  return value;
}

async function interactiveDraft(): Promise<LearningInput> {
  const rl = createInterface({ input, output });
  try {
    const target = await rl.question('Plugin/skill ID: ');
    const platform = await rl.question('Platform (codex/claude/opencode): ');
    const version = await rl.question('Version (optional): ');
    const situation = await rl.question('Situation: ');
    const change = await rl.question('Change tried: ');
    const result = await rl.question('Observed result: ');
    output.write(`\nTarget: ${target}\nSituation: ${situation}\nChange: ${change}\nResult: ${result}\n`);
    const approval = await rl.question('Save this learning? (y/N): ');
    if (!/^y(es)?$/i.test(approval.trim())) throw new Error('Learning was not saved');
    return { target, platform: platform as LearningInput['platform'], version, situation, change, result };
  } finally {
    rl.close();
  }
}

export async function main(args = process.argv.slice(2), cwd = process.cwd()): Promise<void> {
  const [command, action, value, extra] = args;
  if (!command || command === '--help' || command === 'help') {
    output.write(help);
    return;
  }
  const root = await findProjectRoot(cwd);
  if (command === 'init') {
    const flag = args.indexOf('--scope');
    const scope = flag >= 0 ? args[flag + 1] : 'project';
    if (scope !== 'project' && scope !== 'user') throw new Error('scope must be project or user');
    const created = await initSkills({ scope, cwd: root });
    output.write(created.length ? `Installed:\n${created.join('\n')}\n` : 'Skills already exist; no files overwritten.\n');
    return;
  }
  if (command === 'target' && action === 'add') {
    if (!value || !extra) throw new Error('Usage: target add <id> <github-owner/repo>');
    await addTarget(root, value, extra);
    output.write(`Mapped ${value} to ${extra}\n`);
    return;
  }
  if (command === 'target' && action === 'list') {
    const targets = await listTargets(root);
    for (const [id, target] of Object.entries(targets)) output.write(`${id}\t${target.repo}\n`);
    return;
  }
  if (command === 'learn' && action === 'add') {
    const jsonFlag = args.indexOf('--json');
    let draft: LearningInput;
    if (jsonFlag >= 0) {
      const path = args[jsonFlag + 1];
      if (!path) throw new Error('Usage: learn add --json <file|->');
      draft = JSON.parse(path === '-' ? await readStdin() : await readFile(path, 'utf8')) as LearningInput;
    } else {
      draft = await interactiveDraft();
    }
    const learning = await addLearning(root, draft);
    output.write(`Saved learning ${learning.id}\n`);
    return;
  }
  if (command === 'learn' && action === 'list') {
    for (const item of await listLearnings(root)) output.write(`${item.id}\t${item.target}\t${item.platform}\t${item.issueStatus ?? 'LOCAL'}\n`);
    return;
  }
  if (command === 'learn' && action === 'show') {
    if (!value) throw new Error('Usage: learn show <id>');
    const learning = await getLearning(root, value);
    output.write(`ID: ${learning.id}\nTarget: ${learning.target}\nPlatform: ${learning.platform}\nVersion: ${learning.version ?? 'unknown'}\nSituation: ${learning.situation}\nChange: ${learning.change}\nResult: ${learning.result}\nIssue: ${learning.issueUrl ?? 'not shared'}\nStatus: ${learning.issueStatus ?? 'LOCAL'}\n`);
    return;
  }
  if (command === 'share') {
    if (!action) throw new Error('Usage: share <id> [--publish|--status]');
    if (value === '--attach') {
      if (!extra) throw new Error('Usage: share <id> --attach <issue-url>');
      output.write(`${await attachIssue(root, action, extra)}\n`);
      return;
    }
    if (value === '--status') {
      output.write(`${await refreshIssue(root, action)}\n`);
      return;
    }
    if (value === '--publish') {
      output.write(`${await publishIssue(root, action)}\n`);
      return;
    }
    if (value) throw new Error('Usage: share <id> [--publish|--status]');
    const issue = await prepareIssue(root, action);
    output.write(`Repository: ${issue.repo}\nNew issue: ${issue.newIssueUrl}\nTitle: ${issue.title}\n\n${issue.body}\n\nTo submit after review: agent-learnings share ${action} --publish\n`);
    return;
  }
  throw new Error(`Unknown command.\n${help}`);
}

main().catch(error => {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
});
