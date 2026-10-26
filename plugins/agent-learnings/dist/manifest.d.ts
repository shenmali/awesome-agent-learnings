import { type Category, type Kind } from './store.js';
export interface Manifest {
    accepting: boolean;
    kinds?: Kind[];
    categories?: Category[];
    titlePrefix: string;
    feedbackUrl?: string;
}
export type Policy = {
    status: 'accepted';
} | {
    status: 'blocked';
    reason: string;
} | {
    status: 'redirect';
    url: string;
};
export declare const manifestPath = ".github/agent-learnings.json";
export declare const defaultManifest: Manifest;
export declare function parseManifest(text: string): Manifest;
export declare function policyFor(manifest: Manifest, kind: Kind, category: Category): Policy;
