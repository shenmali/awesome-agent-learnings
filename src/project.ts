import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function findProjectRoot(cwd: string): Promise<string> {
  let dir = resolve(cwd);
  while (true) {
    try {
      await access(join(dir, '.git'));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return resolve(cwd);
      dir = parent;
    }
  }
}

// The plugin manifest ships with both the plugin and the npm package; a test keeps it in sync with package.json.
export async function packageVersion(): Promise<string> {
  return (JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')) as { version: string }).version;
}
