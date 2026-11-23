const stateLabels = {
  unknown: '状态未知',
  trial: '试用中',
  active: '生效中',
  grace: '宽限期',
  review_pending: '待核验',
  inactive: '未订阅',
  unactive: '未生效',
  pending: '待生效',
  cancelled: '已取消',
  expired: '已过期',
  scheduled: '待开始',
};

export const storeStatusUpdatedLabel = '安装状态更新时间';

export function storeUrl(handle) {
  return `https://${encodeURIComponent(handle)}.myshopline.com`;
}

// Expired includes both trial and paid subscriptions; unverified has no confirmed record.
export const storeSubscriptionFilters = [
  { value: 'all', label: '全部' },
  ...['trial', 'active', 'grace', 'expired', 'cancelled', 'unactive', 'pending', 'scheduled', 'review_pending', 'inactive', 'unknown'].map(value => ({
    value, label: stateLabels[value],
  })),
  { value: 'unverified', label: '未核验' },
];

export function storeSubscriptionPresentation(subscription) {
  if (!subscription) return { stateLabel: '未核验', planLabel: '—', expiryAt: null, expiryLabel: '到期时间' };
  const expiryAt = subscription.graceUntil ?? subscription.validUntil;
  return {
    stateLabel: `${subscription.isTrial && ['unactive', 'pending', 'cancelled', 'expired', 'scheduled'].includes(subscription.state) ? '试用' : ''}${stateLabels[subscription.state] || stateLabels.unknown}`,
    planLabel: subscription.plan === 'ultra' ? 'Ultra' : subscription.plan || '—',
    expiryAt,
    expiryLabel: subscription.graceUntil !== null ? '宽限至' : '到期时间',
  };
}
