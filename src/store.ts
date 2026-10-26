import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertNoSecrets } from './privacy.js';

export const platforms = ['codex', 'claude', 'opencode'] as const;
export type Platform = typeof platforms[number];
export const kinds = ['skill', 'agent', 'hook', 'command', 'mcp', 'plugin', 'prompt', 'other'] as const;
export type Kind = typeof kinds[number];
export const categories = ['improvement', 'bug', 'regression', 'praise'] as const;
export type Category = typeof categories[number];
export type IssueStatus = 'OPEN' | 'CLOSED';

export interface LearningInput {
  target: string;
  platform: Platform;
  version?: string;
  kind?: Kind;
  component?: string;
  category?: Category;
  situation: string;
  change: string;
  result: string;
}

export interface Learning extends LearningInput {
  id: string;
  createdAt: string;
  issueUrl?: string;
  commentUrl?: string;
  issueStatus?: IssueStatus;
}

interface Config {
  schemaVersion: 1;
  targets: Record<string, { repo: string }>;
  reminders?: boolean;
}

const inputKeys = ['target', 'platform', 'version', 'kind', 'component', 'category', 'situation', 'change', 'result'];
const dataDir = (root: string) => join(root, '.agent-learnings');
const learningDir = (root: string) => join(dataDir(root), 'learnings');
const learningPath = (root: string, id: string) => join(learningDir(root), `${id}.md`);
const configPath = (root: string) => join(dataDir(root), 'config.json');
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validLearningId = /^\d{8}-[a-f0-9]{8}$/;

export async function writeReplace(path: string, content: string): Promise<void> {
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

function optionalLine(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} must be a single line of at most ${max} characters`);
  return text;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  return value as T;
}

function storedEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new Error(`Learning has unknown ${label} ${JSON.stringify(value)} (the record may be from a newer agent-learnings)`);
  return value as T;
}

function requireTarget(value: unknown): string {
  const target = requireText(value, 'target');
  if (!validId.test(target)) throw new Error('target must use lowercase letters, numbers and single hyphens');
  return target;
}

function requirePlatform(value: unknown): Platform {
  if (!platforms.includes(value as Platform)) throw new Error('platform must be codex, claude or opencode');
  return value as Platform;
}

export function normalizeInput(value: unknown): LearningInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('learning must be an object');
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter(key => !inputKeys.includes(key));
  if (unknown.length) throw new Error(`Unknown learning field ${unknown.join(', ')}; allowed fields: ${inputKeys.join(', ')}`);
  return {
    target: requireTarget(record.target),
    platform: requirePlatform(record.platform),
    version: optionalLine(record.version, 'version', 64),
    kind: optionalEnum(record.kind, kinds, 'kind'),
    component: optionalLine(record.component, 'component', 80),
    category: optionalEnum(record.category, categories, 'category'),
    situation: requireText(record.situation, 'situation'),
    change: requireText(record.change, 'change'),
    result: requireText(record.result, 'result'),
  };
}

export const effectiveKind = (item: LearningInput): Kind => item.kind ?? 'other';
export const effectiveCategory = (item: LearningInput): Category => item.category ?? 'improvement';

export function learningFields(item: LearningInput): Record<string, string | undefined> {
  return { situation: item.situation, change: item.change, result: item.result, version: item.version, component: item.component };
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
    if (config.reminders !== undefined && typeof config.reminders !== 'boolean') throw new Error('config reminders must be true or false');
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
  await writeConfig(root, config);
}

async function writeConfig(root: string, config: Config): Promise<void> {
  await mkdir(dataDir(root), { recursive: true });
  await writeReplace(configPath(root), `${JSON.stringify(config, null, 2)}\n`);
}

export async function getReminders(root: string): Promise<boolean | undefined> {
  return (await readConfig(root)).reminders;
}

export async function setReminders(root: string, enabled: boolean): Promise<void> {
  const config = await readConfig(root);
  config.reminders = enabled;
  await writeConfig(root, config);
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

// On-disk format: parseLearning compares this exact text, so changing it makes existing records unreadable.
// New metadata belongs in the front matter only.
function renderBody(item: Learning): string {
  return `# Learning: ${item.target}\n\n## Situation\n${item.situation}\n\n## Change\n${item.change}\n\n## Observed result\n${item.result}\n`;
}

