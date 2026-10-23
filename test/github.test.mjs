import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addLearning, addTarget, getLearning } from '../dist/store.js';
import { prepareIssue, publishIssue, refreshIssue, attachIssue } from '../dist/github.js';

const project = () => mkdtemp(join(tmpdir(), 'agent-learnings-share-'));
const draft = { target: 'superpowers', platform: 'claude', situation: 'Repeated context loss', change: 'Add an explicit recap', result: 'The next task kept the constraints' };

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
  const root = await project();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  const record = await addLearning(root, draft);
  const runner = async (command, args) => {
    assert.equal(command, 'gh');
    assert.ok(args.includes('--body-file'));
    assert.ok(!args.includes('--body'));
    const body = await (await import('node:fs/promises')).readFile(args[args.indexOf('--body-file') + 1], 'utf8');
    assert.match(body, /Repeated context loss/);
    return { status: 0, stdout: 'https://github.com/obra/superpowers/issues/42\n', stderr: '' };
  };
  assert.equal(await publishIssue(root, record.id, runner), 'https://github.com/obra/superpowers/issues/42');
  assert.equal((await getLearning(root, record.id)).issueStatus, 'OPEN');
  await assert.rejects(publishIssue(root, record.id, runner), /already shared/i);
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
  await publishIssue(root, record.id, async () => ({ status: 0, stdout: 'https://github.com/obra/superpowers/issues/42', stderr: '' }));
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
  let calls = 0;
  const runner = async () => {
    calls++;
    started();
    await gate;
    return { status: 0, stdout: 'https://github.com/obra/superpowers/issues/42', stderr: '' };
  };
  const first = publishIssue(root, record.id, runner);
  await began;
  setTimeout(() => release(), 100);
  await assert.rejects(publishIssue(root, record.id, runner), /in progress/i);
  await assert.rejects(attachIssue(root, record.id, 'https://github.com/obra/superpowers/issues/77'), /in progress/i);
  await first;
  assert.equal(calls, 1);
});
