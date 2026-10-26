import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pluginFiles } from '../plugins/agent-learnings/dist/skills.js';
import { claudeEvents } from '../plugins/agent-learnings/dist/reminders.js';

const repo = new URL('../', import.meta.url);
const plugin = new URL('plugins/agent-learnings/', repo);
const json = async (base, path) => JSON.parse(await readFile(new URL(path, base), 'utf8'));

test('generated plugin skills are up to date (run npm run build)', async () => {
  for (const [path, content] of Object.entries(pluginFiles())) {
    assert.equal((await readFile(new URL(path, plugin), 'utf8')).replace(/\r\n/g, '\n'), content, path);
  }
});

test('package, Claude and Codex manifests agree', async () => {
  const pkg = await json(repo, 'package.json');
  const claude = await json(plugin, '.claude-plugin/plugin.json');
  const codex = await json(plugin, '.codex-plugin/plugin.json');
  const marketplace = await json(repo, '.claude-plugin/marketplace.json');
  assert.equal(claude.name, pkg.name);
  assert.equal(codex.name, pkg.name);
  assert.equal(claude.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.equal(codex.description, claude.description);
  assert.deepEqual(marketplace.plugins.map(entry => [entry.name, entry.source]), [[pkg.name, './plugins/agent-learnings']]);
  assert.equal(marketplace.plugins[0].version, undefined, 'set the version only in plugin.json');
  assert.equal(pkg.bin['agent-learnings'], './plugins/agent-learnings/dist/cli.js');
});

test('plugin hooks call the CLI with events the reminder adapter understands', async () => {
  const { hooks } = await json(plugin, 'hooks/hooks.json');
  assert.deepEqual(Object.keys(hooks).sort(), [...claudeEvents].sort());
  for (const [event, groups] of Object.entries(hooks)) {
    for (const handler of groups.flatMap(group => group.hooks)) {
      assert.equal(handler.command, `node "\${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hook claude:${event}`);
    }
  }
  assert.deepEqual((await json(plugin, 'hooks/codex.json')).hooks, {});
});
