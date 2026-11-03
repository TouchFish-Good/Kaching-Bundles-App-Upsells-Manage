export function campaignStatus({ status, diagnosticOutcome }) {
  const labels = { draft: '草稿', active: '启用', scheduled: '计划中', paused: '已暂停', ended: '已结束' };
  if (diagnosticOutcome === 'uncertain' && (status === 'active' || status === 'scheduled')) return { label: labels[status], tone: 'warning' };
  return { label: labels[status] ?? '未知', tone: status === 'active' ? 'success' : status === 'paused' || status === 'ended' ? 'muted' : 'info' };
}

export function canPauseCampaign({ status }) {
  return status === 'active' || status === 'scheduled';
}

export function coverageConflictNotice(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return '活动覆盖范围冲突，未执行平台操作。';
  const conflict = conflicts[0];
  const kind = conflict?.overlap?.type === 'collections' ? '指定分类' : '指定商品';
  const names = Array.isArray(conflict?.overlap?.names) && conflict.overlap.names.length ? conflict.overlap.names.join('、') : '重叠项';
  return `活动范围冲突：与「${conflict?.campaignName || '现有活动'}」的${kind}重叠（${names}）。未执行平台操作。`;
}
