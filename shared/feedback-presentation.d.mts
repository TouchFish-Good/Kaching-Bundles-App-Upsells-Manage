export type FeedbackPresentationInput = { status: string; displayStatus: string };
export declare function displayStatus(feedback: FeedbackPresentationInput): { label: string; tone: 'muted' | 'success' | 'info' | 'danger' };
export declare function canChangeStatus(feedback: Pick<FeedbackPresentationInput, 'displayStatus'>): boolean;
