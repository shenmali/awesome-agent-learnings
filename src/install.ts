import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { packageVersion } from './project.js';

export interface InstallOptions { scope: 'project' | 'user'; cwd: string; home?: string }

function workflow(command: string): string {
  return `# Agent Learnings\n\nRun only when the user explicitly asks to capture a learning.\n\n1. Identify the plugin or skill, the situation, the prompt or skill change, and the observed result from the current work. Do not copy the full conversation.\n2. Present the draft in chat. Ask the user to edit or approve it. Do not run the saving command before explicit approval.\n3. After approval, run \`${command} learn add --json <draft-file>\` with JSON fields target, platform, situation, change, result, and optional version. Use the current platform name. The draft file may be temporary. Do not put sensitive content in a shell command argument.\n4. Report the saved learning ID. If the user asks to contribute it, run \`${command} share <id>\` for a preview. Show the complete issue text and ask for explicit approval before \`${command} share <id> --publish\`.\n5. Never publish a learning merely because it was saved.\n`;
}

function skill(claude: boolean, command: string): string {
  return `---\nname: agent-learnings\ndescription: Capture reviewed learnings from improvements to shared agent skills and plugins\n${claude ? 'disable-model-invocation: true\n' : 'metadata:\n  opencode/slash: "true"\n  opencode/autoinvoke: "false"\n'}---\n\n${workflow(command)}`;
}

export async function initSkills(options: InstallOptions): Promise<string[]> {
  const base = options.scope === 'user' ? (options.home ?? homedir()) : options.cwd;
  const command = options.scope === 'project' ? `npx --yes agent-learnings@${await packageVersion()}` : 'agent-learnings';
  const targets: Array<[string, boolean]> = [
    [join(base, '.agents', 'skills', 'agent-learnings', 'SKILL.md'), false],
    [join(base, '.claude', 'skills', 'agent-learnings', 'SKILL.md'), true],
  ];
  const created: string[] = [];
  for (const [path, claude] of targets) {
    await mkdir(join(path, '..'), { recursive: true });
    try {
      await writeFile(path, skill(claude, command), { encoding: 'utf8', flag: 'wx' });
      created.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return created;
}
