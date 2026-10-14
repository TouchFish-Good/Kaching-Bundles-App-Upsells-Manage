export type SourceStatus = 'current' | 'stale' | 'unavailable' | 'unsupported';
export type Metric = { value: number | null; asOf: string | null; sourceStatus: SourceStatus };

export function sourceMessage(status: SourceStatus): string {
  return { current: '已更新', stale: '数据延迟', unavailable: '暂不可用', unsupported: '未接入' }[status];
}

export function metricDisplay(metric: Metric): string {
  if (metric.value === null) return metric.sourceStatus === 'unsupported' || metric.sourceStatus === 'unavailable' ? '未接入' : '暂不可用';
  return new Intl.NumberFormat('zh-CN').format(metric.value);
}

export function absoluteTime(value: string | null | undefined): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date);
}
