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

export function campaignTierDisplay(tier) {
  const fallbackLabels = {
    none: '原价',
    percentage: '百分比折扣',
    fixed_amount: '每件固定减免',
    fixed_price: '每件固定价格',
    bundle_fixed_amount: '整单固定减免',
    bundle_fixed_price: '整单固定价格',
  };
  const type = typeof tier?.discountTypeDisplay === 'string' ? tier.discountTypeDisplay : fallbackLabels[tier?.discountType] ?? tier?.discountType ?? '—';
  if (typeof tier?.discountValueDisplay === 'string') return { type, value: tier.discountValueDisplay };
  if (tier?.discountType === 'none' || tier?.discountValue === undefined) return { type, value: '—' };
  return { type, value: tier.discountType === 'percentage' ? `${tier.discountValue / 100}%` : String(tier.discountValue) };
}

export function campaignCombinationDisplay(combinesWith) {
  return [
    { label: '订单折扣', value: combinesWith?.orderDiscounts ? '可叠加' : '不叠加' },
    { label: '商品折扣', value: combinesWith?.productDiscounts ? '可叠加' : '不叠加' },
    { label: '运费折扣', value: combinesWith?.shippingDiscounts ? '可叠加' : '不叠加' },
  ];
}

export function campaignListPath() {
  return '/campaigns';
}

function formatMarketAmount(amountMinor, currencyCode) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || typeof currencyCode !== 'string' || !/^[A-Z]{3}$/.test(currencyCode)) return String(amountMinor ?? '—');
  try {
    const decimals = new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) return String(amountMinor);
    if (!decimals) return String(amountMinor);
    const scale = 10 ** decimals;
    return `${Math.floor(amountMinor / scale)}.${String(amountMinor % scale).padStart(decimals, '0')}`;
  } catch { return String(amountMinor); }
}

export function specifiedMarketAmountDisplays(marketOverrides) {
  if (!Array.isArray(marketOverrides)) return [];
  return marketOverrides
    .filter((override) => override?.mode === 'specified_amount')
    .map((override) => ({
      marketName: override.marketName || '未知市场',
      marketId: override.marketId,
      value: `${override.currencyCode || '—'} ${formatMarketAmount(override.amountMinor, override.currencyCode)}`,
    }));
}

export function formatDiagnosticResponseBody(body) {
  if (typeof body !== 'string') return null;
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return null; }
}

export function canViewDiagnosticResponse(body) {
  return formatDiagnosticResponseBody(body) !== null;
}

export function refreshLabel(refreshing) {
  return refreshing ? '刷新中' : '刷新';
}
