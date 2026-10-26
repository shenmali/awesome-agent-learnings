import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultManifest, manifestPath, parseManifest, policyFor, type Manifest, type Policy } from './manifest.js';
import { assertNoSecrets, redact, scanFields, type Finding } from './privacy.js';
import { effectiveCategory, effectiveKind, getLearning, getTarget, learningFields, updateLearning, withLearningLock, type IssueStatus, type Learning } from './store.js';

export interface RunResult { status: number; stdout: string; stderr: string }
export type GhRunner = (command: string, args: string[]) => Promise<RunResult>;

export const runGh: GhRunner = (command, args) => new Promise((resolve, reject) => {
  const program = command === 'gh' ? process.env.AGENT_LEARNINGS_GH || 'gh' : command;
  execFile(program, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return reject(error);
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
  });
});

export interface IssueDraft { repo: string; title: string; body: string; newIssueUrl: string }
export interface ManifestResult { source: 'repository' | 'default' | 'unchecked' | 'invalid' | 'error'; manifest: Manifest; note?: string }
export interface RelatedIssue { number: number; title: string; url: string; state: IssueStatus }
export interface Related { issues: RelatedIssue[]; skipped?: string }
export interface SharePreview { draft: IssueDraft; manifest: ManifestResult; policy: Policy; findings: Finding[]; related: Related; sharedAs?: string }

function unavailable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function needsAuth(stderr: string): boolean {
  return /not logged in|authentication required|gh auth login|authenticate with|HTTP 401/i.test(stderr);
}

async function gh(runner: GhRunner, args: string[]): Promise<RunResult | 'unavailable'> {
  try {
    return await runner('gh', args);
  } catch (error) {
    if (unavailable(error)) return 'unavailable';
    throw error;
  }
}

const failure = (response: RunResult) => response.stderr.trim() || `exit ${response.status}`;

// Text from GitHub is written by other people; strip control, bidi and zero-width characters before showing it.
function cleanText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function mappedRepo(root: string, learning: Learning): Promise<string> {
  const target = await getTarget(root, learning.target);
  if (!target) throw new Error(`No GitHub repository mapped for ${learning.target}. Run target add first.`);
  return target.repo;
}

export function parseIssueUrl(repo: string, value: string, allowComment = false): { issueUrl: string; commentUrl?: string } {
  const invalid = new Error('Issue URL does not match the mapped GitHub repository');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw invalid; }
  const expected = `/${repo}/issues/`.toLowerCase();
  const number = url.pathname.slice(expected.length);
  const comment = /^#issuecomment-(\d+)$/.exec(url.hash);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || (url.hash && !(allowComment && comment)) || !url.pathname.toLowerCase().startsWith(expected) || !/^\d+$/.test(number)) {
    throw invalid;
  }
  const issueUrl = `https://github.com/${repo}/issues/${number}`;
  return { issueUrl, commentUrl: comment ? `${issueUrl}#issuecomment-${comment[1]}` : undefined };
}

