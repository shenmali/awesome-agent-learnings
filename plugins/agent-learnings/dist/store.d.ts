export declare const platforms: readonly ["codex", "claude", "opencode"];
export type Platform = typeof platforms[number];
export declare const kinds: readonly ["skill", "agent", "hook", "command", "mcp", "plugin", "prompt", "other"];
export type Kind = typeof kinds[number];
export declare const categories: readonly ["improvement", "bug", "regression", "praise"];
export type Category = typeof categories[number];
export type IssueStatus = 'OPEN' | 'CLOSED';
export declare const modes: readonly ["manual", "auto"];
export type Mode = typeof modes[number];
export interface LearningInput {
    target: string;
    platform: Platform;
    version?: string;
    kind?: Kind;
    component?: string;
    category?: Category;
    situation: string;
    change: string;
    result: string;
}
export interface Learning extends LearningInput {
    id: string;
    createdAt: string;
    origin?: 'auto';
    issueUrl?: string;
    commentUrl?: string;
    issueStatus?: IssueStatus;
}
export declare function writeReplace(path: string, content: string): Promise<void>;
export declare function normalizeInput(value: unknown): LearningInput;
export declare const effectiveKind: (item: LearningInput) => Kind;
export declare const effectiveCategory: (item: LearningInput) => Category;
export declare function learningFields(item: LearningInput): Record<string, string | undefined>;
export declare function normalizeRepo(value: string): string;
export declare function addTarget(root: string, id: string, repository: string): Promise<void>;
export declare function getReminders(root: string): Promise<boolean | undefined>;
export declare function setReminders(root: string, enabled: boolean): Promise<void>;
export declare function getMode(root: string): Promise<Mode | undefined>;
export declare function setMode(root: string, mode: Mode): Promise<void>;
export declare function getTarget(root: string, id: string): Promise<{
    repo: string;
} | undefined>;
export declare function listTargets(root: string): Promise<Record<string, {
    repo: string;
}>>;
export declare function addLearning(root: string, input: unknown, options?: {
    auto?: boolean;
}): Promise<Learning>;
export declare function getLearning(root: string, id: string): Promise<Learning>;
export declare function listLearnings(root: string): Promise<Learning[]>;
export declare function withLearningLock<T>(root: string, id: string, action: () => Promise<T>): Promise<T>;
export declare function updateLearning(root: string, id: string, changes: Partial<Learning>): Promise<Learning>;
export declare function editLearning(root: string, id: string, patch: unknown): Promise<{
    learning: Learning;
    changed: boolean;
}>;
export declare function removeLearning(root: string, id: string): Promise<Learning>;
