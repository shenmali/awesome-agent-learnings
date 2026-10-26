import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const project = () => mkdtemp(join(tmpdir(), 'agent-learnings-cli-'));
const bin = new URL('../plugins/agent-learnings/dist/cli.js', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
// A missing gh binary keeps CLI tests offline and deterministic.
const env = { ...process.env, AGENT_LEARNINGS_GH: join(tmpdir(), 'agent-learnings-no-gh') };
const run = (cwd, args, input) => spawnSync(process.execPath, [bin, ...args], { cwd, input, encoding: 'utf8', env });

test('CLI installs skills, stores an approved JSON draft, lists it, and previews an issue', async () => {
  const cwd = await project();
  assert.equal(run(cwd, ['init', '--scope', 'project']).status, 0);
  assert.equal(run(cwd, ['target', 'add', 'superpowers', 'obra/superpowers']).status, 0);
  const draft = { target: 'superpowers', platform: 'opencode', situation: 'A task skipped review', change: 'I added an explicit review step', result: 'The final answer included a review finding' };
  const added = run(cwd, ['learn', 'add', '--json', '-'], JSON.stringify(draft));
  assert.equal(added.status, 0, added.stderr);
  const id = added.stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0];
  assert.ok(id);
  assert.match(run(cwd, ['learn', 'list']).stdout, new RegExp(id));
  assert.match(run(cwd, ['learn', 'show', id]).stdout, /A task skipped review/);
  const preview = run(cwd, ['share', id]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /github.com\/obra\/superpowers\/issues\/new/);
  assert.match(preview.stdout, /I added an explicit review step/);
  assert.match(preview.stdout, /Maintainer settings: not checked/);
  assert.match(preview.stdout, /Duplicate check skipped/);
  assert.match(preview.stdout, /--comment <issue-url>/);
  assert.match(await readFile(join(cwd, '.agent-learnings/learnings', `${id}.md`), 'utf8'), /## Observed result/);
});

test('CLI rejects incomplete learning draft and does not create a record', async () => {
  const cwd = await project();
  const result = run(cwd, ['learn', 'add', '--json', '-'], JSON.stringify({ target: 'superpowers', platform: 'codex', situation: 'x', change: 'y' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /result is required/);
});

test('CLI called from a nested directory stores project data at the repository root', async () => {
  const cwd = await project();
  const nested = join(cwd, 'packages', 'app');
  await mkdir(join(cwd, '.git'));
  await mkdir(nested, { recursive: true });
  const draft = { target: 'superpowers', platform: 'codex', situation: 'Lost constraints', change: 'Added a recap', result: 'Constraints were retained' };
  const added = run(nested, ['learn', 'add', '--json', '-'], JSON.stringify(draft));
  assert.equal(added.status, 0, added.stderr);
  const id = added.stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0];
  assert.ok(id);
  assert.match(await readFile(join(cwd, '.agent-learnings/learnings', `${id}.md`), 'utf8'), /Lost constraints/);
});

test('CLI attaches a manually opened GitHub issue', async () => {
  const cwd = await project();
  run(cwd, ['target', 'add', 'superpowers', 'obra/superpowers']);
  const draft = { target: 'superpowers', platform: 'codex', situation: 'x', change: 'y', result: 'z' };
  const id = run(cwd, ['learn', 'add', '--json', '-'], JSON.stringify(draft)).stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0];
  assert.ok(id);
  const attached = run(cwd, ['share', id, '--attach', 'https://github.com/obra/superpowers/issues/77']);
  assert.equal(attached.status, 0, attached.stderr);
  assert.match(run(cwd, ['learn', 'show', id]).stdout, /issues\/77/);
});

test('CLI accepts option forms in any order and rejects unknown or conflicting options', async () => {
  const cwd = await project();
  run(cwd, ['target', 'add', 'superpowers', 'obra/superpowers']);
  const draft = { target: 'superpowers', platform: 'codex', situation: 'x', change: 'y', result: 'z' };
  const added = run(cwd, ['learn', 'add', '--json=-'], JSON.stringify(draft));
  assert.equal(added.status, 0, added.stderr);
  const id = added.stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0];
  assert.ok(id);
  const attached = run(cwd, ['share', '--attach', 'https://github.com/obra/superpowers/issues/9', id]);
  assert.equal(attached.status, 0, attached.stderr);
  for (const args of [['share', id, '--publish', '--status'], ['learn', 'list', '--publish'], ['share', id, '--bogus'], ['learn', 'show'], ['target', 'add', 'only-id']]) {
    const result = run(cwd, args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage|Unknown option/);
  }
  assert.match(run(cwd, ['--version']).stdout, /^\d+\.\d+\.\d+\n$/);
});

