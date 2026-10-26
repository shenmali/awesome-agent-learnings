import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptHook, cleanupState, effectiveMode, remindersEnabled, runHook } from '../plugins/agent-learnings/dist/reminders.js';
import { getReminders, setReminders, setMode, addTarget, listTargets } from '../plugins/agent-learnings/dist/store.js';

const temp = () => mkdtemp(join(tmpdir(), 'agent-learnings-hook-'));
const on = { AGENT_LEARNINGS_REMINDERS: '1' };
const use = (tool_name, tool_input) => JSON.stringify({ session_id: 's1', cwd: '/nowhere', tool_name, tool_input, tool_response: 'SECRET CONTENT', transcript_path: '/t.jsonl' });

test('Claude hook payloads map to component names', () => {
  const map = (event, payload) => adaptHook(`claude:${event}`, { session_id: 's', ...payload })?.components;
  assert.deepEqual(map('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } }), ['skill:superpowers:brainstorming']);
  assert.deepEqual(map('PostToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'code-reviewer' } }), ['agent:code-reviewer']);
  assert.deepEqual(map('PostToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } }), ['agent:Explore']);
  assert.deepEqual(map('PostToolUse', { tool_name: 'mcp__github__get_issue' }), ['mcp:github']);
  assert.deepEqual(map('UserPromptExpansion', { command_name: 'review', command_source: 'plugin' }), ['command:review']);
  assert.equal(map('UserPromptExpansion', { command_name: 'clear', command_source: 'builtin' }), undefined);
  assert.equal(map('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }), undefined);
  assert.deepEqual(map('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'agent-learnings:capture-learning' } }), []);
  assert.deepEqual(map('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'bad name; rm -rf /' } }), []);
  assert.equal(adaptHook('claude:Stop', { tool_name: 'Skill' }), undefined);
  assert.equal(adaptHook('unknown:Stop', { session_id: 's' }), undefined);
  assert.deepEqual(adaptHook('generic:use', { sessionId: 's', components: ['hook:pre-commit', 'bogus', 7] }).components, ['hook:pre-commit']);
});

test('reminder setting comes from the environment, then the project, then defaults to off', async () => {
  assert.equal(remindersEnabled({}, undefined), false);
  assert.equal(remindersEnabled({}, true), true);
  assert.equal(remindersEnabled({ AGENT_LEARNINGS_REMINDERS: 'off' }, true), false);
  assert.equal(remindersEnabled({ AGENT_LEARNINGS_REMINDERS: 'on' }, false), true);
  const root = await temp();
  await addTarget(root, 'superpowers', 'obra/superpowers');
  await setReminders(root, true);
  assert.equal(await getReminders(root), true);
  assert.deepEqual(await listTargets(root), { superpowers: { repo: 'obra/superpowers' } });
  await writeFile(join(root, '.agent-learnings/config.json'), '{"schemaVersion":1,"targets":{},"reminders":"yes"}');
  await assert.rejects(getReminders(root), /reminders must be true or false/);
});

test('a session is reminded once and the state holds only component names', async () => {
  const dir = await temp();
  const options = { env: on, stateDir: dir };
  assert.equal(await runHook('claude:PostToolUse', use('Skill', { skill: 'superpowers:brainstorming' }), options), '');
  await runHook('claude:PostToolUse', use('mcp__github__get_issue', {}), options);
  const [file] = await readdir(dir);
  const state = await readFile(join(dir, file), 'utf8');
  assert.deepEqual(JSON.parse(state), { v: 1, components: ['skill:superpowers:brainstorming', 'mcp:github'], reminded: false });
  assert.doesNotMatch(state, /SECRET|transcript|s1/);
  const first = JSON.parse(await runHook('claude:Stop', '{"session_id":"s1"}', options));
  assert.match(first.systemMessage, /skill:superpowers:brainstorming, mcp:github.*\/agent-learnings:capture-learning/);
  assert.equal(await runHook('claude:Stop', '{"session_id":"s1"}', options), '');
  await runHook('claude:SessionEnd', '{"session_id":"s1"}', options);
  assert.deepEqual(await readdir(dir), []);
  assert.equal(await runHook('claude:Stop', '{"session_id":"other"}', options), '');
});

test('disabled reminders record nothing and bad input is ignored', async () => {
  const dir = await temp();
  await runHook('claude:PostToolUse', use('Skill', { skill: 'x' }), { env: {}, stateDir: dir });
  await runHook('claude:PostToolUse', use('Skill', { skill: 'x' }), { env: { AGENT_LEARNINGS_REMINDERS: '0' }, stateDir: dir });
  assert.deepEqual(await readdir(dir), []);
  for (const raw of ['', 'not json', '[]', 'null', '{"session_id":5}']) assert.equal(await runHook('claude:Stop', raw, { env: on, stateDir: dir }), '');
});

test('old state files are cleaned up and unsafe state directories are ignored', async () => {
  const dir = await temp();
  const old = join(dir, `${'a'.repeat(32)}.json`);
  const fresh = join(dir, `${'b'.repeat(32)}.json`);
  await writeFile(old, '{}');
  await writeFile(fresh, '{}');
  await writeFile(join(dir, 'keep.txt'), 'x');
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(old, past, past);
  assert.equal(await cleanupState(dir), 1);
  assert.deepEqual((await readdir(dir)).sort(), [`${'b'.repeat(32)}.json`, 'keep.txt']);
  if (process.platform !== 'win32') {
    const real = await temp();
    const link = join(await temp(), 'link');
    await symlink(real, link);
    await runHook('claude:PostToolUse', use('Skill', { skill: 'x' }), { env: on, stateDir: link });
    assert.deepEqual(await readdir(real), []);
  }
});

test('auto mode asks the agent once per session to save learnings without approval', async () => {
  const dir = await temp();
  const env = { AGENT_LEARNINGS_MODE: 'auto', CLAUDE_PLUGIN_ROOT: '/opt/plugin' };
  const options = { env, stateDir: dir };
  assert.equal(await runHook('claude:Stop', '{"session_id":"s1"}', options), '');
  await runHook('claude:PostToolUse', use('Skill', { skill: 'superpowers:brainstorming' }), options);
  assert.equal(await runHook('claude:Stop', '{"session_id":"s1","stop_hook_active":true}', options), '');
  const first = JSON.parse(await runHook('claude:Stop', '{"session_id":"s1","stop_hook_active":false}', options));
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /skill:superpowers:brainstorming/);
  assert.match(first.reason, /node "\/opt\/plugin[\\/]dist[\\/]cli\.js" learn add --json <file> --auto/);
  assert.match(first.reason, /Never publish/);
  assert.match(first.systemMessage, /auto mode/);
  assert.equal(await runHook('claude:Stop', '{"session_id":"s1"}', options), '');
});

test('auto mode follows env over project config and works with reminders off', async () => {
  assert.equal(effectiveMode({}, undefined), 'manual');
  assert.equal(effectiveMode({}, 'auto'), 'auto');
  assert.equal(effectiveMode({ AGENT_LEARNINGS_MODE: 'manual' }, 'auto'), 'manual');
  assert.equal(effectiveMode({ AGENT_LEARNINGS_MODE: 'bogus' }, 'auto'), 'auto');
  const root = await temp();
  await setMode(root, 'auto');
  const dir = await temp();
  const payload = JSON.stringify({ session_id: 'p', cwd: root, tool_name: 'Skill', tool_input: { skill: 'x' } });
  await runHook('claude:PostToolUse', payload, { env: { AGENT_LEARNINGS_MODE: 'manual' }, stateDir: dir });
  assert.deepEqual(await readdir(dir), []);
  await runHook('claude:PostToolUse', payload, { env: {}, stateDir: dir });
  const stop = JSON.parse(await runHook('claude:Stop', JSON.stringify({ session_id: 'p', cwd: root }), { env: {}, stateDir: dir }));
  assert.equal(stop.decision, 'block');
  assert.match(stop.reason, /`agent-learnings learn add --json <file> --auto`/);
});
