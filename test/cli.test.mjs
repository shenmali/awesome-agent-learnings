import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const project = () => mkdtemp(join(tmpdir(), 'agent-learnings-cli-'));
const bin = new URL('../dist/cli.js', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const run = (cwd, args, input) => spawnSync(process.execPath, [bin, ...args], { cwd, input, encoding: 'utf8' });

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
