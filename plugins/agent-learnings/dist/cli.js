#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import { initSkills, installPlatforms } from './install.js';
import { addLearning, addTarget, categories, editLearning, effectiveCategory, effectiveKind, getLearning, getReminders, kinds, learningFields, listLearnings, listTargets, removeLearning, setReminders } from './store.js';
import { envReminders, runHook } from './reminders.js';
import { describeFinding, scanFields } from './privacy.js';
import { attachIssue, commentIssue, describeManifest, previewShare, publishIssue, refreshIssue } from './github.js';
import { findProjectRoot, packageVersion } from './project.js';
const help = `Agent Learnings\n\nCommands:\n  init [--scope project|user] [--platform all|claude|codex|opencode]\n  target add <id> <github-owner/repo>\n  target list\n  learn add [--json <file|->]\n  learn edit <id> [--json <file|->]\n  learn remove <id> --yes\n  learn list\n  learn show <id>\n  share <id> [--publish|--comment <issue-url>|--attach <issue-url>|--status]\n  config reminders [on|off]\n  --version\n`;
const options = {
    json: { type: 'string' },
    scope: { type: 'string' },
    platform: { type: 'string' },
    publish: { type: 'boolean' },
    status: { type: 'boolean' },
    attach: { type: 'string' },
    comment: { type: 'string' },
    yes: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
};
function parse(args) {
    try {
        const { positionals, values } = parseArgs({ args, options, allowPositionals: true, strict: true });
        return { positionals, values: values };
    }
    catch (error) {
        throw new Error(`${error.message.split('\n')[0]}\n\n${help}`);
    }
}
function expect(positionals, values, count, allowed, usage) {
    const extra = Object.keys(values).some(key => !allowed.includes(key));
    if (positionals.length !== count || extra)
        throw new Error(`Usage: agent-learnings ${usage}`);
}
async function readStdin() {
    let value = '';
    for await (const chunk of input)
        value += chunk.toString();
    return value;
}
async function readJsonInput(path) {
    const text = path === '-' ? await readStdin() : await readFile(path, 'utf8');
    let value;
    try {
        value = JSON.parse(text.replace(/^﻿/, ''));
    }
    catch (error) {
        throw new Error(`Invalid JSON input: ${error.message}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('JSON input must be an object');
    return value;
}
function prompter(ended) {
    const rl = createInterface({ input, output });
    const closed = new Promise((_, reject) => rl.once('close', () => reject(new Error(ended))));
    closed.catch(() => { });
    return { ask: (question) => Promise.race([rl.question(question), closed]), close: () => rl.close() };
}
async function interactiveDraft() {
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
        if (!/^y(es)?$/i.test(approval.trim()))
            throw new Error('Learning was not saved');
        return { target, platform: platform, version, kind: (kind.trim() || undefined), component, category: (category.trim() || undefined), situation, change, result };
    }
    finally {
        close();
    }
}
const editable = [
    ['target', 'Plugin/skill ID'], ['platform', 'Platform'], ['version', 'Version'], ['kind', 'Component kind'], ['component', 'Component name'],
    ['category', 'Category'], ['situation', 'Situation'], ['change', 'Change tried'], ['result', 'Observed result'],
];
async function interactiveEdit(current) {
    const { ask, close } = prompter('Input ended before the edit was confirmed; nothing was changed');
    try {
        output.write('Press Enter to keep a value, or type - to clear an optional one.\n');
        const patch = {};
        for (const [key, label] of editable) {
            const value = (await ask(`${label} [${current[key] ?? ''}]: `)).trim();
            if (value === '-')
                patch[key] = null;
            else if (value)
                patch[key] = value;
        }
        if (!Object.keys(patch).length)
            throw new Error('No changes entered');
        const approval = await ask('Save these changes? (y/N): ');
        if (!/^y(es)?$/i.test(approval.trim()))
            throw new Error('Learning was not changed');
        return patch;
    }
    finally {
        close();
    }
}
function renderPreview(id, preview) {
    const { draft, manifest, policy, findings, related } = preview;
    const lines = [`Repository: ${draft.repo}`, `New issue: ${draft.newIssueUrl}`, `Title: ${draft.title}`, `Maintainer settings: ${describeManifest(draft.repo, manifest)}`];
    lines.push(`Policy: ${policy.status === 'accepted' ? 'accepted' : policy.status === 'redirect' ? `feedback goes to ${policy.url}` : `BLOCKED, ${policy.reason}`}`, '', draft.body, '');
    lines.push(findings.length ? 'Privacy:' : 'Privacy: no sensitive values detected (the scan is a heuristic; review the text yourself)');
    for (const finding of findings)
        lines.push(`  ${finding.severity === 'block' ? 'BLOCKED' : 'warning'}: ${describeFinding(finding)}`);
    if (related.skipped)
        lines.push(`Duplicate check skipped (${related.skipped})`);
    else if (!related.issues.length)
        lines.push('Possible related issues: none found');
    else {
        lines.push('Possible related issues (titles written by others):');
        for (const issue of related.issues)
            lines.push(`  #${issue.number} [${issue.state}] ${issue.title} ${issue.url}`);
    }
    lines.push('');
    if (preview.sharedAs)
        lines.push(`Already shared: ${preview.sharedAs}`);
    else if (policy.status === 'blocked' || findings.some(item => item.severity === 'block'))
        lines.push('Not ready to share. Fix the problems above, for example with agent-learnings learn edit.');
    else {
        lines.push(`To submit after review: agent-learnings share ${id} --publish`);
        lines.push(`To add it to an existing issue instead: agent-learnings share ${id} --comment <issue-url>`);
    }
    return `${lines.join('\n')}\n`;
}
function warnSensitive(learning) {
    for (const finding of scanFields(learningFields(learning)).filter(item => item.severity === 'warn')) {
        process.stderr.write(`Warning: ${describeFinding(finding)}. Review before sharing.\n`);
    }
}
export async function main(args = process.argv.slice(2), cwd = process.cwd()) {
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
        if (scope !== 'project' && scope !== 'user')
            throw new Error('scope must be project or user');
        const platform = (v.platform ?? 'all');
        if (!installPlatforms.includes(platform))
            throw new Error(`platform must be one of ${installPlatforms.join(', ')}`);
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
        for (const [id, target] of Object.entries(targets))
            output.write(`${id}\t${target.repo}\n`);
        return;
    }
    if (command === 'learn' && action === 'add') {
        expect(p, v, 2, ['json'], 'learn add [--json <file|->]');
        const draft = v.json === undefined ? await interactiveDraft() : await readJsonInput(v.json);
        const learning = await addLearning(root, draft);
        output.write(`Saved learning ${learning.id}\n`);
        warnSensitive(learning);
        return;
    }
    if (command === 'learn' && action === 'edit') {
        expect(p, v, 3, ['json'], 'learn edit <id> [--json <file|->]');
        const patch = v.json === undefined ? await interactiveEdit(await getLearning(root, p[2])) : await readJsonInput(v.json);
        const { learning, changed } = await editLearning(root, p[2], patch);
        output.write(changed ? `Updated learning ${learning.id}\n` : `No changes to learning ${learning.id}\n`);
        if (changed)
            warnSensitive(learning);
        return;
    }
    if (command === 'learn' && action === 'remove') {
        expect(p, v, 3, ['yes'], 'learn remove <id> --yes');
        if (!v.yes)
            throw new Error(`Removing a learning deletes its file. Run again with --yes: agent-learnings learn remove ${p[2]} --yes`);
        const learning = await removeLearning(root, p[2]);
        output.write(`Removed learning ${learning.id}${learning.issueUrl ? `; the GitHub issue ${learning.issueUrl} remains` : ''}\n`);
        return;
    }
    if (command === 'learn' && action === 'list') {
        expect(p, v, 2, [], 'learn list');
        for (const item of await listLearnings(root))
            output.write(`${item.id}\t${item.target}\t${item.platform}\t${item.issueStatus ?? 'LOCAL'}\t${effectiveKind(item)}\t${effectiveCategory(item)}\n`);
        return;
    }
    if (command === 'learn' && action === 'show') {
        expect(p, v, 3, [], 'learn show <id>');
        const learning = await getLearning(root, p[2]);
        output.write(`ID: ${learning.id}\nTarget: ${learning.target}\nPlatform: ${learning.platform}\nVersion: ${learning.version ?? 'unknown'}\nKind: ${effectiveKind(learning)}\nComponent: ${learning.component ?? '-'}\nCategory: ${effectiveCategory(learning)}\nSituation: ${learning.situation}\nChange: ${learning.change}\nResult: ${learning.result}\nIssue: ${learning.issueUrl ?? 'not shared'}\n${learning.commentUrl ? `Comment: ${learning.commentUrl}\n` : ''}Status: ${learning.issueStatus ?? 'LOCAL'}\n`);
        return;
    }
    if (command === 'share') {
        const usage = 'share <id> [--publish|--comment <issue-url>|--attach <issue-url>|--status]';
        expect(p, v, 2, ['publish', 'status', 'attach', 'comment'], usage);
        const id = p[1];
        const modes = ['publish', 'status', 'attach', 'comment'].filter(key => v[key] !== undefined);
        if (modes.length > 1)
            throw new Error(`Usage: agent-learnings ${usage}`);
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
        if (p[2] !== 'on' && p[2] !== 'off')
            throw new Error(`Usage: agent-learnings ${usage}`);
        await setReminders(root, p[2] === 'on');
        output.write(`Reminders ${p[2]} for this project (.agent-learnings/config.json). AGENT_LEARNINGS_REMINDERS overrides this per user.\n`);
        return;
    }
    throw new Error(`Unknown command.\n${help}`);
}
async function readLimited(max) {
    const chunks = [];
    let size = 0;
    for await (const chunk of input) {
        size += chunk.length;
        if (size <= max)
            chunks.push(chunk);
    }
    return size > max ? '' : Buffer.concat(chunks).toString('utf8');
}
// Hidden entry point for agent hooks: `hook <platform:Event> [payload]`. It must never fail or hang the host agent.
async function hookMain(args) {
    setTimeout(() => process.exit(0), 2000).unref();
    output.on('error', () => { });
    try {
        const result = await runHook(args[0] ?? '', args[1] ?? await readLimited(4 * 1024 * 1024));
        if (result)
            output.write(`${result}\n`);
    }
    catch {
        // runHook already swallows errors; this guards stdin failures.
    }
    process.exitCode = 0;
}
const argv = process.argv.slice(2);
if (argv[0] === 'hook') {
    void hookMain(argv.slice(1));
}
else {
    main(argv).catch(error => {
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
    });
}