test('CLI interactive add fails instead of silently exiting when input ends', async () => {
  const cwd = await project();
  const result = run(cwd, ['learn', 'add'], '');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nothing was saved/);
});

test('CLI edits, shows and removes a learning', async () => {
  const cwd = await project();
  run(cwd, ['target', 'add', 'superpowers', 'obra/superpowers']);
  const draft = { target: 'superpowers', platform: 'claude', situation: 'x', change: 'y', result: 'z' };
  const id = run(cwd, ['learn', 'add', '--json', '-'], JSON.stringify(draft)).stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0];
  assert.ok(id);
  const edited = run(cwd, ['learn', 'edit', id, '--json', '-'], JSON.stringify({ kind: 'skill', component: 'brainstorming', category: 'bug' }));
  assert.equal(edited.status, 0, edited.stderr);
  assert.match(edited.stdout, /Updated learning/);
  const shown = run(cwd, ['learn', 'show', id]).stdout;
  assert.match(shown, /Kind: skill\nComponent: brainstorming\nCategory: bug/);
  assert.match(run(cwd, ['learn', 'list']).stdout, new RegExp(`${id}\\tsuperpowers\\tclaude\\tLOCAL\\tskill\\tbug`));
  run(cwd, ['share', id, '--attach', 'https://github.com/obra/superpowers/issues/3']);
  assert.match(run(cwd, ['learn', 'edit', id, '--json', '-'], '{"result":"w"}').stderr, /already shared/);
  assert.match(run(cwd, ['learn', 'remove', id]).stderr, /--yes/);
  const removed = run(cwd, ['learn', 'remove', id, '--yes']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /issues\/3 remains/);
  assert.match(run(cwd, ['learn', 'show', id]).stderr, /not found/);
});

test('CLI warns about personal details and refuses secrets', async () => {
  const cwd = await project();
  const draft = { target: 'superpowers', platform: 'codex', situation: 'Asked alice@company.io', change: 'y', result: 'z' };
  const warned = run(cwd, ['learn', 'add', '--json', '-'], JSON.stringify(draft));
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stderr, /Warning: possible email address in situation/);
  const token = 'np' + 'm_' + 'Q1w2'.repeat(9);
  const refused = run(cwd, ['learn', 'add', '--json', '-'], JSON.stringify({ ...draft, situation: `Used ${token}` }));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /npm token/);
  assert.ok(!refused.stderr.includes(token));
});

