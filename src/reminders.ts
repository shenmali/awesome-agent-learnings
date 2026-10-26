import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectRoot } from './project.js';
import { autoCaptureInstructions } from './skills.js';
import { getMode, getReminders, modes, writeReplace, type Mode } from './store.js';

// Opt-in end-of-turn reminders and auto mode. Hooks report which components a session used; the state keeps only a
// hash of the session id and component names, never prompts, tool input or output.

export type HookAction = 'use' | 'stop' | 'end';
// continued: the agent is already continuing because of a Stop hook (Claude Code stop_hook_active).
export interface HookEvent { action: HookAction; sessionId: string; components: string[]; cwd?: string; format: 'text' | 'claude'; continued?: boolean }
export interface HookOptions { env?: NodeJS.ProcessEnv; stateDir?: string; now?: number }
interface State { v: 1; components: string[]; reminded: boolean }

export const claudeEvents = ['PostToolUse', 'UserPromptExpansion', 'Stop', 'SessionEnd'];
const maxComponents = 20;
const dayMs = 24 * 60 * 60 * 1000;
const stateFile = /^[0-9a-f]{32}\.json(?:\.[0-9a-f]+\.tmp)?$/;
const own = /^agent-learnings:|^(?:capture-learning|share-learning|manage-learnings)$/;

function component(kind: string, name: unknown): string[] {
  if (typeof name !== 'string') return [];
  const clean = name.trim();
  if (!clean || clean.length > 80 || !/^[\w.:@/-]+$/.test(clean) || own.test(clean)) return [];
  return [`${kind}:${clean}`];
}

function claude(event: string, payload: Record<string, unknown>): HookEvent | undefined {
  if (typeof payload.session_id !== 'string' || !payload.session_id) return undefined;
  const base = { sessionId: payload.session_id, cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined, format: 'claude' as const };
  if (event === 'PostToolUse') {
    const tool = payload.tool_name;
    const input = (payload.tool_input ?? {}) as Record<string, unknown>;
    if (tool === 'Skill') return { ...base, action: 'use', components: component('skill', input.skill) };
    if (tool === 'Agent' || tool === 'Task') return { ...base, action: 'use', components: component('agent', input.subagent_type) };
    const mcp = typeof tool === 'string' ? /^mcp__(.+?)__/.exec(tool) : null;
    return mcp ? { ...base, action: 'use', components: component('mcp', mcp[1]) } : undefined;
  }
  if (event === 'UserPromptExpansion') {
    if (typeof payload.command_source !== 'string' || /^built-?in$/i.test(payload.command_source)) return undefined;
    return { ...base, action: 'use', components: component('command', payload.command_name) };
  }
  if (event === 'Stop') return { ...base, action: 'stop', components: [], continued: payload.stop_hook_active === true };
  if (event === 'SessionEnd') return { ...base, action: 'end', components: [] };
  return undefined;
}

// Platform-neutral input for manual hook setups: {"sessionId": "...", "components": ["skill:x"], "cwd": "..."}.
function generic(event: string, payload: Record<string, unknown>): HookEvent | undefined {
  if ((event !== 'use' && event !== 'stop' && event !== 'end') || typeof payload.sessionId !== 'string' || !payload.sessionId) return undefined;
  const components = Array.isArray(payload.components)
    ? payload.components.flatMap(item => typeof item === 'string' && /^[a-z]+:/.test(item) ? component(item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)) : [])
    : [];
  return { action: event, sessionId: payload.sessionId, components, cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined, format: 'text' };
}

export function adaptHook(spec: string, payload: unknown): HookEvent | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const [platform, event = ''] = spec.split(':');
  if (platform === 'claude') return claude(event, payload as Record<string, unknown>);
  if (platform === 'generic') return generic(event, payload as Record<string, unknown>);
  return undefined;
}

export function envReminders(env: NodeJS.ProcessEnv): boolean | undefined {
  const value = env.AGENT_LEARNINGS_REMINDERS?.trim().toLowerCase();
  if (value && ['1', 'true', 'on', 'yes'].includes(value)) return true;
  if (value && ['0', 'false', 'off', 'no'].includes(value)) return false;
  return undefined;
}

export function remindersEnabled(env: NodeJS.ProcessEnv, configured: boolean | undefined): boolean {
  return envReminders(env) ?? configured ?? false;
}

export function envMode(env: NodeJS.ProcessEnv): Mode | undefined {
  const value = env.AGENT_LEARNINGS_MODE?.trim().toLowerCase();
  return modes.includes(value as Mode) ? value as Mode : undefined;
}

export function effectiveMode(env: NodeJS.ProcessEnv, configured: Mode | undefined): Mode {
  return envMode(env) ?? configured ?? 'manual';
}

export function stateDir(env: NodeJS.ProcessEnv): string {
  if (env.AGENT_LEARNINGS_STATE_DIR) return env.AGENT_LEARNINGS_STATE_DIR;
  if (env.CLAUDE_PLUGIN_DATA) return join(env.CLAUDE_PLUGIN_DATA, 'sessions');
  return join(tmpdir(), `agent-learnings-${process.getuid?.() ?? 'user'}`);
}

