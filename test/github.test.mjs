import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addLearning, addTarget, getLearning } from '../dist/store.js';
import { prepareIssue, publishIssue, refreshIssue, attachIssue, commentIssue, fetchManifest, previewShare, relatedQuery, issueTitle } from '../dist/github.js';
import { defaultManifest } from '../dist/manifest.js';

const project = () => mkdtemp(join(tmpdir(), 'agent-learnings-share-'));
const draft = { target: 'superpowers', platform: 'claude', situation: 'Repeated context loss', change: 'Add an explicit recap', result: 'The next task kept the constraints' };
const ok = stdout => ({ status: 0, stdout, stderr: '' });
const notFound = { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };

// Routes gh calls by subcommand; every call is recorded in `calls`.
function fakeGh(handlers = {}) {
  const calls = [];
  const runner = async (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    const key = args[0] === 'api' ? 'api' : `${args[0]} ${args[1]}`;
    const handler = handlers[key] ?? { api: notFound, 'issue list': ok('[]') }[key];
    if (!handler) throw new Error(`unexpected gh ${args.join(' ')}`);
    return typeof handler === 'function' ? handler(args) : handler;
  };
  return Object.assign(runner, { calls, count: key => calls.filter(args => (args[0] === 'api' ? 'api' : `${args[0]} ${args[1]}`) === key).length });
}

async function shared(extra = {}) {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, { ...draft, ...extra });
  return { root, id: record.id };
}

test('issue preview contains only the approved learning fields', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  const issue = await prepareIssue(root, record.id);
  assert.equal(issue.repo, 'obra/superpowers');
  assert.match(issue.body, /Repeated context loss/);
  assert.match(issue.body, /The next task kept the constraints/);
  assert.doesNotMatch(issue.body, /transcript/i);
});

test('publishing records the issue and prevents a duplicate', async () => {
  const { root, id } = await shared({ kind: 'skill', component: 'brainstorming' });
  const gh = fakeGh({
    'issue create': async args => {
      assert.ok(args.includes('--body-file'));
      assert.ok(!args.includes('--body'));
      assert.equal(args[args.indexOf('--title') + 1], '[agent-learnings] improvement: brainstorming - Repeated context loss');
      const body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      assert.match(body, /Repeated context loss/);
      assert.match(body, /<!-- agent-learnings \{"v":1,"kind":"skill","component":"brainstorming","category":"improvement","platform":"claude"\} -->$/);
      return ok('https://github.com/obra/superpowers/issues/42\n');
    },
  });
  assert.equal(await publishIssue(root, id, gh), 'https://github.com/obra/superpowers/issues/42');
  assert.equal((await getLearning(root, id)).issueStatus, 'OPEN');
  await assert.rejects(publishIssue(root, id, gh), /already shared/i);
  assert.equal(gh.count('issue create'), 1);
});

test('missing gh leaves the learning unchanged and returns a prepared fallback', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  const runner = async () => { const error = new Error('gh absent'); error.code = 'ENOENT'; throw error; };
  const result = await publishIssue(root, record.id, runner);
  assert.match(result, /github.com\/obra\/superpowers\/issues\/new/);
  assert.equal((await getLearning(root, record.id)).issueUrl, undefined);
});

test('unauthenticated gh returns a manual issue draft without marking the learning shared', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  const runner = async () => ({ status: 1, stdout: '', stderr: 'authentication required' });
  assert.match(await publishIssue(root, record.id, runner), /github.com\/obra\/superpowers\/issues\/new/);
  assert.equal((await getLearning(root, record.id)).issueUrl, undefined);
});

test('server failure leaves the learning unshared and reports the error', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  const runner = async () => ({ status: 1, stdout: '', stderr: 'server unavailable' });
  await assert.rejects(publishIssue(root, record.id, runner), /server unavailable/);
  assert.equal((await getLearning(root, record.id)).issueUrl, undefined);
});

test('issue status refresh reads GitHub state and updates the record', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  await publishIssue(root, record.id, fakeGh({ 'issue create': ok('https://github.com/obra/superpowers/issues/42') }));
  const result = await refreshIssue(root, record.id, async () => ({ status: 0, stdout: '{"state":"CLOSED"}', stderr: '' }));
  assert.equal(result, 'CLOSED');
  assert.equal((await getLearning(root, record.id)).issueStatus, 'CLOSED');
});

