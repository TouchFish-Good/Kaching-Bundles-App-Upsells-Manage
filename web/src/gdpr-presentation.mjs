export function gdprTaskStoreLabel(task) {
  if (task.kind === 'customer_redact') return task.customerDigest ? `客户摘要 · ${task.customerDigest.slice(0, 12)}` : `客户摘要 · ${task.storeId}`;
  return `${task.handle || '未知商家'} · 店铺 ID ${task.storeId}`;
}

export function canRetryGdprTask(task) {
  return ['pending', 'retrying', 'failed'].includes(task.state);
}