test('CLI configures reminders and runs hooks without ever failing', async () => {
  const cwd = await project();
  assert.match(run(cwd, ['config', 'reminders']).stdout, /Reminders: off \(default\)/);
  assert.equal(run(cwd, ['config', 'reminders', 'on']).status, 0);
  assert.match(run(cwd, ['config', 'reminders']).stdout, /Reminders: on \(\.agent-learnings\/config\.json\)/);
  assert.equal(run(cwd, ['config', 'reminders', 'maybe']).status, 1);
  const state = await mkdtemp(join(tmpdir(), 'agent-learnings-state-'));
  const hook = (event, payload) => spawnSync(process.execPath, [bin, 'hook', event], { cwd, input: payload, encoding: 'utf8', env: { ...env, AGENT_LEARNINGS_STATE_DIR: state } });
  const used = hook('claude:PostToolUse', JSON.stringify({ session_id: 'cli', cwd, tool_name: 'Skill', tool_input: { skill: 'superpowers:writing-plans' } }));
  assert.deepEqual([used.status, used.stdout], [0, '']);
  const stop = hook('claude:Stop', JSON.stringify({ session_id: 'cli', cwd }));
  assert.equal(stop.status, 0);
  assert.match(JSON.parse(stop.stdout).systemMessage, /writing-plans/);
  assert.equal(hook('claude:Stop', JSON.stringify({ session_id: 'cli', cwd })).stdout, '');
  for (const [event, payload] of [['claude:Stop', 'garbage'], ['nope', '{}'], ['', '']]) {
    const result = hook(event, payload);
    assert.deepEqual([result.status, result.stdout], [0, ''], event);
  }
  run(cwd, ['config', 'reminders', 'off']);
  assert.equal(hook('claude:PostToolUse', JSON.stringify({ session_id: 'quiet', cwd, tool_name: 'Skill', tool_input: { skill: 'x' } })).status, 0);
  assert.equal((await readdir(state)).length, 1);
});

test('CLI hook exits on its own when stdin never closes', async () => {
  const started = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, [bin, 'hook', 'claude:Stop'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('exit', code => resolve(code));
  });
  assert.equal(result, 0);
  assert.ok(Date.now() - started < 5000);
});

test('CLI auto mode: config, auto-saved learnings, pending review and batch publish', async () => {
  const cwd = await project();
  assert.match(run(cwd, ['config', 'mode']).stdout, /Mode: manual \(default\)/);
  assert.match(run(cwd, ['config', 'mode', 'auto']).stdout, /publishing still needs approval/);
  assert.match(run(cwd, ['config', 'mode']).stdout, /Mode: auto \(\.agent-learnings\/config\.json\)/);
  assert.equal(run(cwd, ['config', 'mode', 'yolo']).status, 1);
  assert.equal(run(cwd, ['learn', 'add', '--auto']).status, 1);
  run(cwd, ['target', 'add', 'superpowers', 'obra/superpowers']);
  const draft = situation => JSON.stringify({ target: 'superpowers', platform: 'claude', situation, change: 'y', result: 'z' });
  const ids = ['First auto', 'Second auto'].map(text => run(cwd, ['learn', 'add', '--json', '-', '--auto'], draft(text)).stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0]);
  const manual = run(cwd, ['learn', 'add', '--json', '-'], draft('Manual one')).stdout.match(/\d{8}-[a-f0-9]{8}/)?.[0];
  assert.ok(ids.every(Boolean) && manual);
  assert.match(run(cwd, ['learn', 'show', ids[0]]).stdout, /Origin: auto/);
  assert.match(run(cwd, ['learn', 'list']).stdout, new RegExp(`${ids[0]}\\t.*\\tauto\\n`));
  const pending = run(cwd, ['share', '--pending']);
  assert.equal(pending.status, 0, pending.stderr);
  assert.match(pending.stdout, /First auto[\s\S]*Second auto/);
  assert.doesNotMatch(pending.stdout, /Manual one/);
  assert.equal(pending.stdout.match(/--publish/g).length, 1);
  assert.match(pending.stdout, new RegExp(`share ${ids[0]} ${ids[1]} --publish`));
  const batch = run(cwd, ['share', ids[0], '20991231-deadbeef', ids[1], '--publish']);
  assert.equal(batch.status, 1);
  assert.match(batch.stdout, new RegExp(`${ids[0]}: GitHub CLI is unavailable[\\s\\S]*${ids[1]}: GitHub CLI is unavailable`));
  assert.match(batch.stderr, /20991231-deadbeef: Learning 20991231-deadbeef not found/);
  assert.equal(run(cwd, ['share', ids[0], ids[1], '--status']).status, 1);
});
