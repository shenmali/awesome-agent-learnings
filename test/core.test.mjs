import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSkills } from '../dist/install.js';
import { addTarget, getTarget, addLearning, listLearnings, getLearning, updateLearning } from '../dist/store.js';

const project = () => mkdtemp(join(tmpdir(), 'agent-learnings-'));
const draft = { target: 'superpowers', platform: 'codex', situation: 'Plans missed review gates', change: 'Add a final review step', result: 'Review caught a missing test', version: '7.0.1' };

test('project install creates Codex/OpenCode and Claude skills without overwriting edits', async () => {
  const root = await project();
  const paths = await initSkills({ scope: 'project', cwd: root });
  assert.equal(paths.length, 2);
  const codex = join(root, '.agents/skills/agent-learnings/SKILL.md');
  const claude = join(root, '.claude/skills/agent-learnings/SKILL.md');
  assert.match(await readFile(codex, 'utf8'), /learn add/);
  assert.match(await readFile(codex, 'utf8'), /npx --yes agent-learnings@0\.1\.0/);
  assert.match(await readFile(claude, 'utf8'), /disable-model-invocation: true/);
  await writeFile(codex, 'personal edit');
  const second = await initSkills({ scope: 'project', cwd: root });
  assert.deepEqual(second, []);
  assert.equal(await readFile(codex, 'utf8'), 'personal edit');
});

test('user install uses the home directory and keeps project learning files separate', async () => {
  const root = await project();
  const home = await project();
  await initSkills({ scope: 'user', cwd: root, home });
  assert.match(await readFile(join(home, '.agents/skills/agent-learnings/SKILL.md'), 'utf8'), /learn add/);
  assert.doesNotMatch(await readFile(join(home, '.agents/skills/agent-learnings/SKILL.md'), 'utf8'), /npx --yes/);
  assert.match(await readFile(join(home, '.claude/skills/agent-learnings/SKILL.md'), 'utf8'), /learn add/);
  await assert.rejects(readFile(join(root, '.agent-learnings/config.json'), 'utf8'));
});

test('target mapping normalizes GitHub repository and rejects non-GitHub destinations', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'https://github.com/obra/superpowers.git');
  assert.equal((await getTarget(root, 'superpowers')).repo, 'obra/superpowers');
  await assert.rejects(addTarget(root, 'bad', 'https://example.com/other/repo'));
  await assert.rejects(addTarget(root, '__proto__', 'obra/superpowers'), /target/i);
  assert.equal(await getTarget(root, 'constructor'), undefined);
  await assert.rejects(addTarget(root, 'wrong', 'owner/..'), /repository/i);
});

test('learning records approved fields and can be read back as Markdown', async () => {
  const root = await project();
  const record = await addLearning(root, draft);
  assert.match(record.id, /^[0-9]{8}-[a-f0-9]{8}$/);
  assert.equal((await getLearning(root, record.id)).result, draft.result);
  assert.equal((await listLearnings(root))[0].target, 'superpowers');
  const markdown = await readFile(join(root, '.agent-learnings/learnings', `${record.id}.md`), 'utf8');
  assert.match(markdown, /## Observed result\nReview caught a missing test/);
  assert.doesNotMatch(markdown, /conversation|transcript/i);
  await updateLearning(root, record.id, { result: 'Review caught two missing tests' });
  assert.equal((await getLearning(root, record.id)).result, 'Review caught two missing tests');
});

test('learning requires the three evidence fields', async () => {
  const root = await project();
  await assert.rejects(addLearning(root, { ...draft, result: ' ' }), /result/i);
});

test('learning preserves literal section markers inside approved text', async () => {
  const root = await project();
  const marked = {
    ...draft,
    situation: 'Before\n<!-- agent-learnings:change -->\n## Change\nafter',
    change: 'Tried\n<!-- agent-learnings:result -->\n## Observed result\nafter',
  };
  const record = await addLearning(root, marked);
  const reloaded = await getLearning(root, record.id);
  assert.equal(reloaded.situation, marked.situation);
  assert.equal(reloaded.change, marked.change);
});

test('manual body edits are detected rather than silently discarded', async () => {
  const root = await project();
  const record = await addLearning(root, draft);
  const path = join(root, '.agent-learnings/learnings', `${record.id}.md`);
  await writeFile(path, (await readFile(path, 'utf8')).replace('Review caught a missing test', 'Review caught another test'));
  await assert.rejects(getLearning(root, record.id), /body differs/i);
});