// Shared temp directories are writable by other users, so refuse symlinks and directories owned by someone else.
async function ensureDir(dir: string): Promise<boolean> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) return false;
  return typeof process.getuid !== 'function' || info.uid === process.getuid();
}

const statePath = (dir: string, sessionId: string) => join(dir, `${createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}.json`);

async function readState(path: string): Promise<State> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<State>;
    if (value.v === 1 && Array.isArray(value.components)) {
      return { v: 1, components: value.components.filter(item => typeof item === 'string').slice(0, maxComponents), reminded: value.reminded === true };
    }
  } catch {
    // Missing or damaged state starts fresh.
  }
  return { v: 1, components: [], reminded: false };
}

export async function recordUse(event: HookEvent, dir: string): Promise<void> {
  if (!event.components.length || !(await ensureDir(dir))) return;
  const path = statePath(dir, event.sessionId);
  const state = await readState(path);
  const components = [...new Set([...state.components, ...event.components])].slice(0, maxComponents);
  if (components.length !== state.components.length) await writeReplace(path, JSON.stringify({ ...state, components }));
}

function message(components: string[], format: HookEvent['format']): string {
  const names = components.length > 3 ? `${components.slice(0, 3).join(', ')} and ${components.length - 3} more` : components.join(', ');
  const command = format === 'claude' ? '/agent-learnings:capture-learning' : 'the capture-learning skill';
  return `agent-learnings: this session used ${names}. If something worked well or could be better, run ${command} to record it.`;
}

// Returns the session's components the first time it is called for a session that used any, then nothing.
export async function claimReminder(event: HookEvent, dir: string, now = Date.now()): Promise<string[] | undefined> {
  if (!(await ensureDir(dir))) return undefined;
  const path = statePath(dir, event.sessionId);
  const state = await readState(path);
  await cleanupState(dir, now);
  if (state.reminded || !state.components.length) return undefined;
  await writeReplace(path, JSON.stringify({ ...state, reminded: true }));
  return state.components;
}

export async function cleanupState(dir: string, now = Date.now(), maxAgeMs = dayMs): Promise<number> {
  let removed = 0;
  let files: string[];
  try { files = await readdir(dir); } catch { return 0; }
  for (const file of files.filter(name => stateFile.test(name)).slice(0, 200)) {
    try {
      if (now - (await stat(join(dir, file))).mtimeMs > maxAgeMs) {
        await unlink(join(dir, file));
        removed++;
      }
    } catch {
      // Another hook may have removed it.
    }
  }
  return removed;
}

async function settings(env: NodeJS.ProcessEnv, cwd: string | undefined): Promise<{ reminders: boolean; mode: Mode }> {
  const fromEnv = { reminders: envReminders(env), mode: envMode(env) };
  if ((fromEnv.reminders !== undefined && fromEnv.mode !== undefined) || !cwd) {
    return { reminders: fromEnv.reminders ?? false, mode: fromEnv.mode ?? 'manual' };
  }
  try {
    const root = await findProjectRoot(cwd);
    return { reminders: remindersEnabled(env, await getReminders(root)), mode: effectiveMode(env, await getMode(root)) };
  } catch {
    return { reminders: fromEnv.reminders ?? false, mode: fromEnv.mode ?? 'manual' };
  }
}

function autoCommand(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_PLUGIN_ROOT ? `node "${join(env.CLAUDE_PLUGIN_ROOT, 'dist', 'cli.js')}"` : 'agent-learnings';
}

// Hook entry point. It never throws and returns '' when there is nothing to print, so it cannot break the host agent.
export async function runHook(spec: string, raw: string, options: HookOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  try {
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return ''; }
    const event = adaptHook(spec, payload);
    if (!event) return '';
    const dir = options.stateDir ?? stateDir(env);
    if (event.action === 'end') {
      await unlink(statePath(dir, event.sessionId)).catch(() => {});
      await cleanupState(dir, options.now);
      return '';
    }
    const { reminders, mode } = await settings(env, event.cwd);
    if (!reminders && mode !== 'auto') return '';
    if (event.action === 'use') {
      await recordUse(event, dir);
      return '';
    }
    // Never ask twice in a row: the agent is already working on a previous Stop hook request.
    if (mode === 'auto' && event.continued) return '';
    const components = await claimReminder(event, dir, options.now);
    if (!components) return '';
    if (mode === 'auto') {
      const reason = autoCaptureInstructions(autoCommand(env), components);
      return event.format === 'claude'
        ? JSON.stringify({ decision: 'block', reason, systemMessage: 'agent-learnings auto mode: checking this session for learnings worth saving' })
        : reason;
    }
    const text = message(components, event.format);
    return event.format === 'claude' ? JSON.stringify({ systemMessage: text }) : text;
  } catch (error) {
    if (env.AGENT_LEARNINGS_DEBUG === '1') process.stderr.write(`agent-learnings hook: ${(error as Error).message}\n`);
    return '';
  }
}
