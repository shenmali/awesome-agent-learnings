import { categories, kinds, type Category, type Kind } from './store.js';

// Maintainer preferences read from <repo>/.github/agent-learnings.json. A missing file means feedback is welcome.
// The format deliberately has no free-text fields, because its values reach the user's agent.
export interface Manifest { accepting: boolean; kinds?: Kind[]; categories?: Category[]; titlePrefix: string; feedbackUrl?: string }

export type Policy = { status: 'accepted' } | { status: 'blocked'; reason: string } | { status: 'redirect'; url: string };

export const manifestPath = '.github/agent-learnings.json';
export const defaultManifest: Manifest = { accepting: true, titlePrefix: '[agent-learnings]' };

function list<T extends string>(value: unknown, allowed: readonly T[], label: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16 || !value.every(item => typeof item === 'string')) throw new Error(`${label} must be a list of at most 16 strings`);
  return value.filter((item): item is T => allowed.includes(item as T));
}

export function parseManifest(text: string): Manifest {
  if (text.length > 16 * 1024) throw new Error('manifest is larger than 16 KiB');
  let value: unknown;
  try { value = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error('manifest is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest must be a JSON object');
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion must be 1');
  if (manifest.accepting !== undefined && typeof manifest.accepting !== 'boolean') throw new Error('accepting must be true or false');
  const prefix = manifest.titlePrefix ?? defaultManifest.titlePrefix;
  if (typeof prefix !== 'string' || !/^[\x20-\x7e]{1,32}$/.test(prefix) || /[<>]/.test(prefix) || !prefix.trim()) {
    throw new Error('titlePrefix must be 1 to 32 printable ASCII characters without < or >');
  }
  let feedbackUrl: string | undefined;
  if (manifest.feedbackUrl !== undefined) {
    let url: URL | undefined;
    try { url = typeof manifest.feedbackUrl === 'string' && manifest.feedbackUrl.length <= 500 ? new URL(manifest.feedbackUrl) : undefined; } catch { url = undefined; }
    if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('feedbackUrl must be an https URL without credentials');
    feedbackUrl = url.href;
  }
  return {
    accepting: (manifest.accepting as boolean | undefined) ?? true,
    kinds: list(manifest.kinds, kinds, 'kinds'),
    categories: list(manifest.categories, categories, 'categories'),
    titlePrefix: prefix.trim(),
    feedbackUrl,
  };
}

export function policyFor(manifest: Manifest, kind: Kind, category: Category): Policy {
  if (!manifest.accepting) return { status: 'blocked', reason: 'the maintainers are not accepting agent-learnings feedback' };
  if (manifest.feedbackUrl) return { status: 'redirect', url: manifest.feedbackUrl };
  if (manifest.categories && !manifest.categories.includes(category)) {
    return { status: 'blocked', reason: `category ${category} is not accepted (accepted: ${manifest.categories.join(', ') || 'none'})` };
  }
  if (manifest.kinds && !manifest.kinds.includes(kind)) {
    return { status: 'blocked', reason: `kind ${kind} is not accepted (accepted: ${manifest.kinds.join(', ') || 'none'})` };
  }
  return { status: 'accepted' };
}