export async function fetchManifest(repo: string, runner: GhRunner = runGh): Promise<ManifestResult> {
  const response = await gh(runner, ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${manifestPath}`]);
  if (response === 'unavailable') return { source: 'unchecked', manifest: defaultManifest, note: 'GitHub CLI is unavailable' };
  if (response.status !== 0) {
    if (needsAuth(response.stderr)) return { source: 'unchecked', manifest: defaultManifest, note: 'GitHub authentication is unavailable' };
    if (/HTTP 404|Not Found/i.test(response.stderr)) return { source: 'default', manifest: defaultManifest };
    return { source: 'error', manifest: defaultManifest, note: cleanText(failure(response)) };
  }
  try {
    return { source: 'repository', manifest: parseManifest(response.stdout) };
  } catch (error) {
    return { source: 'invalid', manifest: defaultManifest, note: (error as Error).message };
  }
}

export function describeManifest(repo: string, result: ManifestResult): string {
  if (result.source === 'repository') return `from ${repo}/${manifestPath}`;
  if (result.source === 'default') return `default (no ${manifestPath} in ${repo})`;
  if (result.source === 'unchecked') return `not checked (${result.note})`;
  if (result.source === 'invalid') return `invalid ${manifestPath} in ${repo} (${result.note})`;
  return `could not be checked (${result.note})`;
}

function sharePolicy(repo: string, result: ManifestResult, learning: Learning): Policy {
  if (result.source === 'invalid') return { status: 'blocked', reason: `the maintainer settings in ${repo}/${manifestPath} are invalid: ${result.note}` };
  if (result.source === 'error') return { status: 'blocked', reason: `could not read maintainer settings for ${repo}: ${result.note}` };
  return policyFor(result.manifest, effectiveKind(learning), effectiveCategory(learning));
}

export function issueTitle(learning: Learning, prefix: string): string {
  const situation = learning.situation.replace(/\s+/g, ' ');
  const summary = situation.length > 80 ? `${situation.slice(0, 77)}...` : situation;
  return `${prefix} ${effectiveCategory(learning)}: ${learning.component ?? learning.target} - ${summary}`.slice(0, 200);
}

// Machine-readable summary for maintainer automation. Escaping <, > and & keeps it inside the HTML comment.
function marker(learning: Learning): string {
  const data = { v: 1, kind: effectiveKind(learning), component: learning.component, category: effectiveCategory(learning), platform: learning.platform, version: learning.version };
  return `<!-- agent-learnings ${JSON.stringify(data).replace(/[<>&]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)} -->`;
}

function draftFor(repo: string, learning: Learning, manifest: Manifest): IssueDraft {
  const body = [
    `## Target`,
    `- Plugin or skill: ${learning.target}`,
    `- Kind: ${effectiveKind(learning)}`,
    learning.component ? `- Component: ${learning.component}` : undefined,
    `- Category: ${effectiveCategory(learning)}`,
    `- Platform: ${learning.platform}`,
    learning.version ? `- Version: ${learning.version}` : undefined,
    '',
    `## Situation`, learning.situation, '',
    `## Change tried`, learning.change, '',
    `## Observed result`, learning.result, '',
    `Submitted from an explicitly reviewed Agent Learnings record.`,
    marker(learning),
  ].filter(line => line !== undefined).join('\n');
  return { repo, title: issueTitle(learning, manifest.titlePrefix), body, newIssueUrl: `https://github.com/${repo}/issues/new` };
}

export async function prepareIssue(root: string, id: string, manifest: Manifest = defaultManifest): Promise<IssueDraft> {
  const learning = await getLearning(root, id);
  return draftFor(await mappedRepo(root, learning), learning, manifest);
}

export function relatedQuery(learning: Learning, manifest: Manifest): string {
  // Only metadata that is published anyway; the situation text stays local until the user approves it.
  return `"${(learning.component ?? manifest.titlePrefix).replace(/["\\]/g, '')}" in:title`;
}

