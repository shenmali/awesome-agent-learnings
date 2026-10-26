import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultManifest, manifestPath, parseManifest, policyFor } from './manifest.js';
import { assertNoSecrets, redact, scanFields } from './privacy.js';
import { effectiveCategory, effectiveKind, getLearning, getTarget, learningFields, updateLearning, withLearningLock } from './store.js';
export const runGh = (command, args) => new Promise((resolve, reject) => {
    const program = command === 'gh' ? process.env.AGENT_LEARNINGS_GH || 'gh' : command;
    execFile(program, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && error.code === 'ENOENT')
            return reject(error);
        resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
});
function unavailable(error) {
    return error?.code === 'ENOENT';
}
function needsAuth(stderr) {
    return /not logged in|authentication required|gh auth login|authenticate with|HTTP 401/i.test(stderr);
}
async function gh(runner, args) {
    try {
        return await runner('gh', args);
    }
    catch (error) {
        if (unavailable(error))
            return 'unavailable';
        throw error;
    }
}
const failure = (response) => response.stderr.trim() || `exit ${response.status}`;
// Text from GitHub is written by other people; strip control, bidi and zero-width characters before showing it.
function cleanText(text) {
    return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
}
async function mappedRepo(root, learning) {
    const target = await getTarget(root, learning.target);
    if (!target)
        throw new Error(`No GitHub repository mapped for ${learning.target}. Run target add first.`);
    return target.repo;
}
export function parseIssueUrl(repo, value, allowComment = false) {
    const invalid = new Error('Issue URL does not match the mapped GitHub repository');
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        throw invalid;
    }
    const expected = `/${repo}/issues/`.toLowerCase();
    const number = url.pathname.slice(expected.length);
    const comment = /^#issuecomment-(\d+)$/.exec(url.hash);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || (url.hash && !(allowComment && comment)) || !url.pathname.toLowerCase().startsWith(expected) || !/^\d+$/.test(number)) {
        throw invalid;
    }
    const issueUrl = `https://github.com/${repo}/issues/${number}`;
    return { issueUrl, commentUrl: comment ? `${issueUrl}#issuecomment-${comment[1]}` : undefined };
}
export async function fetchManifest(repo, runner = runGh) {
    const response = await gh(runner, ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${manifestPath}`]);
    if (response === 'unavailable')
        return { source: 'unchecked', manifest: defaultManifest, note: 'GitHub CLI is unavailable' };
    if (response.status !== 0) {
        if (needsAuth(response.stderr))
            return { source: 'unchecked', manifest: defaultManifest, note: 'GitHub authentication is unavailable' };
        if (/HTTP 404|Not Found/i.test(response.stderr))
            return { source: 'default', manifest: defaultManifest };
        return { source: 'error', manifest: defaultManifest, note: cleanText(failure(response)) };
    }
    try {
        return { source: 'repository', manifest: parseManifest(response.stdout) };
    }
    catch (error) {
        return { source: 'invalid', manifest: defaultManifest, note: error.message };
    }
}
export function describeManifest(repo, result) {
    if (result.source === 'repository')
        return `from ${repo}/${manifestPath}`;
    if (result.source === 'default')
        return `default (no ${manifestPath} in ${repo})`;
    if (result.source === 'unchecked')
        return `not checked (${result.note})`;
    if (result.source === 'invalid')
        return `invalid ${manifestPath} in ${repo} (${result.note})`;
    return `could not be checked (${result.note})`;
}
function sharePolicy(repo, result, learning) {
    if (result.source === 'invalid')
        return { status: 'blocked', reason: `the maintainer settings in ${repo}/${manifestPath} are invalid: ${result.note}` };
    if (result.source === 'error')
        return { status: 'blocked', reason: `could not read maintainer settings for ${repo}: ${result.note}` };
    return policyFor(result.manifest, effectiveKind(learning), effectiveCategory(learning));
}
export function issueTitle(learning, prefix) {
    const situation = learning.situation.replace(/\s+/g, ' ');
    const summary = situation.length > 80 ? `${situation.slice(0, 77)}...` : situation;
    return `${prefix} ${effectiveCategory(learning)}: ${learning.component ?? learning.target} - ${summary}`.slice(0, 200);
}
// Machine-readable summary for maintainer automation. Escaping <, > and & keeps it inside the HTML comment.
function marker(learning) {
    const data = { v: 1, kind: effectiveKind(learning), component: learning.component, category: effectiveCategory(learning), platform: learning.platform, version: learning.version };
    return `<!-- agent-learnings ${JSON.stringify(data).replace(/[<>&]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)} -->`;
}
function draftFor(repo, learning, manifest) {
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
export async function prepareIssue(root, id, manifest = defaultManifest) {
    const learning = await getLearning(root, id);
    return draftFor(await mappedRepo(root, learning), learning, manifest);
}
export function relatedQuery(learning, manifest) {
    // Only metadata that is published anyway; the situation text stays local until the user approves it.
    return `"${(learning.component ?? manifest.titlePrefix).replace(/["\\]/g, '')}" in:title`;
}
export async function findRelated(repo, query, runner = runGh) {
    const response = await gh(runner, ['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '5', '--search', query, '--json', 'number,title,url,state']);
    if (response === 'unavailable')
        return { issues: [], skipped: 'GitHub CLI is unavailable' };
    if (response.status !== 0)
        return { issues: [], skipped: needsAuth(response.stderr) ? 'GitHub authentication is unavailable' : cleanText(failure(response)) };
    let parsed;
    try {
        parsed = JSON.parse(response.stdout);
    }
    catch {
        return { issues: [], skipped: 'GitHub returned an unexpected response' };
    }
    if (!Array.isArray(parsed))
        return { issues: [], skipped: 'GitHub returned an unexpected response' };
    const issues = parsed.flatMap((item) => {
        if (typeof item?.number !== 'number' || typeof item.title !== 'string' || typeof item.url !== 'string' || (item.state !== 'OPEN' && item.state !== 'CLOSED'))
            return [];
        try {
            return [{ number: item.number, title: cleanText(item.title).slice(0, 120), url: parseIssueUrl(repo, item.url).issueUrl, state: item.state }];
        }
        catch {
            return [];
        }
    });
    return { issues };
}
export async function previewShare(root, id, runner = runGh) {
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
async function withBodyFile(body, action) {
    const temp = await mkdtemp(join(tmpdir(), 'agent-learnings-issue-'));
    const path = join(temp, 'body.md');
    try {
        await writeFile(path, body, 'utf8');
        return await action(path);
    }
    finally {
        await unlink(path).catch(() => { });
        await rmdir(temp).catch(() => { });
    }
}
const attachHint = (id) => `\n\nAfter submitting, link it: agent-learnings share ${id} --attach <issue-url>`;
// Shared checks before anything is sent: not yet shared, no secrets, maintainer policy, GitHub size limit.
async function shareable(root, id, runner) {
    const learning = await getLearning(root, id);
    if (learning.issueUrl)
        throw new Error(`Learning ${id} was already shared: ${learning.commentUrl ?? learning.issueUrl}`);
    assertNoSecrets(learningFields(learning), 'share this learning');
    const repo = await mappedRepo(root, learning);
    const manifest = await fetchManifest(repo, runner);
    const policy = sharePolicy(repo, manifest, learning);
    if (policy.status === 'blocked')
        throw new Error(`Not sharing ${id}: ${policy.reason}`);
    const draft = draftFor(repo, learning, manifest.manifest);
    if (draft.body.length > 65000)
        throw new Error('The learning is too long for a GitHub issue; shorten it with learn edit');
    return { learning, draft, policy };
}
export async function publishIssue(root, id, runner = runGh) {
    await getLearning(root, id);
    return withLearningLock(root, id, async () => {
        const { draft, policy } = await shareable(root, id, runner);
        const manual = (intro) => `${intro}\n\n# ${draft.title}\n\n${draft.body}${attachHint(id)}`;
        if (policy.status === 'redirect')
            return manual(`The maintainers of ${draft.repo} collect feedback at ${policy.url}. Submit this text there:`);
        const response = await withBodyFile(draft.body, path => gh(runner, ['issue', 'create', '--repo', draft.repo, '--title', draft.title, '--body-file', path]));
        if (response === 'unavailable')
            return manual(`GitHub CLI is unavailable. Open ${draft.newIssueUrl} and paste this issue:`);
        if (response.status !== 0) {
            if (needsAuth(response.stderr))
                return manual(`GitHub authentication is unavailable. Open ${draft.newIssueUrl} and paste this issue:`);
            throw new Error(`GitHub issue creation failed: ${failure(response)}`);
        }
        let issueUrl;
        try {
            issueUrl = parseIssueUrl(draft.repo, response.stdout.trim()).issueUrl;
        }
        catch {
            throw new Error(`GitHub returned an unexpected issue URL: ${response.stdout.trim()}`);
        }
        try {
            await updateLearning(root, id, { issueUrl, issueStatus: 'OPEN' });
        }
        catch (error) {
            throw new Error(`GitHub issue was created at ${issueUrl}, but the local record could not be updated. Restore the record and run share ${id} --attach ${issueUrl}. Cause: ${error.message}`);
        }
        return issueUrl;
    });
}
export async function commentIssue(root, id, value, runner = runGh) {
    await getLearning(root, id);
    return withLearningLock(root, id, async () => {
        const learning = await getLearning(root, id);
        const { issueUrl } = parseIssueUrl(await mappedRepo(root, learning), value);
        const { draft, policy } = await shareable(root, id, runner);
        const manual = (intro) => `${intro}\n\n${draft.body}${attachHint(id)}`;
        if (policy.status === 'redirect')
            return manual(`The maintainers of ${draft.repo} collect feedback at ${policy.url}. Submit this text there:`);
        const view = await gh(runner, ['issue', 'view', issueUrl, '--repo', draft.repo, '--json', 'state']);
        if (view === 'unavailable')
            return manual(`GitHub CLI is unavailable. Open ${issueUrl} and add this comment:`);
        if (view.status !== 0) {
            if (needsAuth(view.stderr))
                return manual(`GitHub authentication is unavailable. Open ${issueUrl} and add this comment:`);
            throw new Error(`GitHub issue lookup failed: ${failure(view)}`);
        }
        let state;
        try {
            state = JSON.parse(view.stdout).state;
        }
        catch {
            state = undefined;
        }
        if (state !== 'OPEN' && state !== 'CLOSED')
            throw new Error('GitHub returned an unexpected issue state');
        const response = await withBodyFile(draft.body, path => gh(runner, ['issue', 'comment', issueUrl, '--repo', draft.repo, '--body-file', path]));
        if (response === 'unavailable')
            return manual(`GitHub CLI is unavailable. Open ${issueUrl} and add this comment:`);
        if (response.status !== 0) {
            if (needsAuth(response.stderr))
                return manual(`GitHub authentication is unavailable. Open ${issueUrl} and add this comment:`);
            throw new Error(`GitHub comment failed: ${failure(response)}`);
        }
        // gh prints the comment URL; its format has varied between versions, so a successful exit is enough.
        let commentUrl;
        try {
            commentUrl = parseIssueUrl(draft.repo, response.stdout.trim(), true).commentUrl;
        }
        catch {
            commentUrl = undefined;
        }
        try {
            await updateLearning(root, id, { issueUrl, commentUrl, issueStatus: state });
        }
        catch (error) {
            throw new Error(`The comment was added to ${issueUrl}, but the local record could not be updated. Restore the record and run share ${id} --attach ${commentUrl ?? issueUrl}. Cause: ${error.message}`);
        }
        return commentUrl ?? issueUrl;
    });
}
export async function attachIssue(root, id, value) {
    await getLearning(root, id);
    return withLearningLock(root, id, async () => {
        const learning = await getLearning(root, id);
        if (learning.issueUrl)
            throw new Error(`Learning ${id} was already shared: ${learning.commentUrl ?? learning.issueUrl}`);
        const { issueUrl, commentUrl } = parseIssueUrl(await mappedRepo(root, learning), value, true);
        await updateLearning(root, id, { issueUrl, commentUrl });
        return commentUrl ?? issueUrl;
    });
}
export async function refreshIssue(root, id, runner = runGh) {
    await getLearning(root, id);
    return withLearningLock(root, id, async () => {
        const learning = await getLearning(root, id);
        if (!learning.issueUrl)
            throw new Error(`Learning ${id} has no submitted issue`);
        const repo = await mappedRepo(root, learning);
        const response = await runner('gh', ['issue', 'view', learning.issueUrl, '--repo', repo, '--json', 'state']);
        if (response.status !== 0)
            throw new Error(`GitHub issue status failed: ${failure(response)}`);
        const state = JSON.parse(response.stdout).state;
        if (state !== 'OPEN' && state !== 'CLOSED')
            throw new Error('GitHub returned an unexpected issue state');
        await updateLearning(root, id, { issueStatus: state });
        return state;
    });
}
