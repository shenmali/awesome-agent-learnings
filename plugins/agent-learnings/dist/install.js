import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { packageVersion } from './project.js';
import { renderOpenaiYaml, renderOpencodeCommand, renderSkill, skillNames } from './skills.js';
export const installPlatforms = ['all', 'claude', 'codex', 'opencode'];
export async function initSkills(options) {
    const platform = options.platform ?? 'all';
    const home = options.home ?? homedir();
    const base = options.scope === 'user' ? home : options.cwd;
    const command = options.scope === 'project' ? `npx --yes agent-learnings@${await packageVersion()}` : 'agent-learnings';
    const files = [];
    for (const name of skillNames) {
        if (platform !== 'claude') {
            // .agents/skills is read by both Codex and OpenCode.
            files.push([join(base, '.agents', 'skills', name, 'SKILL.md'), renderSkill(name, command, 'agents')]);
            files.push([join(base, '.agents', 'skills', name, 'agents', 'openai.yaml'), renderOpenaiYaml(name)]);
        }
        if (platform === 'all' || platform === 'opencode') {
            const commands = options.scope === 'user' ? join(home, '.config', 'opencode', 'commands') : join(base, '.opencode', 'commands');
            files.push([join(commands, `${name}.md`), renderOpencodeCommand(name, command)]);
        }
        if (platform === 'all' || platform === 'claude')
            files.push([join(base, '.claude', 'skills', name, 'SKILL.md'), renderSkill(name, command, 'claude')]);
    }
    const created = [];
    for (const [path, content] of files) {
        await mkdir(dirname(path), { recursive: true });
        try {
            await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
            created.push(path);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
    return created;
}
