export type FeedbackPresentationInput = { status: string; displayStatus: string };
export declare function displayStatus(feedback: FeedbackPresentationInput): { label: string; tone: 'muted' | 'success' | 'info' | 'danger' };
export declare function canChangeStatus(feedback: Pick<FeedbackPresentationInput, 'displayStatus'>): boolean;
export declare const commentManagementHeaders: readonly ['评论', '商家', '是否匿名', '状态', '创建时间', '所属建议', '操作'];
export declare function commentSourceLabel(comment: { feedbackTitle: string }): string;
