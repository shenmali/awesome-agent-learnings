const prefix = (match) => `${match[0].slice(0, 4)}…, ${match[0].length} chars`;
const length = (match) => `${match[0].length} chars`;
const octet = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const placeholder = /^(?:[$%{[<*/]|\.\/|~\/|process\.env|env\.|os\.environ|undefined$|null$|true$|false$|string$|number$|example|placeholder|redacted|changeme|your[_-])|x{4,}|\.\.\.|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/i;
const envName = /^[A-Z][A-Z0-9_]*$/;
function assignment(match) {
    const value = match[3];
    if (placeholder.test(value) || envName.test(value))
        return undefined;
    return `value assigned to ${match[1].toLowerCase()}, ${value.length} chars`;
}
const rules = [
    { label: 'GitHub token', severity: 'block', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g, hint: prefix },
    { label: 'Anthropic API key', severity: 'block', pattern: /\bsk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}/g, hint: prefix },
    { label: 'OpenAI API key', severity: 'block', pattern: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})\b/g, hint: prefix },
    { label: 'AWS access key', severity: 'block', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, hint: match => match[0].endsWith('EXAMPLE') ? undefined : prefix(match) },
    { label: 'Slack token', severity: 'block', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, hint: prefix },
    { label: 'Slack webhook', severity: 'block', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]{20,}/g, hint: length },
    { label: 'npm token', severity: 'block', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, hint: prefix },
    { label: 'Google API key', severity: 'block', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, hint: prefix },
    { label: 'Stripe key', severity: 'block', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g, hint: prefix },
    { label: 'private key', severity: 'block', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, hint: () => 'key block header' },
    { label: 'JSON Web Token', severity: 'block', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, hint: length },
    { label: 'credentials in URL', severity: 'block', pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s/]+/gi, hint: match => `${match[0].split(':')[0]}://…:…@…` },
    { label: 'bearer token', severity: 'block', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi, hint: length },
    {
        label: 'secret assignment',
        severity: 'block',
        pattern: /\b[A-Za-z0-9_.-]*?(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*(["']?)([^\s"'<>]{8,})\2/gi,
        hint: assignment,
    },
    {
        label: 'email address',
        severity: 'warn',
        pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b/g,
        hint: match => /^(?:git|no-?reply[^@]*)@|@(?:users\.noreply\.github\.com|example\.(?:com|org|net))$/i.test(match[0]) ? undefined : `${match[0][0]}…@…`,
    },
    { label: 'home directory path', severity: 'warn', pattern: /\/(?:Users|home)\/(?!Shared\b)[^\s/"'`:;,)]+/g, hint: match => `${match[0].split('/').slice(0, 2).join('/')}/${match[0].split('/')[2][0]}…` },
    { label: 'home directory path', severity: 'warn', pattern: /\b[A-Za-z]:[\\/]+Users[\\/]+[^\s\\/"'`:;,)]+/gi, hint: match => `${match[0].slice(0, 3)}Users\\…` },
    {
        label: 'IP address',
        severity: 'warn',
        pattern: new RegExp(`(?<![\\d.])${octet}(?:\\.${octet}){3}(?!\\.?\\d)`, 'g'),
        hint: match => /^(?:127\.|0\.0\.0\.0$|255\.255\.255\.255$)/.test(match[0]) ? undefined : `${match[0].split('.')[0]}.…`,
    },
];
function classes(value) {
    return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9.-]/].filter(pattern => pattern.test(value)).length;
}
export function scanSensitive(text) {
    const found = [];
    for (const rule of rules) {
        rule.pattern.lastIndex = 0;
        for (let match = rule.pattern.exec(text); match; match = rule.pattern.exec(text)) {
            const hint = rule.hint ? rule.hint(match) : length(match);
            if (hint === undefined)
                continue;
            let severity = rule.severity;
            if (rule.label === 'secret assignment' && !(/\d/.test(match[3]) && classes(match[3]) >= 2)) {
                // Words without digits are usually prose ("secret: important-thing"), except for passwords.
                if (!/^passw/i.test(match[1]))
                    continue;
                severity = 'warn';
            }
            found.push({ severity, label: rule.label, start: match.index, end: match.index + match[0].length, hint });
        }
    }
    const ordered = found.sort((a, b) => (a.severity === b.severity ? a.start - b.start : a.severity === 'block' ? -1 : 1));
    const kept = [];
    for (const item of ordered) {
        if (!kept.some(other => item.start < other.end && other.start < item.end))
            kept.push(item);
    }
    return kept.sort((a, b) => a.start - b.start);
}
export function scanFields(fields) {
    return Object.entries(fields).flatMap(([field, value]) => value === undefined ? [] : scanSensitive(value).map(item => ({ ...item, field })));
}
export function describeFinding(item) {
    return `possible ${item.label}${item.field ? ` in ${item.field}` : ''} (${item.hint})`;
}
export function redact(text) {
    let result = '';
    let position = 0;
    for (const item of scanSensitive(text).filter(finding => finding.severity === 'block')) {
        result += `${text.slice(position, item.start)}[REDACTED: ${item.label}]`;
        position = item.end;
    }
    return result + text.slice(position);
}
export function assertNoSecrets(fields, action) {
    const blocked = scanFields(fields).filter(item => item.severity === 'block');
    if (blocked.length) {
        throw new Error(`Refusing to ${action}: ${blocked.map(describeFinding).join('; ')}. Remove the sensitive value and try again.`);
    }
}
