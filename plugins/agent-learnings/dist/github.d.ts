import { type Manifest, type Policy } from './manifest.js';
import { type Finding } from './privacy.js';
import { type IssueStatus, type Learning } from './store.js';
export interface RunResult {
    status: number;
    stdout: string;
    stderr: string;
}
export type GhRunner = (command: string, args: string[]) => Promise<RunResult>;
export declare const runGh: GhRunner;
export interface IssueDraft {
    repo: string;
    title: string;
    body: string;
    newIssueUrl: string;
}
export interface ManifestResult {
    source: 'repository' | 'default' | 'unchecked' | 'invalid' | 'error';
    manifest: Manifest;
    note?: string;
}
export interface RelatedIssue {
    number: number;
    title: string;
    url: string;
    state: IssueStatus;
}
export interface Related {
    issues: RelatedIssue[];
    skipped?: string;
}
export interface SharePreview {
    draft: IssueDraft;
    manifest: ManifestResult;
    policy: Policy;
    findings: Finding[];
    related: Related;
    sharedAs?: string;
}
export declare function parseIssueUrl(repo: string, value: string, allowComment?: boolean): {
    issueUrl: string;
    commentUrl?: string;
};
export declare function fetchManifest(repo: string, runner?: GhRunner): Promise<ManifestResult>;
export declare function describeManifest(repo: string, result: ManifestResult): string;
export declare function issueTitle(learning: Learning, prefix: string): string;
export declare function prepareIssue(root: string, id: string, manifest?: Manifest): Promise<IssueDraft>;
export declare function relatedQuery(learning: Learning, manifest: Manifest): string;
export declare function findRelated(repo: string, query: string, runner?: GhRunner): Promise<Related>;
export declare function previewShare(root: string, id: string, runner?: GhRunner): Promise<SharePreview>;
export declare function publishIssue(root: string, id: string, runner?: GhRunner): Promise<string>;
export declare function commentIssue(root: string, id: string, value: string, runner?: GhRunner): Promise<string>;
export declare function attachIssue(root: string, id: string, value: string): Promise<string>;
export declare function refreshIssue(root: string, id: string, runner?: GhRunner): Promise<'OPEN' | 'CLOSED'>;
