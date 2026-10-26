import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectRoot } from './project.js';
import { getReminders, writeReplace } from './store.js';
export const claudeEvents = ['PostToolUse', 'UserPromptExpansion', 'Stop', 'SessionEnd'];
const maxComponents = 20;
const dayMs = 24 * 60 * 60 * 1000;
const stateFile = /^[0-9a-f]{32}\.json(?:\.[0-9a-f]+\.tmp)?$/;
const own = /^agent-learnings:|^(?:capture-learning|share-learning|manage-learnings)$/;
function component(kind, name) {
    if (typeof name !== 'string')
        return [];
    const clean = name.trim();
    if (!clean || clean.length > 80 || !/^[\w.:@/-]+$/.test(clean) || own.test(clean))
        return [];
    return [`${kind}:${clean}`];
}
function claude(event, payload) {
    if (typeof payload.session_id !== 'string' || !payload.session_id)
        return undefined;
    const base = { sessionId: payload.session_id, cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined, format: 'claude' };
    if (event === 'PostToolUse') {
        const tool = payload.tool_name;
        const input = (payload.tool_input ?? {});
        if (tool === 'Skill')
            return { ...base, action: 'use', components: component('skill', input.skill) };
        if (tool === 'Agent' || tool === 'Task')
            return { ...base, action: 'use', components: component('agent', input.subagent_type) };
        const mcp = typeof tool === 'string' ? /^mcp__(.+?)__/.exec(tool) : null;
        return mcp ? { ...base, action: 'use', components: component('mcp', mcp[1]) } : undefined;
    }
    if (event === 'UserPromptExpansion') {
        if (typeof payload.command_source !== 'string' || /^built-?in$/i.test(payload.command_source))
            return undefined;
        return { ...base, action: 'use', components: component('command', payload.command_name) };
    }
    if (event === 'Stop')
        return { ...base, action: 'stop', components: [] };
    if (event === 'SessionEnd')
        return { ...base, action: 'end', components: [] };
    return undefined;
}
// Platform-neutral input for manual hook setups: {"sessionId": "...", "components": ["skill:x"], "cwd": "..."}.
function generic(event, payload) {
    if ((event !== 'use' && event !== 'stop' && event !== 'end') || typeof payload.sessionId !== 'string' || !payload.sessionId)
        return undefined;
    const components = Array.isArray(payload.components)
        ? payload.components.flatMap(item => typeof item === 'string' && /^[a-z]+:/.test(item) ? component(item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)) : [])
        : [];
    return { action: event, sessionId: payload.sessionId, components, cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined, format: 'text' };
}
export function adaptHook(spec, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return undefined;
    const [platform, event = ''] = spec.split(':');
    if (platform === 'claude')
        return claude(event, payload);
    if (platform === 'generic')
        return generic(event, payload);
    return undefined;
}
export function envReminders(env) {
    const value = env.AGENT_LEARNINGS_REMINDERS?.trim().toLowerCase();
    if (value && ['1', 'true', 'on', 'yes'].includes(value))
        return true;
    if (value && ['0', 'false', 'off', 'no'].includes(value))
        return false;
    return undefined;
}
export function remindersEnabled(env, configured) {
    return envReminders(env) ?? configured ?? false;
}
export function stateDir(env) {
    if (env.AGENT_LEARNINGS_STATE_DIR)
        return env.AGENT_LEARNINGS_STATE_DIR;
    if (env.CLAUDE_PLUGIN_DATA)
        return join(env.CLAUDE_PLUGIN_DATA, 'sessions');
    return join(tmpdir(), `agent-learnings-${process.getuid?.() ?? 'user'}`);
}
// Shared temp directories are writable by other users, so refuse symlinks and directories owned by someone else.
async function ensureDir(dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory())
        return false;
    return typeof process.getuid !== 'function' || info.uid === process.getuid();
}
const statePath = (dir, sessionId) => join(dir, `${createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}.json`);
async function readState(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        if (value.v === 1 && Array.isArray(value.components)) {
            return { v: 1, components: value.components.filter(item => typeof item === 'string').slice(0, maxComponents), reminded: value.reminded === true };
        }
    }
    catch {
        // Missing or damaged state starts fresh.
    }
    return { v: 1, components: [], reminded: false };
}
export async function recordUse(event, dir) {
    if (!event.components.length || !(await ensureDir(dir)))
        return;
    const path = statePath(dir, event.sessionId);
    const state = await readState(path);
    const components = [...new Set([...state.components, ...event.components])].slice(0, maxComponents);
    if (components.length !== state.components.length)
        await writeReplace(path, JSON.stringify({ ...state, components }));
}
function message(components, format) {
    const names = components.length > 3 ? `${components.slice(0, 3).join(', ')} and ${components.length - 3} more` : components.join(', ');
    const command = format === 'claude' ? '/agent-learnings:capture-learning' : 'the capture-learning skill';
    return `agent-learnings: this session used ${names}. If something worked well or could be better, run ${command} to record it.`;
}
export async function takeReminder(event, dir, now = Date.now()) {
    if (!(await ensureDir(dir)))
        return undefined;
    const path = statePath(dir, event.sessionId);
    const state = await readState(path);
    await cleanupState(dir, now);
    if (state.reminded || !state.components.length)
        return undefined;
    await writeReplace(path, JSON.stringify({ ...state, reminded: true }));
    return message(state.components, event.format);
}
export async function cleanupState(dir, now = Date.now(), maxAgeMs = dayMs) {
    let removed = 0;
    let files;
    try {
        files = await readdir(dir);
    }
    catch {
        return 0;
    }
    for (const file of files.filter(name => stateFile.test(name)).slice(0, 200)) {
        try {
            if (now - (await stat(join(dir, file))).mtimeMs > maxAgeMs) {
                await unlink(join(dir, file));
                removed++;
            }
        }
        catch {
            // Another hook may have removed it.
        }
    }
    return removed;
}
async function enabled(env, cwd) {
    const fromEnv = envReminders(env);
    if (fromEnv !== undefined)
        return fromEnv;
    if (!cwd)
        return false;
    try {
        return remindersEnabled(env, await getReminders(await findProjectRoot(cwd)));
    }
    catch {
        return false;
    }
}
// Hook entry point. It never throws and returns '' when there is nothing to print, so it cannot break the host agent.
export async function runHook(spec, raw, options = {}) {
    const env = options.env ?? process.env;
    try {
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch {
            return '';
        }
        const event = adaptHook(spec, payload);
        if (!event)
            return '';
        const dir = options.stateDir ?? stateDir(env);
        if (event.action === 'end') {
            await unlink(statePath(dir, event.sessionId)).catch(() => { });
            await cleanupState(dir, options.now);
            return '';
        }
        if (!(await enabled(env, event.cwd)))
            return '';
        if (event.action === 'use') {
            await recordUse(event, dir);
            return '';
        }
        const text = await takeReminder(event, dir, options.now);
        if (!text)
            return '';
        return event.format === 'claude' ? JSON.stringify({ systemMessage: text }) : text;
    }
    catch (error) {
        if (env.AGENT_LEARNINGS_DEBUG === '1')
            process.stderr.write(`agent-learnings hook: ${error.message}\n`);
        return '';
    }
}
