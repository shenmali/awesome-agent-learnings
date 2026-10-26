import { categories, kinds } from './store.js';
export const manifestPath = '.github/agent-learnings.json';
export const defaultManifest = { accepting: true, titlePrefix: '[agent-learnings]' };
function list(value, allowed, label) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.length > 16 || !value.every(item => typeof item === 'string'))
        throw new Error(`${label} must be a list of at most 16 strings`);
    return value.filter((item) => allowed.includes(item));
}
export function parseManifest(text) {
    if (text.length > 16 * 1024)
        throw new Error('manifest is larger than 16 KiB');
    let value;
    try {
        value = JSON.parse(text.replace(/^﻿/, ''));
    }
    catch {
        throw new Error('manifest is not valid JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('manifest must be a JSON object');
    const manifest = value;
    if (manifest.schemaVersion !== 1)
        throw new Error('manifest schemaVersion must be 1');
    if (manifest.accepting !== undefined && typeof manifest.accepting !== 'boolean')
        throw new Error('accepting must be true or false');
    const prefix = manifest.titlePrefix ?? defaultManifest.titlePrefix;
    if (typeof prefix !== 'string' || !/^[\x20-\x7e]{1,32}$/.test(prefix) || /[<>]/.test(prefix) || !prefix.trim()) {
        throw new Error('titlePrefix must be 1 to 32 printable ASCII characters without < or >');
    }
    let feedbackUrl;
    if (manifest.feedbackUrl !== undefined) {
        let url;
        try {
            url = typeof manifest.feedbackUrl === 'string' && manifest.feedbackUrl.length <= 500 ? new URL(manifest.feedbackUrl) : undefined;
        }
        catch {
            url = undefined;
        }
        if (!url || url.protocol !== 'https:' || url.username || url.password)
            throw new Error('feedbackUrl must be an https URL without credentials');
        feedbackUrl = url.href;
    }
    return {
        accepting: manifest.accepting ?? true,
        kinds: list(manifest.kinds, kinds, 'kinds'),
        categories: list(manifest.categories, categories, 'categories'),
        titlePrefix: prefix.trim(),
        feedbackUrl,
    };
}
export function policyFor(manifest, kind, category) {
    if (!manifest.accepting)
        return { status: 'blocked', reason: 'the maintainers are not accepting agent-learnings feedback' };
    if (manifest.feedbackUrl)
        return { status: 'redirect', url: manifest.feedbackUrl };
    if (manifest.categories && !manifest.categories.includes(category)) {
        return { status: 'blocked', reason: `category ${category} is not accepted (accepted: ${manifest.categories.join(', ') || 'none'})` };
    }
    if (manifest.kinds && !manifest.kinds.includes(kind)) {
        return { status: 'blocked', reason: `kind ${kind} is not accepted (accepted: ${manifest.kinds.join(', ') || 'none'})` };
    }
    return { status: 'accepted' };
}
