export declare const installPlatforms: readonly ["all", "claude", "codex", "opencode"];
export type InstallPlatform = typeof installPlatforms[number];
export interface InstallOptions {
    scope: 'project' | 'user';
    cwd: string;
    home?: string;
    platform?: InstallPlatform;
}
export declare function initSkills(options: InstallOptions): Promise<string[]>;
