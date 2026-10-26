export declare const skillNames: readonly ["capture-learning", "share-learning", "manage-learnings"];
export type SkillName = typeof skillNames[number];
export type SkillFlavor = 'plugin' | 'claude' | 'agents';
export declare const pluginCommand = "node \"${CLAUDE_PLUGIN_ROOT}/dist/cli.js\"";
export declare function renderSkill(name: SkillName, command: string, flavor: SkillFlavor): string;
export declare function renderOpenaiYaml(name: SkillName): string;
export declare function renderOpencodeCommand(name: SkillName, command: string): string;
export declare function pluginFiles(): Record<string, string>;