function renderLearning(item: Learning): string {
  const content = { situation: item.situation, change: item.change, result: item.result };
  return `---\n${field('id', item.id)}${field('target', item.target)}${field('platform', item.platform)}${field('version', item.version)}${field('kind', item.kind)}${field('component', item.component)}${field('category', item.category)}${field('createdAt', item.createdAt)}${field('issueUrl', item.issueUrl)}${field('commentUrl', item.commentUrl)}${field('issueStatus', item.issueStatus)}${field('content', content)}---\n\n${renderBody(item)}`;
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
    kind: storedEnum(meta.kind, kinds, 'kind'),
    component: typeof meta.component === 'string' ? meta.component : undefined,
    category: storedEnum(meta.category, categories, 'category'),
    createdAt: requireText(meta.createdAt, 'createdAt'),
    issueUrl: typeof meta.issueUrl === 'string' ? meta.issueUrl : undefined,
    commentUrl: typeof meta.commentUrl === 'string' ? meta.commentUrl : undefined,
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

export async function addLearning(root: string, input: unknown): Promise<Learning> {
  const draft = normalizeInput(input);
  assertNoSecrets(learningFields(draft), 'save this learning');
  const item: Learning = {
    ...draft,
    id: `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
  };
  await mkdir(learningDir(root), { recursive: true });
  await writeFile(learningPath(root, item.id), renderLearning(item), { encoding: 'utf8', flag: 'wx' });
  return item;
}

export async function getLearning(root: string, id: string): Promise<Learning> {
  if (!validLearningId.test(id)) throw new Error('Invalid learning id');
  let markdown: string;
  try { markdown = await readFile(learningPath(root, id), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Learning ${id} not found`);
    throw error;
  }
  return parseLearning(markdown);
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

export async function withLearningLock<T>(root: string, id: string, action: () => Promise<T>): Promise<T> {
  if (!validLearningId.test(id)) throw new Error('Invalid learning id');
  const lock = join(learningDir(root), `${id}.share.lock`);
  let handle;
  try {
    handle = await open(lock, 'wx');
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error(`Another agent-learnings operation is in progress for ${id}. If this lock is stale, check GitHub for an issue from an interrupted share, then remove ${lock}`);
    }
    if (code === 'ENOENT') throw new Error(`Learning ${id} not found`);
    throw error;
  }
  try {
    return await action();
  } finally {
    await unlink(lock).catch(() => {});
  }
}

export async function updateLearning(root: string, id: string, changes: Partial<Learning>): Promise<Learning> {
  const previous = await getLearning(root, id);
  const item: Learning = {
    ...previous,
    situation: changes.situation === undefined ? previous.situation : requireText(changes.situation, 'situation'),
    change: changes.change === undefined ? previous.change : requireText(changes.change, 'change'),
    result: changes.result === undefined ? previous.result : requireText(changes.result, 'result'),
    issueUrl: changes.issueUrl ?? previous.issueUrl,
    commentUrl: changes.commentUrl ?? previous.commentUrl,
    issueStatus: changes.issueStatus ?? previous.issueStatus,
  };
  await writeReplace(learningPath(root, id), renderLearning(item));
  return item;
}

export async function editLearning(root: string, id: string, patch: unknown): Promise<{ learning: Learning; changed: boolean }> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('edit must be an object');
  const keys = Object.keys(patch);
  if (!keys.length) throw new Error('No fields to edit');
  const unknown = keys.filter(key => !inputKeys.includes(key));
  if (unknown.length) throw new Error(`Unknown learning field ${unknown.join(', ')}; allowed fields: ${inputKeys.join(', ')}`);
  await getLearning(root, id);
  return withLearningLock(root, id, async () => {
    const previous = await getLearning(root, id);
    if (previous.issueUrl) throw new Error(`Learning ${id} was already shared (${previous.issueUrl}); update the GitHub issue or add a new learning instead`);
    const current = Object.fromEntries(inputKeys.map(key => [key, previous[key as keyof LearningInput]]));
    const learning: Learning = { ...previous, ...normalizeInput({ ...current, ...patch }) };
    assertNoSecrets(learningFields(learning), 'save this edit');
    const changed = renderLearning(learning) !== renderLearning(previous);
    if (changed) await writeReplace(learningPath(root, id), renderLearning(learning));
    return { learning, changed };
  });
}

export async function removeLearning(root: string, id: string): Promise<Learning> {
  await getLearning(root, id);
  return withLearningLock(root, id, async () => {
    const previous = await getLearning(root, id);
    await unlink(learningPath(root, id));
    return previous;
  });
}
