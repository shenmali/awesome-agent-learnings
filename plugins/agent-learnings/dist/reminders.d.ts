export type HookAction = 'use' | 'stop' | 'end';
export interface HookEvent {
    action: HookAction;
    sessionId: string;
    components: string[];
    cwd?: string;
    format: 'text' | 'claude';
}
export interface HookOptions {
    env?: NodeJS.ProcessEnv;
    stateDir?: string;
    now?: number;
}
export declare const claudeEvents: string[];
export declare function adaptHook(spec: string, payload: unknown): HookEvent | undefined;
export declare function envReminders(env: NodeJS.ProcessEnv): boolean | undefined;
export declare function remindersEnabled(env: NodeJS.ProcessEnv, configured: boolean | undefined): boolean;
export declare function stateDir(env: NodeJS.ProcessEnv): string;
export declare function recordUse(event: HookEvent, dir: string): Promise<void>;
export declare function takeReminder(event: HookEvent, dir: string, now?: number): Promise<string | undefined>;
export declare function cleanupState(dir: string, now?: number, maxAgeMs?: number): Promise<number>;
export declare function runHook(spec: string, raw: string, options?: HookOptions): Promise<string>;
