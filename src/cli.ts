#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import { initSkills, installPlatforms, type InstallPlatform } from './install.js';
import { addLearning, addTarget, categories, editLearning, effectiveCategory, effectiveKind, getLearning, getMode, getReminders, kinds, learningFields, listLearnings, listTargets, removeLearning, setMode, setReminders, modes, type Learning, type LearningInput } from './store.js';
import { envMode, envReminders, runHook } from './reminders.js';
import { describeFinding, scanFields } from './privacy.js';
import { attachIssue, commentIssue, describeManifest, previewShare, publishIssue, refreshIssue, type SharePreview } from './github.js';
import { findProjectRoot, packageVersion } from './project.js';

const help = `Agent Learnings\n\nCommands:\n  init [--scope project|user] [--platform all|claude|codex|opencode]\n  target add <id> <github-owner/repo>\n  target list\n  learn add [--json <file|-> [--auto]]\n  learn edit <id> [--json <file|->]\n  learn remove <id> --yes\n  learn list\n  learn show <id>\n  share <id> [--publish|--comment <issue-url>|--attach <issue-url>|--status]\n  share <id> <id>... --publish\n  share --pending\n  config mode [manual|auto]\n  config reminders [on|off]\n  --version\n`;

const options = {
  json: { type: 'string' },
  scope: { type: 'string' },
  platform: { type: 'string' },
  publish: { type: 'boolean' },
  status: { type: 'boolean' },
  attach: { type: 'string' },
  comment: { type: 'string' },
  yes: { type: 'boolean' },
  auto: { type: 'boolean' },
  pending: { type: 'boolean' },
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
    const kind = await ask(`Component kind (${kinds.join('/')}, default other): `);
    const component = await ask('Component name (optional): ');
    const category = await ask(`Category (${categories.join('/')}, default improvement): `);
    const situation = await ask('Situation: ');
    const change = await ask('Change tried: ');
    const result = await ask('Observed result: ');
    output.write(`\nTarget: ${target}\nSituation: ${situation}\nChange: ${change}\nResult: ${result}\n`);
    const approval = await ask('Save this learning? (y/N): ');
    if (!/^y(es)?$/i.test(approval.trim())) throw new Error('Learning was not saved');
    return { target, platform: platform as LearningInput['platform'], version, kind: (kind.trim() || undefined) as LearningInput['kind'], component, category: (category.trim() || undefined) as LearningInput['category'], situation, change, result };
  } finally {
    close();
  }
}

const editable: Array<[keyof LearningInput, string]> = [
  ['target', 'Plugin/skill ID'], ['platform', 'Platform'], ['version', 'Version'], ['kind', 'Component kind'], ['component', 'Component name'],
  ['category', 'Category'], ['situation', 'Situation'], ['change', 'Change tried'], ['result', 'Observed result'],
];

async function interactiveEdit(current: Learning): Promise<Record<string, string | null>> {
  const { ask, close } = prompter('Input ended before the edit was confirmed; nothing was changed');
  try {
    output.write('Press Enter to keep a value, or type - to clear an optional one.\n');
    const patch: Record<string, string | null> = {};
    for (const [key, label] of editable) {
      const value = (await ask(`${label} [${current[key] ?? ''}]: `)).trim();
      if (value === '-') patch[key] = null;
      else if (value) patch[key] = value;
    }
    if (!Object.keys(patch).length) throw new Error('No changes entered');
    const approval = await ask('Save these changes? (y/N): ');
    if (!/^y(es)?$/i.test(approval.trim())) throw new Error('Learning was not changed');
    return patch;
  } finally {
    close();
  }
}

function renderPreview(id: string, preview: SharePreview, hints = true): string {
  const { draft, manifest, policy, findings, related } = preview;
  const lines = [`Repository: ${draft.repo}`, `New issue: ${draft.newIssueUrl}`, `Title: ${draft.title}`, `Maintainer settings: ${describeManifest(draft.repo, manifest)}`];
  lines.push(`Policy: ${policy.status === 'accepted' ? 'accepted' : policy.status === 'redirect' ? `feedback goes to ${policy.url}` : `BLOCKED, ${policy.reason}`}`, '', draft.body, '');
  lines.push(findings.length ? 'Privacy:' : 'Privacy: no sensitive values detected (the scan is a heuristic; review the text yourself)');
  for (const finding of findings) lines.push(`  ${finding.severity === 'block' ? 'BLOCKED' : 'warning'}: ${describeFinding(finding)}`);
  if (related.skipped) lines.push(`Duplicate check skipped (${related.skipped})`);
  else if (!related.issues.length) lines.push('Possible related issues: none found');
  else {
    lines.push('Possible related issues (titles written by others):');
    for (const issue of related.issues) lines.push(`  #${issue.number} [${issue.state}] ${issue.title} ${issue.url}`);
  }
  lines.push('');
  if (preview.sharedAs) lines.push(`Already shared: ${preview.sharedAs}`);
  else if (!ready(preview)) lines.push('Not ready to share. Fix the problems above, for example with agent-learnings learn edit.');
  else if (hints) {
    lines.push(`To submit after review: agent-learnings share ${id} --publish`);
    lines.push(`To add it to an existing issue instead: agent-learnings share ${id} --comment <issue-url>`);
  }
  return `${lines.join('\n')}\n`;
}

