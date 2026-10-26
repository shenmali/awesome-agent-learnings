import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoSecrets, describeFinding, redact, scanSensitive } from '../plugins/agent-learnings/dist/privacy.js';

// Fake secrets are assembled at runtime so that secret scanners do not flag this file.
const fake = {
  github: 'gh' + 'p_' + 'a1B2'.repeat(9),
  githubPat: 'github' + '_pat_' + '11ABCDEFG0_' + 'a1'.repeat(30),
  anthropic: 'sk-' + 'ant-api03-' + 'Ab1_'.repeat(10),
  openaiProject: 'sk-' + 'proj-' + 'Ab1-'.repeat(8),
  openaiLegacy: 'sk-' + 'aB3'.repeat(12),
  aws: 'AK' + 'IA' + 'ABCDEFGH12345678',
  slack: 'xo' + 'xb-' + '1234567890-abcdefghij',
  npm: 'np' + 'm_' + 'aB3d'.repeat(9),
  privateKey: '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  jwt: 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  urlCredentials: 'https://deploy:' + 'hunter22pass@example.com/repo.git',
  bearer: 'Authorization: Bearer ' + 'abcdefghijklmnopqrstuvwxyz123456',
  assignment: 'pass' + 'word=hunter22x',
  quotedAssignment: 'API_' + 'KEY="Zx9yW8vU7t"',
};

const blocked = text => scanSensitive(text).filter(item => item.severity === 'block');

test('privacy scan blocks common credential formats', () => {
  for (const [name, secret] of Object.entries(fake)) {
    const findings = blocked(`Before ${secret} after`);
    assert.equal(findings.length, 1, name);
  }
});

test('privacy scan ignores ordinary technical text', () => {
  const samples = [
    'Tried sk-learn-based-classifier-for-skills', 'Set max_tokens=4096', 'token: process.env.GITHUB_TOKEN', 'token: GITHUB_TOKEN',
    'export X=$Y', 'password: string', 'AK' + 'IAIOSFODNN7EXAMPLE', 'ghp_xxxx', 'https://host:8080/p@x', 'version 1.2.3.4.5',
    'agent-learnings@0.1.0', 'git@github.com:obra/superpowers.git', '123456+octo@users.noreply.github.com',
    'git clone https://github.com/obra/superpowers', 'Use a Bearer token for auth', 'secret: important-thing', 'Loopback 127.0.0.1',
  ];
  for (const sample of samples) assert.deepEqual(scanSensitive(sample), [], sample);
  assert.deepEqual(blocked('pwd=/home/x'), []);
});

test('privacy scan warns about personal details and weak assignments', () => {
  for (const [sample, label] of [
    ['Contact alice@company.io', 'email address'],
    ['Saved in /Users/alice/project', 'home directory path'],
    ['Saved in C:\\Users\\bob\\repo', 'home directory path'],
    ['Server 10.0.0.5.', 'IP address'],
    ['password=correcthorse', 'secret assignment'],
  ]) {
    const findings = scanSensitive(sample);
    assert.equal(findings.length, 1, sample);
    assert.equal(findings[0].severity, 'warn', sample);
    assert.equal(findings[0].label, label, sample);
  }
});

test('privacy findings never echo the sensitive value', () => {
  for (const secret of Object.values(fake)) {
    for (const finding of scanSensitive(secret)) assert.ok(!describeFinding(finding).includes(secret.slice(-12)), secret);
  }
  assert.match(redact(`key ${fake.github} and alice@company.io`), /^key \[REDACTED: GitHub token\] and alice@company\.io$/);
  assert.throws(() => assertNoSecrets({ change: `use ${fake.npm}` }, 'share'), error => /Refusing to share: possible npm token in change/.test(error.message) && !error.message.includes(fake.npm));
});

test('overlapping matches are reported once', () => {
  assert.equal(scanSensitive(`Authorization: Bearer ${fake.jwt}`).length, 1);
});
