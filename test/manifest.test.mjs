import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultManifest, parseManifest, policyFor } from '../plugins/agent-learnings/dist/manifest.js';

test('maintainer manifest accepts the documented fields and ignores unknown ones', () => {
  const manifest = parseManifest('﻿{"schemaVersion":1,"accepting":true,"kinds":["skill","workflow"],"categories":["bug"],"titlePrefix":" [learning] ","feedbackUrl":"https://example.com/f","labels":["x"]}');
  assert.deepEqual(manifest, { accepting: true, kinds: ['skill'], categories: ['bug'], titlePrefix: '[learning]', feedbackUrl: 'https://example.com/f' });
  assert.deepEqual(parseManifest('{"schemaVersion":1}'), { ...defaultManifest, kinds: undefined, categories: undefined, feedbackUrl: undefined });
});

test('maintainer manifest rejects malformed values', () => {
  for (const [text, message] of [
    ['[]', /JSON object/],
    ['not json', /valid JSON/],
    ['{}', /schemaVersion/],
    ['{"schemaVersion":1,"accepting":"no"}', /accepting/],
    ['{"schemaVersion":1,"feedbackUrl":"http://example.com"}', /https/],
    ['{"schemaVersion":1,"feedbackUrl":"https://user:pw@example.com"}', /credentials/],
    ['{"schemaVersion":1,"titlePrefix":"line\\nbreak"}', /titlePrefix/],
    ['{"schemaVersion":1,"titlePrefix":"<b>"}', /titlePrefix/],
    ['{"schemaVersion":1,"kinds":"skill"}', /kinds/],
    [`{"schemaVersion":1,"pad":"${'x'.repeat(17000)}"}`, /16 KiB/],
  ]) assert.throws(() => parseManifest(text), message, text.slice(0, 40));
});

test('policy checks opt-out, redirect, category and kind in that order', () => {
  assert.equal(policyFor({ ...defaultManifest, accepting: false, feedbackUrl: 'https://x.dev/' }, 'skill', 'bug').status, 'blocked');
  assert.deepEqual(policyFor({ ...defaultManifest, feedbackUrl: 'https://x.dev/', categories: [] }, 'skill', 'bug'), { status: 'redirect', url: 'https://x.dev/' });
  assert.match(policyFor({ ...defaultManifest, categories: ['bug'], kinds: ['hook'] }, 'skill', 'praise').reason, /category/);
  assert.match(policyFor({ ...defaultManifest, kinds: ['hook'] }, 'skill', 'praise').reason, /kind skill/);
  assert.deepEqual(policyFor(defaultManifest, 'other', 'improvement'), { status: 'accepted' });
});
