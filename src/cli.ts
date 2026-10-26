#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import { initSkills } from './install.js';
import { addLearning, addTarget, getLearning, listLearnings, listTargets, type LearningInput } from './store.js';
import { attachIssue, prepareIssue, publishIssue, refreshIssue } from './github.js';
import { findProjectRoot, packageVersion } from './project.js';

const help = `Agent Learnings\n\nCommands:\n  init [--scope project|user]\n  target add <id> <github-owner/repo>\n  target list\n  learn add [--json <file|->]\n  learn list\n  learn show <id>\n  share <id> [--publish|--status|--attach <issue-url>]\n  --version\n`;

const options = {
  json: { type: 'string' },
  scope: { type: 'string' },
  publish: { type: 'boolean' },
  status: { type: 'boolean' },
  attach: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type Values = { -readonly [K in keyof typeof options]?: (typeof options)[K]['type'] extends 'string' ? string : boolean };

function parse(args: string[]): { positionals: string[]; values: Values } {
  try {
    const { positionals, values } = parseArgs({ args, options, allowPositionals: true, strict: true });
    return { positionals, values: values as Values };
  } catch (error) {
    throw new Error(`${(error as Error).message.split('\n')[0]}\n\n${help}`);
  }
}

function expect(positionals: string[], values: Values, count: number, allowed: Array<keyof Values>, usage: string): void {
  const extra = (Object.keys(values) as Array<keyof Values>).some(key => !allowed.includes(key));
  if (positionals.length !== count || extra) throw new Error(`Usage: agent-learnings ${usage}`);
}

async function readStdin(): Promise<string> {
  let value = '';
  for await (const chunk of input) value += chunk.toString();
  return value;
}

async function readJsonInput(path: string): Promise<unknown> {
  const text = path === '-' ? await readStdin() : await readFile(path, 'utf8');
  let value: unknown;
  try { value = JSON.parse(text.replace(/^﻿/, '')); } catch (error) { throw new Error(`Invalid JSON input: ${(error as Error).message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON input must be an object');
  return value;
}

function prompter(ended: string) {
  const rl = createInterface({ input, output });
  const closed = new Promise<never>((_, reject) => rl.once('close', () => reject(new Error(ended))));
  closed.catch(() => {});
  return { ask: (question: string) => Promise.race([rl.question(question), closed]), close: () => rl.close() };
}

async function interactiveDraft(): Promise<LearningInput> {
  const { ask, close } = prompter('Input ended before the learning was confirmed; nothing was saved');
  try {
    const target = await ask('Plugin/skill ID: ');
    const platform = await ask('Platform (codex/claude/opencode): ');
    const version = await ask('Version (optional): ');
    const situation = await ask('Situation: ');
    const change = await ask('Change tried: ');
    const result = await ask('Observed result: ');
    output.write(`\nTarget: ${target}\nSituation: ${situation}\nChange: ${change}\nResult: ${result}\n`);
    const approval = await ask('Save this learning? (y/N): ');
    if (!/^y(es)?$/i.test(approval.trim())) throw new Error('Learning was not saved');
    return { target, platform: platform as LearningInput['platform'], version, situation, change, result };
  } finally {
    close();
  }
}

export async function main(args = process.argv.slice(2), cwd = process.cwd()): Promise<void> {
  const { positionals: p, values: v } = parse(args);
  const [command, action] = p;
  if (v.version) {
    expect(p, v, 0, ['version'], '--version');
    output.write(`${await packageVersion()}\n`);
    return;
  }
  if (!command || command === 'help' || v.help) {
    output.write(help);
    return;
  }
  const root = await findProjectRoot(cwd);
  if (command === 'init') {
    expect(p, v, 1, ['scope'], 'init [--scope project|user]');
    const scope = v.scope ?? 'project';
    if (scope !== 'project' && scope !== 'user') throw new Error('scope must be project or user');
    const created = await initSkills({ scope, cwd: root });
    output.write(created.length ? `Installed:\n${created.join('\n')}\n` : 'Skills already exist; no files overwritten.\n');
    return;
  }
  if (command === 'target' && action === 'add') {
    expect(p, v, 4, [], 'target add <id> <github-owner/repo>');
    await addTarget(root, p[2], p[3]);
    output.write(`Mapped ${p[2]} to ${p[3]}\n`);
    return;
  }
  if (command === 'target' && action === 'list') {
    expect(p, v, 2, [], 'target list');
    const targets = await listTargets(root);
    for (const [id, target] of Object.entries(targets)) output.write(`${id}\t${target.repo}\n`);
    return;
  }
  if (command === 'learn' && action === 'add') {
    expect(p, v, 2, ['json'], 'learn add [--json <file|->]');
    const draft = v.json === undefined ? await interactiveDraft() : await readJsonInput(v.json) as LearningInput;
    const learning = await addLearning(root, draft);
    output.write(`Saved learning ${learning.id}\n`);
    return;
  }
  if (command === 'learn' && action === 'list') {
    expect(p, v, 2, [], 'learn list');
    for (const item of await listLearnings(root)) output.write(`${item.id}\t${item.target}\t${item.platform}\t${item.issueStatus ?? 'LOCAL'}\n`);
    return;
  }
  if (command === 'learn' && action === 'show') {
    expect(p, v, 3, [], 'learn show <id>');
    const learning = await getLearning(root, p[2]);
    output.write(`ID: ${learning.id}\nTarget: ${learning.target}\nPlatform: ${learning.platform}\nVersion: ${learning.version ?? 'unknown'}\nSituation: ${learning.situation}\nChange: ${learning.change}\nResult: ${learning.result}\nIssue: ${learning.issueUrl ?? 'not shared'}\nStatus: ${learning.issueStatus ?? 'LOCAL'}\n`);
    return;
  }
  if (command === 'share') {
    const usage = 'share <id> [--publish|--status|--attach <issue-url>]';
    expect(p, v, 2, ['publish', 'status', 'attach'], usage);
    const id = p[1];
    const modes = (['publish', 'status', 'attach'] as const).filter(key => v[key] !== undefined);
    if (modes.length > 1) throw new Error(`Usage: agent-learnings ${usage}`);
    if (v.attach !== undefined) {
      output.write(`${await attachIssue(root, id, v.attach)}\n`);
      return;
    }
    if (v.status) {
      output.write(`${await refreshIssue(root, id)}\n`);
      return;
    }
    if (v.publish) {
      output.write(`${await publishIssue(root, id)}\n`);
      return;
    }
    const issue = await prepareIssue(root, id);
    output.write(`Repository: ${issue.repo}\nNew issue: ${issue.newIssueUrl}\nTitle: ${issue.title}\n\n${issue.body}\n\nTo submit after review: agent-learnings share ${id} --publish\n`);
    return;
  }
  throw new Error(`Unknown command.\n${help}`);
}

main().catch(error => {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
});
