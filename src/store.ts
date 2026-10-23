import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Platform = 'codex' | 'claude' | 'opencode';
export type IssueStatus = 'OPEN' | 'CLOSED';

export interface LearningInput {
  target: string;
  platform: Platform;
  version?: string;
  situation: string;
  change: string;
  result: string;
}

export interface Learning extends LearningInput {
  id: string;
  createdAt: string;
  issueUrl?: string;
  issueStatus?: IssueStatus;
}

interface Config {
  schemaVersion: 1;
  targets: Record<string, { repo: string }>;
}

const dataDir = (root: string) => join(root, '.agent-learnings');
const learningDir = (root: string) => join(dataDir(root), 'learnings');
const learningPath = (root: string, id: string) => join(learningDir(root), `${id}.md`);
const configPath = (root: string) => join(dataDir(root), 'config.json');
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validLearningId = /^\d{8}-[a-f0-9]{8}$/;

async function writeReplace(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      await rename(temporary, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EXDEV') throw error;
      await copyFile(temporary, path);
    }
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim().replace(/\r\n?/g, '\n');
}

function requireTarget(value: unknown): string {
  const target = requireText(value, 'target');
  if (!validId.test(target)) throw new Error('target must use lowercase letters, numbers and single hyphens');
  return target;
}

function requirePlatform(value: unknown): Platform {
  if (value !== 'codex' && value !== 'claude' && value !== 'opencode') {
    throw new Error('platform must be codex, claude or opencode');
  }
  return value;
}

export function normalizeRepo(value: string): string {
  const text = requireText(value, 'repository');
  const bare = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text);
  const validPart = (part: string): boolean => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..';
  if (bare) {
    if (!validPart(bare[1]) || !validPart(bare[2])) throw new Error('repository must be a GitHub owner/repo or HTTPS URL');
    return `${bare[1]}/${bare[2]}`;
  }
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('repository must be a GitHub owner/repo or HTTPS URL'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('repository must be a GitHub owner/repo or HTTPS URL');
  }
  const parts = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length !== 2 || !parts.every(validPart)) {
    throw new Error('repository must be a GitHub owner/repo or HTTPS URL');
  }
  return `${parts[0]}/${parts[1]}`;
}

async function readConfig(root: string): Promise<Config> {
  try {
    const config = JSON.parse(await readFile(configPath(root), 'utf8')) as Config;
    if (config.schemaVersion !== 1 || !config.targets || typeof config.targets !== 'object') throw new Error('Unsupported config format');
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, targets: {} };
    throw error;
  }
}

export async function addTarget(root: string, id: string, repository: string): Promise<void> {
  const target = requireTarget(id);
  const repo = normalizeRepo(repository);
  const config = await readConfig(root);
  config.targets[target] = { repo };
  await mkdir(dataDir(root), { recursive: true });
  await writeReplace(configPath(root), `${JSON.stringify(config, null, 2)}\n`);
}

export async function getTarget(root: string, id: string): Promise<{ repo: string } | undefined> {
  const targets = (await readConfig(root)).targets;
  const target = requireTarget(id);
  return Object.hasOwn(targets, target) ? targets[target] : undefined;
}

export async function listTargets(root: string): Promise<Record<string, { repo: string }>> {
  return (await readConfig(root)).targets;
}

function field(name: string, value: unknown): string {
  return value === undefined ? '' : `${name}: ${JSON.stringify(value)}\n`;
}

function renderBody(item: Learning): string {
  return `# Learning: ${item.target}\n\n## Situation\n${item.situation}\n\n## Change\n${item.change}\n\n## Observed result\n${item.result}\n`;
}

function renderLearning(item: Learning): string {
  const content = { situation: item.situation, change: item.change, result: item.result };
  return `---\n${field('id', item.id)}${field('target', item.target)}${field('platform', item.platform)}${field('version', item.version)}${field('createdAt', item.createdAt)}${field('issueUrl', item.issueUrl)}${field('issueStatus', item.issueStatus)}${field('content', content)}---\n\n${renderBody(item)}`;
}

function parseLearning(markdown: string): Learning {
  markdown = markdown.replace(/\r\n/g, '\n');
  const front = /^---\n([\s\S]*?)---\n\n/.exec(markdown);
  if (!front) throw new Error('Invalid learning front matter');
  const meta: Record<string, unknown> = {};
  for (const line of front[1].split('\n').filter(Boolean)) {
    const match = /^([A-Za-z]+): (.*)$/.exec(line);
    if (!match) throw new Error('Invalid learning metadata');
    meta[match[1]] = JSON.parse(match[2]);
  }
  const content = meta.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== 'object') throw new Error('Invalid learning content');
  const item: Learning = {
    id: requireText(meta.id, 'id'),
    target: requireTarget(meta.target),
    platform: requirePlatform(meta.platform),
    version: typeof meta.version === 'string' ? meta.version : undefined,
    createdAt: requireText(meta.createdAt, 'createdAt'),
    issueUrl: typeof meta.issueUrl === 'string' ? meta.issueUrl : undefined,
    issueStatus: meta.issueStatus === 'OPEN' || meta.issueStatus === 'CLOSED' ? meta.issueStatus : undefined,
    situation: requireText(content.situation, 'situation'),
    change: requireText(content.change, 'change'),
    result: requireText(content.result, 'result'),
  };
  if (markdown.slice(front[0].length).trimEnd() !== renderBody(item).trimEnd()) {
    throw new Error('Learning body differs from metadata; update the record through the CLI');
  }
  return item;
}

export async function addLearning(root: string, input: LearningInput): Promise<Learning> {
  const item: Learning = {
    id: `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex')}`,
    target: requireTarget(input.target),
    platform: requirePlatform(input.platform),
    situation: requireText(input.situation, 'situation'),
    change: requireText(input.change, 'change'),
    result: requireText(input.result, 'result'),
    createdAt: new Date().toISOString(),
    version: input.version?.trim() || undefined,
  };
  await mkdir(learningDir(root), { recursive: true });
  await writeFile(learningPath(root, item.id), renderLearning(item), { encoding: 'utf8', flag: 'wx' });
  return item;
}

export async function getLearning(root: string, id: string): Promise<Learning> {
  if (!validLearningId.test(id)) throw new Error('Invalid learning id');
  return parseLearning(await readFile(learningPath(root, id), 'utf8'));
}

export async function listLearnings(root: string): Promise<Learning[]> {
  let files: string[];
  try { files = await readdir(learningDir(root)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries = await Promise.all(files.filter(file => validLearningId.test(file.replace(/\.md$/, '')) && file.endsWith('.md')).map(file => getLearning(root, file.slice(0, -3))));
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateLearning(root: string, id: string, changes: Partial<Learning>): Promise<Learning> {
  const previous = await getLearning(root, id);
  const item: Learning = {
    ...previous,
    situation: changes.situation === undefined ? previous.situation : requireText(changes.situation, 'situation'),
    change: changes.change === undefined ? previous.change : requireText(changes.change, 'change'),
    result: changes.result === undefined ? previous.result : requireText(changes.result, 'result'),
    issueUrl: changes.issueUrl ?? previous.issueUrl,
    issueStatus: changes.issueStatus ?? previous.issueStatus,
  };
  await writeReplace(learningPath(root, id), renderLearning(item));
  return item;
}