test('manually submitted issue can be attached for status tracking', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  await attachIssue(root, record.id, 'https://github.com/obra/superpowers/issues/77');
  assert.equal((await getLearning(root, record.id)).issueUrl, 'https://github.com/obra/superpowers/issues/77');
  await assert.rejects(attachIssue(root, record.id, 'https://github.com/obra/superpowers/issues/78'), /already shared/i);
});

test('manual issue attachment rejects links to another repository', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  await assert.rejects(attachIssue(root, record.id, 'https://github.com/another/project/issues/77'), /does not match/i);
  assert.equal((await getLearning(root, record.id)).issueUrl, undefined);
});

test('two simultaneous publish requests create only one GitHub issue', async () => {
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const runner = fakeGh({
    'issue create': async () => {
      started();
      await gate;
      return ok('https://github.com/obra/superpowers/issues/42');
    },
  });
  const first = publishIssue(root, record.id, runner);
  await began;
  setTimeout(() => release(), 100);
  await assert.rejects(publishIssue(root, record.id, runner), /in progress/i);
  await assert.rejects(attachIssue(root, record.id, 'https://github.com/obra/superpowers/issues/77'), /in progress/i);
  await first;
  assert.equal(runner.count('issue create'), 1);
});

test('issue marker cannot close the HTML comment and titles are shortened', async () => {
  const { root, id } = await shared({ component: 'evil --> <b>x</b>', situation: 'word '.repeat(40) });
  const issue = await prepareIssue(root, id);
  const marker = issue.body.split('\n').at(-1);
  assert.equal(marker.indexOf('-->'), marker.length - 3);
  assert.equal(JSON.parse(marker.slice('<!-- agent-learnings '.length, -' -->'.length)).component, 'evil --> <b>x</b>');
  assert.ok(issue.title.endsWith('...'));
  assert.ok(issueTitle(await getLearning(root, id), '[x]').length <= 200);
});

test('maintainer settings default when absent and are reported when unchecked', async () => {
  assert.equal((await fetchManifest('obra/superpowers', fakeGh())).source, 'default');
  assert.equal((await fetchManifest('obra/superpowers', fakeGh({ api: { status: 1, stdout: '', stderr: 'gh auth login required' } }))).source, 'unchecked');
  const missing = async () => { const error = new Error('gh absent'); error.code = 'ENOENT'; throw error; };
  assert.equal((await fetchManifest('obra/superpowers', missing)).source, 'unchecked');
  const custom = await fetchManifest('obra/superpowers', fakeGh({ api: ok('{"schemaVersion":1,"titlePrefix":"[learning]"}') }));
  assert.equal(custom.manifest.titlePrefix, '[learning]');
});

test('maintainer settings can block or redirect sharing without creating an issue', async () => {
  for (const [manifest, expected] of [
    ['{"schemaVersion":1,"accepting":false}', /not accepting/],
    ['{"schemaVersion":1,"categories":["bug"]}', /category improvement is not accepted/],
    ['{"schemaVersion":1,"kinds":["skill"]}', /kind other is not accepted/],
    ['{"schemaVersion":2}', /invalid/],
    [{ status: 1, stdout: '', stderr: 'HTTP 502' }, /could not read maintainer settings.*HTTP 502/],
  ]) {
    const { root, id } = await shared();
    const gh = fakeGh({ api: typeof manifest === 'string' ? ok(manifest) : manifest });
    await assert.rejects(publishIssue(root, id, gh), expected);
    assert.equal(gh.count('issue create'), 0);
    assert.equal((await getLearning(root, id)).issueUrl, undefined);
  }
  const { root, id } = await shared();
  const gh = fakeGh({ api: ok('{"schemaVersion":1,"feedbackUrl":"https://example.com/feedback"}') });
  assert.match(await publishIssue(root, id, gh), /collect feedback at https:\/\/example\.com\/feedback/);
  assert.equal(gh.count('issue create'), 0);
  assert.equal((await getLearning(root, id)).issueUrl, undefined);
});

