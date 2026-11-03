import type { Metric } from './state.ts';

export type Role = 'Owner';
export type Admin = { id: string; email: string; role: Role; csrfToken: string; environment: string };
export type Store = { storeId: string; handle: string; scope: string; status: string; installedAt: string; updatedAt: string; installations?: { installedAt: string; uninstalledAt: string | null }[] };
export type ErrorEvent = { id: number; storeId: string | null; kind: string; severity: string; code: string; traceId: string | null; occurredAt: string };
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
export type CampaignStatus = 'draft' | 'active' | 'scheduled' | 'paused' | 'ended';
export type Campaign = {
  id: string; name: string; status: CampaignStatus; revision: number; startsAt: string | null; endsAt: string | null; pauseReason: string | null; updatedAt: string;
  scope: { kind: 'all' | 'products' | 'collections'; productIds?: string[]; collectionIds?: string[]; resolvedProductIds?: string[]; excludedProductIds: string[] };
  tiers: { tierId: string; displayOrder: number; quantity: number; discountType: string; discountValue?: number; recommended?: boolean; label?: string; subtitle?: string; tag?: string }[];
};
export type DiagnosticOutcome = 'success' | 'failure' | 'uncertain';
export type Diagnostic = {
  id: string; traceId: string; workerName: string; storeId: string | null; shopHandle: string | null; campaignId: string | null;
  eventType: string; outcome: DiagnosticOutcome; upstreamService: string | null; upstreamPath: string | null; upstreamStatus: number | null;
  upstreamRequestId: string | null; errorCode: string | null; durationMs: number | null; occurredAt: string;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/admin-api/v1${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.error?.code || 'REQUEST_FAILED');
  return body.data as T;
}