const ready = (preview: SharePreview) => !preview.sharedAs && preview.policy.status !== 'blocked' && !preview.findings.some(item => item.severity === 'block');

function warnSensitive(learning: LearningInput): void {
  for (const finding of scanFields(learningFields(learning)).filter(item => item.severity === 'warn')) {
    process.stderr.write(`Warning: ${describeFinding(finding)}. Review before sharing.\n`);
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
    expect(p, v, 1, ['scope', 'platform'], 'init [--scope project|user] [--platform all|claude|codex|opencode]');
    const scope = v.scope ?? 'project';
    if (scope !== 'project' && scope !== 'user') throw new Error('scope must be project or user');
    const platform = (v.platform ?? 'all') as InstallPlatform;
    if (!installPlatforms.includes(platform)) throw new Error(`platform must be one of ${installPlatforms.join(', ')}`);
    const created = await initSkills({ scope, cwd: root, platform });
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
    expect(p, v, 2, ['json', 'auto'], 'learn add [--json <file|-> [--auto]]');
    if (v.auto && v.json === undefined) throw new Error('Usage: agent-learnings learn add --json <file|-> --auto');
    const draft = v.json === undefined ? await interactiveDraft() : await readJsonInput(v.json);
    const learning = await addLearning(root, draft, { auto: v.auto });
    output.write(`Saved learning ${learning.id}\n`);
    warnSensitive(learning);
    return;
  }
  if (command === 'learn' && action === 'edit') {
    expect(p, v, 3, ['json'], 'learn edit <id> [--json <file|->]');
    const patch = v.json === undefined ? await interactiveEdit(await getLearning(root, p[2])) : await readJsonInput(v.json);
    const { learning, changed } = await editLearning(root, p[2], patch);
    output.write(changed ? `Updated learning ${learning.id}\n` : `No changes to learning ${learning.id}\n`);
    if (changed) warnSensitive(learning);
    return;
  }
  if (command === 'learn' && action === 'remove') {
    expect(p, v, 3, ['yes'], 'learn remove <id> --yes');
    if (!v.yes) throw new Error(`Removing a learning deletes its file. Run again with --yes: agent-learnings learn remove ${p[2]} --yes`);
    const learning = await removeLearning(root, p[2]);
    output.write(`Removed learning ${learning.id}${learning.issueUrl ? `; the GitHub issue ${learning.issueUrl} remains` : ''}\n`);
    return;
  }
  if (command === 'learn' && action === 'list') {
    expect(p, v, 2, [], 'learn list');
    for (const item of await listLearnings(root)) output.write(`${item.id}\t${item.target}\t${item.platform}\t${item.issueStatus ?? 'LOCAL'}\t${effectiveKind(item)}\t${effectiveCategory(item)}\t${item.origin ?? '-'}\n`);
    return;
  }
  if (command === 'learn' && action === 'show') {
    expect(p, v, 3, [], 'learn show <id>');
    const learning = await getLearning(root, p[2]);
    output.write(`ID: ${learning.id}\nTarget: ${learning.target}\nPlatform: ${learning.platform}\nVersion: ${learning.version ?? 'unknown'}\nKind: ${effectiveKind(learning)}\nComponent: ${learning.component ?? '-'}\nCategory: ${effectiveCategory(learning)}\n${learning.origin ? `Origin: ${learning.origin}\n` : ''}Situation: ${learning.situation}\nChange: ${learning.change}\nResult: ${learning.result}\nIssue: ${learning.issueUrl ?? 'not shared'}\n${learning.commentUrl ? `Comment: ${learning.commentUrl}\n` : ''}Status: ${learning.issueStatus ?? 'LOCAL'}\n`);
    return;
  }
  if (command === 'share') {
    const usage = 'share <id> [--publish|--comment <issue-url>|--attach <issue-url>|--status] | share <id> <id>... --publish | share --pending';
    if (v.pending) {
      expect(p, v, 1, ['pending'], usage);
      const pending = (await listLearnings(root)).filter(item => item.origin === 'auto' && !item.issueUrl).reverse();
      if (!pending.length) {
        output.write('No auto-saved learnings are waiting to be shared.\n');
        return;
      }
      const approvable: string[] = [];
      for (const item of pending) {
        const preview = await previewShare(root, item.id);
        if (ready(preview)) approvable.push(item.id);
        output.write(`=== Learning ${item.id} ===\n${renderPreview(item.id, preview, false)}\n`);
      }
      output.write(approvable.length
        ? `To publish the approved ones together: agent-learnings share ${approvable.join(' ')} --publish\n`
        : 'None of these is ready to share yet.\n');
      return;
    }
    if (v.publish && p.length > 2) {
      expect(p, v, p.length, ['publish'], usage);
      for (const id of p.slice(1)) {
        try {
          output.write(`${id}: ${await publishIssue(root, id)}\n`);
        } catch (error) {
          process.stderr.write(`Error: ${id}: ${(error as Error).message}\n`);
          process.exitCode = 1;
        }
      }
      return;
    }
    expect(p, v, 2, ['publish', 'status', 'attach', 'comment'], usage);
    const id = p[1];
    const modes = (['publish', 'status', 'attach', 'comment'] as const).filter(key => v[key] !== undefined);
    if (modes.length > 1) throw new Error(`Usage: agent-learnings ${usage}`);
    if (v.attach !== undefined) {
      output.write(`${await attachIssue(root, id, v.attach)}\n`);
      return;
    }
    if (v.comment !== undefined) {
      output.write(`${await commentIssue(root, id, v.comment)}\n`);
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
    output.write(renderPreview(id, await previewShare(root, id)));
    return;
  }
  if (command === 'config' && action === 'mode') {
    const usage = 'config mode [manual|auto]';
    if (p.length === 2) {
      expect(p, v, 2, [], usage);
      const configured = await getMode(root);
      const fromEnv = envMode(process.env);
      const source = fromEnv !== undefined ? 'AGENT_LEARNINGS_MODE' : configured !== undefined ? '.agent-learnings/config.json' : 'default';
      output.write(`Mode: ${fromEnv ?? configured ?? 'manual'} (${source})\n`);
      return;
    }
    expect(p, v, 3, [], usage);
    if (!modes.includes(p[2] as typeof modes[number])) throw new Error(`Usage: agent-learnings ${usage}`);
    await setMode(root, p[2] as typeof modes[number]);
    output.write(`Mode ${p[2]} for this project (.agent-learnings/config.json). AGENT_LEARNINGS_MODE overrides this per user.${p[2] === 'auto' ? ' Agents may now save learnings without asking; publishing still needs approval.' : ''}\n`);
    return;
  }
  if (command === 'config' && action === 'reminders') {
    const usage = 'config reminders [on|off]';
    if (p.length === 2) {
      expect(p, v, 2, [], usage);
      const configured = await getReminders(root);
      const fromEnv = envReminders(process.env);
      const state = fromEnv ?? configured ?? false;
      const source = fromEnv !== undefined ? 'AGENT_LEARNINGS_REMINDERS' : configured !== undefined ? '.agent-learnings/config.json' : 'default';
      output.write(`Reminders: ${state ? 'on' : 'off'} (${source})\n`);
      return;
    }
    expect(p, v, 3, [], usage);
    if (p[2] !== 'on' && p[2] !== 'off') throw new Error(`Usage: agent-learnings ${usage}`);
    await setReminders(root, p[2] === 'on');
    output.write(`Reminders ${p[2]} for this project (.agent-learnings/config.json). AGENT_LEARNINGS_REMINDERS overrides this per user.\n`);
    return;
  }
  throw new Error(`Unknown command.\n${help}`);
}

async function readLimited(max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size <= max) chunks.push(chunk as Buffer);
  }
  return size > max ? '' : Buffer.concat(chunks).toString('utf8');
}

// Hidden entry point for agent hooks: `hook <platform:Event> [payload]`. It must never fail or hang the host agent.
async function hookMain(args: string[]): Promise<void> {
  setTimeout(() => process.exit(0), 2000).unref();
  output.on('error', () => {});
  try {
    const result = await runHook(args[0] ?? '', args[1] ?? await readLimited(4 * 1024 * 1024));
    if (result) output.write(`${result}\n`);
  } catch {
    // runHook already swallows errors; this guards stdin failures.
  }
  process.exitCode = 0;
}

const argv = process.argv.slice(2);
if (argv[0] === 'hook') {
  void hookMain(argv.slice(1));
} else {
  main(argv).catch(error => {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
