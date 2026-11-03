export declare function campaignStatus(input: { status: string; diagnosticOutcome?: string }): { label: string; tone: string };
export declare function canPauseCampaign(input: { status: string }): boolean;
export declare function coverageConflictNotice(conflicts: unknown): string;