export async function findRelated(repo: string, query: string, runner: GhRunner = runGh): Promise<Related> {
  const response = await gh(runner, ['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '5', '--search', query, '--json', 'number,title,url,state']);
  if (response === 'unavailable') return { issues: [], skipped: 'GitHub CLI is unavailable' };
  if (response.status !== 0) return { issues: [], skipped: needsAuth(response.stderr) ? 'GitHub authentication is unavailable' : cleanText(failure(response)) };
  let parsed: unknown;
  try { parsed = JSON.parse(response.stdout); } catch { return { issues: [], skipped: 'GitHub returned an unexpected response' }; }
  if (!Array.isArray(parsed)) return { issues: [], skipped: 'GitHub returned an unexpected response' };
  const issues = parsed.flatMap((item: Record<string, unknown>): RelatedIssue[] => {
    if (typeof item?.number !== 'number' || typeof item.title !== 'string' || typeof item.url !== 'string' || (item.state !== 'OPEN' && item.state !== 'CLOSED')) return [];
    try {
      return [{ number: item.number, title: cleanText(item.title).slice(0, 120), url: parseIssueUrl(repo, item.url).issueUrl, state: item.state }];
    } catch {
      return [];
    }
  });
  return { issues };
}

export async function previewShare(root: string, id: string, runner: GhRunner = runGh): Promise<SharePreview> {
  const learning = await getLearning(root, id);
  const repo = await mappedRepo(root, learning);
  const findings = scanFields(learningFields(learning));
  const manifest = await fetchManifest(repo, runner);
  const draft = draftFor(repo, learning, manifest.manifest);
  const related = findings.some(item => item.severity === 'block')
    ? { issues: [], skipped: 'remove the sensitive values first' }
    : await findRelated(repo, relatedQuery(learning, manifest.manifest), runner);
  return {
    draft: { ...draft, title: redact(draft.title), body: redact(draft.body) },
    manifest,
    policy: sharePolicy(repo, manifest, learning),
    findings,
    related,
    sharedAs: learning.commentUrl ?? learning.issueUrl,
  };
}

async function withBodyFile<T>(body: string, action: (path: string) => Promise<T>): Promise<T> {
  const temp = await mkdtemp(join(tmpdir(), 'agent-learnings-issue-'));
  const path = join(temp, 'body.md');
  try {
    await writeFile(path, body, 'utf8');
    return await action(path);
  } finally {
    await unlink(path).catch(() => {});
    await rmdir(temp).catch(() => {});
  }
}

const attachHint = (id: string) => `\n\nAfter submitting, link it: agent-learnings share ${id} --attach <issue-url>`;

// Shared checks before anything is sent: not yet shared, no secrets, maintainer policy, GitHub size limit.
async function shareable(root: string, id: string, runner: GhRunner): Promise<{ learning: Learning; draft: IssueDraft; policy: Policy }> {
  const learning = await getLearning(root, id);
  if (learning.issueUrl) throw new Error(`Learning ${id} was already shared: ${learning.commentUrl ?? learning.issueUrl}`);
  assertNoSecrets(learningFields(learning), 'share this learning');
  const repo = await mappedRepo(root, learning);
  const manifest = await fetchManifest(repo, runner);
  const policy = sharePolicy(repo, manifest, learning);
  if (policy.status === 'blocked') throw new Error(`Not sharing ${id}: ${policy.reason}`);
  const draft = draftFor(repo, learning, manifest.manifest);
  if (draft.body.length > 65000) throw new Error('The learning is too long for a GitHub issue; shorten it with learn edit');
  return { learning, draft, policy };
}

export async function publishIssue(root: string, id: string, runner: GhRunner = runGh): Promise<string> {
  await getLearning(root, id);
  return withLearningLock(root, id, async () => {
    const { draft, policy } = await shareable(root, id, runner);
    const manual = (intro: string) => `${intro}\n\n# ${draft.title}\n\n${draft.body}${attachHint(id)}`;
    if (policy.status === 'redirect') return manual(`The maintainers of ${draft.repo} collect feedback at ${policy.url}. Submit this text there:`);
    const response = await withBodyFile(draft.body, path => gh(runner, ['issue', 'create', '--repo', draft.repo, '--title', draft.title, '--body-file', path]));
    if (response === 'unavailable') return manual(`GitHub CLI is unavailable. Open ${draft.newIssueUrl} and paste this issue:`);
    if (response.status !== 0) {
      if (needsAuth(response.stderr)) return manual(`GitHub authentication is unavailable. Open ${draft.newIssueUrl} and paste this issue:`);
      throw new Error(`GitHub issue creation failed: ${failure(response)}`);
    }
    let issueUrl: string;
    try { issueUrl = parseIssueUrl(draft.repo, response.stdout.trim()).issueUrl; } catch { throw new Error(`GitHub returned an unexpected issue URL: ${response.stdout.trim()}`); }
    try {
      await updateLearning(root, id, { issueUrl, issueStatus: 'OPEN' });
    } catch (error) {
      throw new Error(`GitHub issue was created at ${issueUrl}, but the local record could not be updated. Restore the record and run share ${id} --attach ${issueUrl}. Cause: ${(error as Error).message}`);
    }
    return issueUrl;
  });
}

export async function commentIssue(root: string, id: string, value: string, runner: GhRunner = runGh): Promise<string> {
  await getLearning(root, id);
  return withLearningLock(root, id, async () => {
    const learning = await getLearning(root, id);
    const { issueUrl } = parseIssueUrl(await mappedRepo(root, learning), value);
    const { draft, policy } = await shareable(root, id, runner);
    const manual = (intro: string) => `${intro}\n\n${draft.body}${attachHint(id)}`;
    if (policy.status === 'redirect') return manual(`The maintainers of ${draft.repo} collect feedback at ${policy.url}. Submit this text there:`);
    const view = await gh(runner, ['issue', 'view', issueUrl, '--repo', draft.repo, '--json', 'state']);
    if (view === 'unavailable') return manual(`GitHub CLI is unavailable. Open ${issueUrl} and add this comment:`);
    if (view.status !== 0) {
      if (needsAuth(view.stderr)) return manual(`GitHub authentication is unavailable. Open ${issueUrl} and add this comment:`);
      throw new Error(`GitHub issue lookup failed: ${failure(view)}`);
    }
    let state: unknown;
    try { state = (JSON.parse(view.stdout) as { state?: string }).state; } catch { state = undefined; }
    if (state !== 'OPEN' && state !== 'CLOSED') throw new Error('GitHub returned an unexpected issue state');
    const response = await withBodyFile(draft.body, path => gh(runner, ['issue', 'comment', issueUrl, '--repo', draft.repo, '--body-file', path]));
    if (response === 'unavailable') return manual(`GitHub CLI is unavailable. Open ${issueUrl} and add this comment:`);
    if (response.status !== 0) {
      if (needsAuth(response.stderr)) return manual(`GitHub authentication is unavailable. Open ${issueUrl} and add this comment:`);
      throw new Error(`GitHub comment failed: ${failure(response)}`);
    }
    // gh prints the comment URL; its format has varied between versions, so a successful exit is enough.
    let commentUrl: string | undefined;
    try { commentUrl = parseIssueUrl(draft.repo, response.stdout.trim(), true).commentUrl; } catch { commentUrl = undefined; }
    try {
      await updateLearning(root, id, { issueUrl, commentUrl, issueStatus: state });
    } catch (error) {
      throw new Error(`The comment was added to ${issueUrl}, but the local record could not be updated. Restore the record and run share ${id} --attach ${commentUrl ?? issueUrl}. Cause: ${(error as Error).message}`);
    }
    return commentUrl ?? issueUrl;
  });
}

export async function attachIssue(root: string, id: string, value: string): Promise<string> {
  await getLearning(root, id);
  return withLearningLock(root, id, async () => {
    const learning = await getLearning(root, id);
    if (learning.issueUrl) throw new Error(`Learning ${id} was already shared: ${learning.commentUrl ?? learning.issueUrl}`);
    const { issueUrl, commentUrl } = parseIssueUrl(await mappedRepo(root, learning), value, true);
    await updateLearning(root, id, { issueUrl, commentUrl });
    return commentUrl ?? issueUrl;
  });
}

export async function refreshIssue(root: string, id: string, runner: GhRunner = runGh): Promise<'OPEN' | 'CLOSED'> {
  await getLearning(root, id);
  return withLearningLock(root, id, async () => {
    const learning = await getLearning(root, id);
    if (!learning.issueUrl) throw new Error(`Learning ${id} has no submitted issue`);
    const repo = await mappedRepo(root, learning);
    const response = await runner('gh', ['issue', 'view', learning.issueUrl, '--repo', repo, '--json', 'state']);
    if (response.status !== 0) throw new Error(`GitHub issue status failed: ${failure(response)}`);
    const state = (JSON.parse(response.stdout) as { state?: string }).state;
    if (state !== 'OPEN' && state !== 'CLOSED') throw new Error('GitHub returned an unexpected issue state');
    await updateLearning(root, id, { issueStatus: state });
    return state;
  });
}
