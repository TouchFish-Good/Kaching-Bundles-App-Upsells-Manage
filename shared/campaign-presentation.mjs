export function campaignStatus({ status, diagnosticOutcome }) {
  const labels = { draft: '草稿', active: '启用', scheduled: '计划中', paused: '已暂停', ended: '已结束' };
  if (diagnosticOutcome === 'uncertain' && (status === 'active' || status === 'scheduled')) return { label: labels[status], tone: 'warning' };
  return { label: labels[status] ?? '未知', tone: status === 'active' ? 'success' : status === 'paused' || status === 'ended' ? 'muted' : 'info' };
}

export function canPauseCampaign({ status }) {
  return status === 'active' || status === 'scheduled';
}
