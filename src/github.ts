import { execFile } from 'node:child_process';
import { mkdtemp, open, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLearning, getTarget, updateLearning } from './store.js';

export interface RunResult { status: number; stdout: string; stderr: string }
export type GhRunner = (command: string, args: string[]) => Promise<RunResult>;

export const runGh: GhRunner = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return reject(error);
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
  });
});

export interface IssueDraft { repo: string; title: string; body: string; newIssueUrl: string }

async function withShareLock<T>(root: string, id: string, action: () => Promise<T>): Promise<T> {
  const lock = join(root, '.agent-learnings', 'learnings', `${id}.share.lock`);
  let handle;
  try {
    handle = await open(lock, 'wx');
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Share in progress for ${id}. If this lock is stale, check GitHub before removing ${lock}`);
    }
    throw error;
  }
  try {
    return await action();
  } finally {
    await unlink(lock).catch(() => {});
  }
}

export async function prepareIssue(root: string, id: string): Promise<IssueDraft> {
  const learning = await getLearning(root, id);
  const target = await getTarget(root, learning.target);
  if (!target) throw new Error(`No GitHub repository mapped for ${learning.target}. Run target add first.`);
  const title = `Learning proposal for ${learning.target}: ${learning.situation.replace(/\s+/g, ' ').slice(0, 80)}`;
  const body = [
    `## Target`,
    `- Plugin or skill: ${learning.target}`,
    `- Platform: ${learning.platform}`,
    learning.version ? `- Version: ${learning.version}` : undefined,
    '',
    `## Situation`, learning.situation, '',
    `## Change tried`, learning.change, '',
    `## Observed result`, learning.result, '',
    `Submitted from an explicitly reviewed Agent Learnings record.`,
  ].filter(line => line !== undefined).join('\n');
  return { repo: target.repo, title, body, newIssueUrl: `https://github.com/${target.repo}/issues/new` };
}

function unavailable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function needsAuth(stderr: string): boolean {
  return /not logged in|authentication required|gh auth login|authenticate with|HTTP 401/i.test(stderr);
}

export async function publishIssue(root: string, id: string, runner: GhRunner = runGh): Promise<string> {
  await getLearning(root, id);
  return withShareLock(root, id, async () => {
    const learning = await getLearning(root, id);
    if (learning.issueUrl) throw new Error(`Learning ${id} was already shared: ${learning.issueUrl}`);
    const draft = await prepareIssue(root, id);
    let response: RunResult;
    const temp = await mkdtemp(join(tmpdir(), 'agent-learnings-issue-'));
    const bodyPath = join(temp, 'body.md');
    try {
      await writeFile(bodyPath, draft.body, 'utf8');
      response = await runner('gh', ['issue', 'create', '--repo', draft.repo, '--title', draft.title, '--body-file', bodyPath]);
    } catch (error) {
      if (!unavailable(error)) throw error;
      return `GitHub CLI is unavailable. Open ${draft.newIssueUrl} and paste this issue:\n\n# ${draft.title}\n\n${draft.body}`;
    } finally {
      await unlink(bodyPath).catch(() => {});
      await rmdir(temp).catch(() => {});
    }
    if (response.status !== 0) {
      if (needsAuth(response.stderr)) {
        return `GitHub authentication is unavailable. Open ${draft.newIssueUrl} and paste this issue:\n\n# ${draft.title}\n\n${draft.body}`;
      }
      throw new Error(`GitHub issue creation failed: ${response.stderr.trim() || `exit ${response.status}`}`);
    }
    const issueUrl = response.stdout.trim();
    if (!new RegExp(`^https://github\\.com/${draft.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/issues/\\d+$`, 'i').test(issueUrl)) {
      throw new Error(`GitHub returned an unexpected issue URL: ${issueUrl}`);
    }
    try {
      await updateLearning(root, id, { issueUrl, issueStatus: 'OPEN' });
    } catch (error) {
      throw new Error(`GitHub issue was created at ${issueUrl}, but the local record could not be updated. Restore the record and run share ${id} --attach ${issueUrl}. Cause: ${(error as Error).message}`);
    }
    return issueUrl;
  });
}

export async function attachIssue(root: string, id: string, value: string): Promise<string> {
  await getLearning(root, id);
  return withShareLock(root, id, async () => {
    const learning = await getLearning(root, id);
    if (learning.issueUrl) throw new Error(`Learning ${id} was already shared: ${learning.issueUrl}`);
    const draft = await prepareIssue(root, id);
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Issue URL does not match the mapped GitHub repository'); }
    const expected = `/${draft.repo}/issues/`;
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash || !url.pathname.toLowerCase().startsWith(expected.toLowerCase()) || !/^\d+$/.test(url.pathname.slice(expected.length))) {
      throw new Error('Issue URL does not match the mapped GitHub repository');
    }
    await updateLearning(root, id, { issueUrl: url.href });
    return url.href;
  });
}

export async function refreshIssue(root: string, id: string, runner: GhRunner = runGh): Promise<'OPEN' | 'CLOSED'> {
  const learning = await getLearning(root, id);
  if (!learning.issueUrl) throw new Error(`Learning ${id} has no submitted issue`);
  const draft = await prepareIssue(root, id);
  const response = await runner('gh', ['issue', 'view', learning.issueUrl, '--repo', draft.repo, '--json', 'state']);
  if (response.status !== 0) throw new Error(`GitHub issue status failed: ${response.stderr.trim() || `exit ${response.status}`}`);
  const state = (JSON.parse(response.stdout) as { state?: string }).state;
  if (state !== 'OPEN' && state !== 'CLOSED') throw new Error('GitHub returned an unexpected issue state');
  await updateLearning(root, id, { issueStatus: state });
  return state;
}
