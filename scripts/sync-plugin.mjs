// Writes the plugin skill files from the compiled skills module. Run through `npm run build`.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginFiles } from '../plugins/agent-learnings/dist/skills.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'agent-learnings');
for (const [path, content] of Object.entries(pluginFiles())) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
