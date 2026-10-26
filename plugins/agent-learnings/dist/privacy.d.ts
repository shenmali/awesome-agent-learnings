export type Severity = 'block' | 'warn';
export interface Finding {
    severity: Severity;
    label: string;
    start: number;
    end: number;
    hint: string;
    field?: string;
}
export declare function scanSensitive(text: string): Finding[];
export declare function scanFields(fields: Record<string, string | undefined>): Finding[];
export declare function describeFinding(item: Finding): string;
export declare function redact(text: string): string;
export declare function assertNoSecrets(fields: Record<string, string | undefined>, action: string): void;
