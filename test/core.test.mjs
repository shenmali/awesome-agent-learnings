import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSkills } from '../plugins/agent-learnings/dist/install.js';
import { addTarget, getTarget, addLearning, listLearnings, getLearning, updateLearning, editLearning, removeLearning, withLearningLock, effectiveKind, effectiveCategory, getMode, setMode } from '../plugins/agent-learnings/dist/store.js';
import { refreshIssue } from '../plugins/agent-learnings/dist/github.js';

const project = () => mkdtemp(join(tmpdir(), 'agent-learnings-'));
const draft = { target: 'superpowers', platform: 'codex', situation: 'Plans missed review gates', change: 'Add a final review step', result: 'Review caught a missing test', version: '7.0.1' };

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const skills = ['capture-learning', 'share-learning', 'manage-learnings'];

test('project install creates Codex, OpenCode and Claude skills without overwriting edits', async () => {
  const root = await project();
  const paths = await initSkills({ scope: 'project', cwd: root });
  assert.equal(paths.length, 12);
  const codex = join(root, '.agents/skills/capture-learning/SKILL.md');
  const claude = join(root, '.claude/skills/capture-learning/SKILL.md');
  assert.match(await readFile(codex, 'utf8'), /learn add --json/);
  assert.match(await readFile(codex, 'utf8'), new RegExp(`npx --yes agent-learnings@${version.replaceAll('.', '\\.')} learn add`));
  assert.match(await readFile(codex, 'utf8'), /disable-model-invocation: true/);
  assert.doesNotMatch(await readFile(codex, 'utf8'), /allowed-tools|opencode\//);
  assert.match(await readFile(join(root, '.agents/skills/capture-learning/agents/openai.yaml'), 'utf8'), /allow_implicit_invocation: false/);
  assert.match(await readFile(claude, 'utf8'), /allowed-tools: Bash\(npx --yes agent-learnings@[\d.]+ learn \*\)/);
  assert.match(await readFile(join(root, '.opencode/commands/share-learning.md'), 'utf8'), /share <id> --publish[\s\S]*\$ARGUMENTS/);
  for (const name of skills) assert.match(await readFile(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8'), new RegExp(`name: ${name}`));
  await writeFile(codex, 'personal edit');
  const second = await initSkills({ scope: 'project', cwd: root });
  assert.deepEqual(second, []);
  assert.equal(await readFile(codex, 'utf8'), 'personal edit');
});

test('install can target one platform', async () => {
  const root = await project();
  const opencode = (await initSkills({ scope: 'project', cwd: root, platform: 'opencode' })).map(path => path.slice(root.length + 1).replaceAll('\\', '/'));
  assert.ok(opencode.every(path => path.startsWith('.agents/skills/') || path.startsWith('.opencode/commands/')));
  assert.equal(opencode.length, 9);
  const claudeOnly = await project();
  assert.ok((await initSkills({ scope: 'project', cwd: claudeOnly, platform: 'claude' })).every(path => path.includes(join('.claude', 'skills'))));
});

test('user install uses the home directory and keeps project learning files separate', async () => {
  const root = await project();
  const home = await project();
  await initSkills({ scope: 'user', cwd: root, home });
  const skill = await readFile(join(home, '.agents/skills/capture-learning/SKILL.md'), 'utf8');
  assert.match(skill, /`agent-learnings learn add --json/);
  assert.doesNotMatch(skill, /npx --yes/);
  assert.match(await readFile(join(home, '.claude/skills/capture-learning/SKILL.md'), 'utf8'), /learn add/);
  assert.match(await readFile(join(home, '.config/opencode/commands/capture-learning.md'), 'utf8'), /learn add/);
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

const v01 = [
  '---',
  'id: "20261026-0a1b2c3d"',
  'target: "superpowers"',
  'platform: "codex"',
  'version: "7.0.1"',
  'createdAt: "2026-10-26T08:00:00.000Z"',
  'content: {"situation":"Plans missed review gates","change":"Add a final review step","result":"Review caught a missing test"}',
  '---',
  '',
  '# Learning: superpowers',
  '',
  '## Situation',
  'Plans missed review gates',
  '',
  '## Change',
  'Add a final review step',
  '',
  '## Observed result',
  'Review caught a missing test',
  '',
].join('\n');

async function writeRecord(root, text, id = '20261026-0a1b2c3d') {
  await mkdir(join(root, '.agent-learnings/learnings'), { recursive: true });
  const path = join(root, '.agent-learnings/learnings', `${id}.md`);
  await writeFile(path, text);
  return path;
}

test('records written by 0.1.0 still load and round-trip byte for byte', async () => {
  for (const text of [v01, v01.replace('content:', 'issueUrl: "https://github.com/obra/superpowers/issues/4"\nissueStatus: "OPEN"\ncontent:')]) {
    const root = await project();
    const path = await writeRecord(root, text);
    const record = await getLearning(root, '20261026-0a1b2c3d');
    assert.equal(record.result, 'Review caught a missing test');
    assert.equal(effectiveKind(record), 'other');
    assert.equal(effectiveCategory(record), 'improvement');
    await updateLearning(root, record.id, {});
    assert.equal(await readFile(path, 'utf8'), text);
    assert.equal((await listLearnings(root)).length, 1);
  }
  const crlf = await project();
  await writeRecord(crlf, v01.replace(/\n/g, '\r\n'));
  assert.equal((await getLearning(crlf, '20261026-0a1b2c3d')).situation, 'Plans missed review gates');
});

test('component metadata is stored in front matter and the body keeps the 0.1 layout', async () => {
  const root = await project();
  const record = await addLearning(root, { ...draft, kind: 'skill', component: 'writing-plans', category: 'bug' });
  const markdown = await readFile(join(root, '.agent-learnings/learnings', `${record.id}.md`), 'utf8');
  assert.match(markdown, /\nkind: "skill"\ncomponent: "writing-plans"\ncategory: "bug"\n/);
  assert.ok(markdown.endsWith(v01.slice(v01.indexOf('# Learning'))));
  const reloaded = await getLearning(root, record.id);
  assert.deepEqual([reloaded.kind, reloaded.component, reloaded.category], ['skill', 'writing-plans', 'bug']);
  const plain = await addLearning(root, draft);
  assert.doesNotMatch(await readFile(join(root, '.agent-learnings/learnings', `${plain.id}.md`), 'utf8'), /kind:|category:/);
});

test('learning input is validated strictly', async () => {
  const root = await project();
  for (const [input, message] of [
    [{ ...draft, kind: 'tool' }, /kind must be one of/],
    [{ ...draft, category: 'idea' }, /category must be one of/],
    [{ ...draft, component: 'two\nlines' }, /single line/],
    [{ ...draft, component: 'x'.repeat(81) }, /single line/],
    [{ ...draft, version: 7 }, /version must be a string/],
    [{ ...draft, categroy: 'bug' }, /Unknown learning field categroy/],
    [['not', 'an', 'object'], /must be an object/],
  ]) await assert.rejects(addLearning(root, input), message);
  await assert.rejects(readFile(join(root, '.agent-learnings/learnings')), { code: 'ENOENT' });
});

test('unknown stored values point at a newer agent-learnings', async () => {
  const root = await project();
  await writeRecord(root, v01.replace('createdAt:', 'kind: "workflow"\ncreatedAt:'));
  await assert.rejects(getLearning(root, '20261026-0a1b2c3d'), /newer agent-learnings/);
});

test('editing changes only the given fields and never adds defaults', async () => {
  const root = await project();
  const path = await writeRecord(root, v01);
  const { learning, changed } = await editLearning(root, '20261026-0a1b2c3d', { result: 'Review caught two missing tests', version: null });
  assert.equal(changed, true);
  assert.equal(learning.createdAt, '2026-10-26T08:00:00.000Z');
  assert.equal(learning.version, undefined);
  const edited = await readFile(path, 'utf8');
  assert.doesNotMatch(edited, /kind:|category:|version:/);
  assert.match(edited, /Review caught two missing tests/);
  assert.equal((await editLearning(root, '20261026-0a1b2c3d', { result: 'Review caught two missing tests' })).changed, false);
  assert.equal(await readFile(path, 'utf8'), edited);
  await assert.rejects(editLearning(root, '20261026-0a1b2c3d', {}), /No fields/);
  await assert.rejects(editLearning(root, '20261026-0a1b2c3d', { situaton: 'x' }), /Unknown learning field/);
  await assert.rejects(editLearning(root, '20261026-0a1b2c3d', { situation: '' }), /situation is required/);
  const tagged = await editLearning(root, '20261026-0a1b2c3d', { kind: 'skill', component: 'brainstorming' });
  assert.equal(tagged.learning.kind, 'skill');
  assert.equal((await updateLearning(root, '20261026-0a1b2c3d', { issueStatus: 'OPEN' })).component, 'brainstorming');
});

test('shared learnings cannot be edited and removing one keeps the issue', async () => {
  const root = await project();
  const record = await addLearning(root, draft);
  await updateLearning(root, record.id, { issueUrl: 'https://github.com/obra/superpowers/issues/5', issueStatus: 'OPEN' });
  await assert.rejects(editLearning(root, record.id, { result: 'x' }), /already shared/);
  assert.equal((await removeLearning(root, record.id)).issueUrl, 'https://github.com/obra/superpowers/issues/5');
  await assert.rejects(getLearning(root, record.id), /not found/);
});

test('edit, remove and status refresh respect the per-learning lock', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  await updateLearning(root, record.id, { issueUrl: 'https://github.com/obra/superpowers/issues/5' });
  const lock = join(root, '.agent-learnings/learnings', `${record.id}.share.lock`);
  await writeFile(lock, 'stale');
  await assert.rejects(editLearning(root, record.id, { result: 'x' }), /in progress/);
  await assert.rejects(removeLearning(root, record.id), /in progress/);
  await assert.rejects(refreshIssue(root, record.id, async () => ({ status: 0, stdout: '{"state":"OPEN"}', stderr: '' })), /in progress/);
  assert.equal(await readFile(lock, 'utf8'), 'stale');
  await assert.rejects(withLearningLock(root, '../x', async () => {}), /Invalid learning id/);
});

test('secrets are refused before anything is written and are not echoed', async () => {
  const root = await project();
  const token = 'gh' + 'p_' + 'Z9y8'.repeat(9);
  await assert.rejects(addLearning(root, { ...draft, change: `export GH=${token}` }), error => /GitHub token in change/.test(error.message) && !error.message.includes(token));
  await assert.rejects(readFile(join(root, '.agent-learnings/learnings')), { code: 'ENOENT' });
  const record = await addLearning(root, draft);
  await assert.rejects(editLearning(root, record.id, { result: `token ${token}` }), /Refusing to save this edit/);
  assert.equal((await getLearning(root, record.id)).result, draft.result);
});

test('auto-saved learnings are marked in the front matter only', async () => {
  const root = await project();
  const auto = await addLearning(root, draft, { auto: true });
  const markdown = await readFile(join(root, '.agent-learnings/learnings', `${auto.id}.md`), 'utf8');
  assert.match(markdown, /\ncreatedAt: ".*"\norigin: "auto"\n/);
  assert.ok(markdown.endsWith(v01.slice(v01.indexOf('# Learning'))));
  assert.equal((await getLearning(root, auto.id)).origin, 'auto');
  assert.equal((await updateLearning(root, auto.id, { issueStatus: 'OPEN' })).origin, 'auto');
  const manual = await addLearning(root, draft);
  assert.doesNotMatch(await readFile(join(root, '.agent-learnings/learnings', `${manual.id}.md`), 'utf8'), /origin:/);
});

test('mode is stored in the project config and validated', async () => {
  const root = await project();
  assert.equal(await getMode(root), undefined);
  await addTarget(root, 'superpowers', 'obra/superpowers');
  await setMode(root, 'auto');
  assert.equal(await getMode(root), 'auto');
  assert.equal((await getTarget(root, 'superpowers')).repo, 'obra/superpowers');
  await writeFile(join(root, '.agent-learnings/config.json'), '{"schemaVersion":1,"targets":{},"mode":"yolo"}');
  await assert.rejects(getMode(root), /config mode must be manual or auto/);
});
