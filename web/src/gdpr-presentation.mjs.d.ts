import type { GdprDeletionTask } from './api';

export function gdprTaskStoreLabel(task: Pick<GdprDeletionTask, 'kind' | 'state' | 'handle' | 'storeId' | 'customerDigest'>): string;
export function canRetryGdprTask(task: Pick<GdprDeletionTask, 'state'>): boolean;
