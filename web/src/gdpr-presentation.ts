import type { GdprDeletionTask } from './api';

export function gdprTaskStoreLabel(task: Pick<GdprDeletionTask, 'kind' | 'state' | 'handle' | 'storeId' | 'customerDigest'>): string {
  if (task.state === 'completed') return `已清除 · ${task.storeId}`;
  if (task.kind === 'customer_redact') return task.customerDigest ? `客户摘要 · ${task.customerDigest.slice(0, 12)}` : `客户摘要 · ${task.storeId}`;
  return task.handle || task.storeId;
}

export function canRetryGdprTask(task: Pick<GdprDeletionTask, 'state'>): boolean {
  return ['pending', 'retrying', 'failed'].includes(task.state);
}