test('records containing secrets are never sent, even through the manual fallback', async () => {
  const { root, id } = await shared();
  const path = join(root, '.agent-learnings/learnings', `${id}.md`);
  const token = 'gh' + 'p_' + 'R5t6'.repeat(9);
  await writeFile(path, (await readFile(path, 'utf8')).replaceAll('Add an explicit recap', `Add ${token}`));
  const gh = fakeGh();
  await assert.rejects(publishIssue(root, id, gh), /Refusing to share/);
  const missing = async () => { const error = new Error('gh absent'); error.code = 'ENOENT'; throw error; };
  await assert.rejects(publishIssue(root, id, missing), /Refusing to share/);
  await assert.rejects(commentIssue(root, id, 'https://github.com/obra/superpowers/issues/1', gh), /Refusing to share/);
  assert.equal(gh.calls.length, 0);
  const preview = await previewShare(root, id, gh);
  assert.ok(!preview.draft.body.includes(token));
  assert.match(preview.related.skipped, /sensitive/);
});

test('related issue search sends only published metadata and cleans results', async () => {
  const { root, id } = await shared({ component: 'brainstorming' });
  const gh = fakeGh({
    'issue list': ok(JSON.stringify([
      { number: 7, title: 'Brainstorming \u001b[31mloses‮ context\nagain', url: 'https://github.com/obra/superpowers/issues/7', state: 'OPEN' },
      { number: 8, title: 'elsewhere', url: 'https://github.com/other/repo/issues/8', state: 'OPEN' },
    ])),
  });
  const preview = await previewShare(root, id, gh);
  const search = gh.calls.find(args => args[1] === 'list');
  assert.equal(search[search.indexOf('--search') + 1], '"brainstorming" in:title');
  assert.ok(!search.join(' ').includes('context loss'));
  assert.deepEqual(preview.related.issues.map(issue => issue.number), [7]);
  assert.equal(preview.related.issues[0].title, 'Brainstorming [31mloses context again');
  assert.equal(relatedQuery(await getLearning(root, id), defaultManifest), '"brainstorming" in:title');
  assert.match((await previewShare(root, id, fakeGh({ 'issue list': { status: 1, stdout: '', stderr: 'boom' } }))).related.skipped, /boom/);
});

test('a learning can be added to an existing issue as a comment', async () => {
  const { root, id } = await shared();
  const gh = fakeGh({
    'issue view': ok('{"state":"OPEN"}'),
    'issue comment': async args => {
      assert.match(await readFile(args[args.indexOf('--body-file') + 1], 'utf8'), /Repeated context loss/);
      return ok('https://github.com/obra/superpowers/issues/7#issuecomment-99\n');
    },
  });
  assert.equal(await commentIssue(root, id, 'https://github.com/obra/superpowers/issues/7', gh), 'https://github.com/obra/superpowers/issues/7#issuecomment-99');
  const learning = await getLearning(root, id);
  assert.deepEqual([learning.issueUrl, learning.commentUrl, learning.issueStatus], ['https://github.com/obra/superpowers/issues/7', 'https://github.com/obra/superpowers/issues/7#issuecomment-99', 'OPEN']);
  await assert.rejects(commentIssue(root, id, 'https://github.com/obra/superpowers/issues/7', gh), /already shared/);

  const other = await shared();
  const foreign = fakeGh();
  await assert.rejects(commentIssue(other.root, other.id, 'https://github.com/another/project/issues/7', foreign), /does not match/);
  assert.equal(foreign.calls.length, 0);
  const missing = async () => { const error = new Error('gh absent'); error.code = 'ENOENT'; throw error; };
  assert.match(await commentIssue(other.root, other.id, 'https://github.com/obra/superpowers/issues/7', missing), /add this comment:[\s\S]*--attach/);
  assert.equal((await getLearning(other.root, other.id)).issueUrl, undefined);
  const odd = fakeGh({ 'issue view': ok('{"state":"CLOSED"}'), 'issue comment': ok('Comment added') });
  assert.equal(await commentIssue(other.root, other.id, 'https://github.com/obra/superpowers/issues/7', odd), 'https://github.com/obra/superpowers/issues/7');
  assert.equal((await getLearning(other.root, other.id)).issueStatus, 'CLOSED');
});

test('attaching a comment link stores both the issue and the comment', async () => {
  const { root, id } = await shared();
  assert.equal(await attachIssue(root, id, 'https://github.com/obra/superpowers/issues/7#issuecomment-5'), 'https://github.com/obra/superpowers/issues/7#issuecomment-5');
  assert.equal((await getLearning(root, id)).issueUrl, 'https://github.com/obra/superpowers/issues/7');
});
