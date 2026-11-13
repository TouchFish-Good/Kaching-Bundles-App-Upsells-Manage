import type { Metric } from './state.ts';

export type Role = 'Owner';
export type Admin = { id: string; email: string; role: Role; csrfToken: string; environment: string };
export type StoreSubscription = { state: 'unknown' | 'trial' | 'active' | 'grace' | 'review_pending' | 'inactive'; plan: string | null; validUntil: number | null; graceUntil: number | null; lastVerifiedAt: number | null };
export type Store = { storeId: string; handle: string; scope: string; status: string; installedAt: string; updatedAt: string; subscription: StoreSubscription | null; installations?: { installedAt: string; uninstalledAt: string | null }[] };
export type ErrorEvent = { id: number; storeId: string | null; handle?: string | null; kind: string; severity: string; code: string; traceId: string | null; source?: 'worker' | 'browser'; operation?: string; route?: string | null; method?: string | null; httpStatus?: number | null; message?: string | null; relatedTraceId?: string | null; occurredAt: string };
export type ApplicationRequestEvent = { id: string; traceId: string; storeId: string | null; handle: string | null; route: string; method: string; httpStatus: number; durationMs: number; outcome: 'success' | 'client_error' | 'server_error'; occurredAt: string };
export type AuditEvent = { id: string; actorId: string | null; action: string; targetId: string | null; result: string; environment: string; occurredAt: string; requestId: string };
export type List<T> = { items: T[]; total?: number };
export type Overview = { installedStoreCount: Metric; activeBundleCount: Metric; errorCount: Metric };
export type FeedbackStatus = 'pending' | 'approved' | 'in_progress' | 'released' | 'rejected';
export type FeedbackDisplayStatus = FeedbackStatus | 'rejected_hidden' | 'withdrawn';
export type Feedback = {
  id: string; storeId: string; handle: string; isAnonymous: boolean; title: string; excerpt: string; status: FeedbackStatus;
  displayStatus: FeedbackDisplayStatus; hiddenReason: string | null; voteCount: number; commentCount: number; createdAt: string; updatedAt: string; hasOfficialReply: boolean;
};
export type FeedbackDetail = Feedback & {
  content: string; hiddenAt: string | null; hiddenBy: string | null;
  statusHistory: { id: string; previousStatus: FeedbackStatus | null; nextStatus: FeedbackStatus; note: string | null; createdAt: string }[];
  comments: { id: string; storeId: string; authorHandle: string; isAnonymous: boolean; content: string; createdAt: string; isDeleted: boolean; deletedAt: string | null; deletedBy: string | null; deletionReason: string | null }[];
  replies: { id: string; authorLabel: '多件折扣'; isOfficial: true; content: string; createdAt: string }[];
};
export type FeedbackList = { items: Feedback[]; total: number; offset: number };
export type FeedbackComment = { id: string; feedbackId: string; feedbackTitle: string; feedbackStatus: FeedbackStatus; storeId: string; authorHandle: string; isAnonymous: boolean; content: string; createdAt: string; isDeleted: boolean; deletedAt: string | null; deletedBy: string | null; deletionReason: string | null };
export type CampaignStatus = 'draft' | 'active' | 'expired';
export type Campaign = {
  id: string; name: string; status: CampaignStatus; revision: number; startsAt: string | null; endsAt: string | null; pauseReason: string | null; updatedAt: string;
  discountName?: string; combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
  storeId?: string; shopHandle?: string; platformDiscountState: 'active' | 'paused' | 'removed' | null;
  scope: { kind: 'all' | 'products' | 'collections'; productIds?: string[]; collectionIds?: string[]; resolvedProductIds?: string[]; excludedProductIds: string[] };
  tiers: { tierId: string; displayOrder: number; quantity: number; discountType: string; discountValue?: number; discountTypeDisplay?: string; discountValueDisplay?: string; recommended?: boolean; label?: string; subtitle?: string; tag?: string; marketOverrides?: { marketId: string; marketName: string | null; mode: 'auto_convert' | 'specified_amount'; currencyCode?: string; amountMinor?: number }[] }[];
};
export type DiagnosticOutcome = 'success' | 'failure' | 'uncertain';
export type Diagnostic = {
  id: string; traceId: string; workerName: string; storeId: string | null; shopHandle: string | null; campaignId: string | null;
  eventType: string; outcome: DiagnosticOutcome; upstreamService: string | null; upstreamPath: string | null; upstreamStatus: number | null;
  upstreamRequestId: string | null; upstreamResponseCode: string | null; upstreamResponseMessage: string | null;
  upstreamResponseBody: string | null;
  errorCode: string | null; durationMs: number | null; occurredAt: string;
};
export type GdprDeletionTask = { webhookId: string; kind: 'customer_redact' | 'merchant_redact'; storeId: string; handle: string | null; customerDigest: string | null; state: 'pending' | 'running' | 'completed' | 'retrying' | 'failed'; receivedAt: number; deadlineAt: number; completedAt: number | null; attempts: number; nextAttemptAt: number; lastErrorCode: string | null };

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details: unknown = null) { super(code); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/admin-api/v1${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.error?.code || 'REQUEST_FAILED', body);
  return body.data as T;
}
