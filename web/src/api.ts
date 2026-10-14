import type { Metric } from './state.ts';

export type Role = 'Viewer' | 'Operator' | 'Owner';
export type Admin = { id: string; email: string; role: Role; csrfToken: string; environment: string };
export type Store = { storeId: string; handle: string; scope: string; status: string; installedAt: string; updatedAt: string; installations?: { installedAt: string; uninstalledAt: string | null }[] };
export type ErrorEvent = { id: number; storeId: string | null; kind: string; severity: string; code: string; traceId: string | null; occurredAt: string };
export type AuditEvent = { id: string; actorId: string | null; action: string; targetId: string | null; result: string; environment: string; occurredAt: string; requestId: string };
export type AdminUser = { id: string; email: string; role: Role; status: string; createdAt: string; disabledAt: string | null };
export type List<T> = { items: T[]; total?: number };
export type Overview = { installedStoreCount: Metric; activeBundleCount: Metric; errorCount: Metric };

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
