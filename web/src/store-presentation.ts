import type { StoreSubscription } from './api';

const stateLabels: Record<StoreSubscription['state'], string> = {
  unknown: '状态未知',
  trial: '试用中',
  active: '生效中',
  grace: '宽限期',
  review_pending: '待核验',
  inactive: '未订阅',
};

export function storeSubscriptionPresentation(subscription: StoreSubscription | null): { stateLabel: string; planLabel: string; expiryAt: number | null; expiryLabel: string } {
  if (!subscription) return { stateLabel: '未核验', planLabel: '—', expiryAt: null, expiryLabel: '到期时间' };
  const expiryAt = subscription.graceUntil ?? subscription.validUntil;
  return {
    stateLabel: stateLabels[subscription.state],
    planLabel: subscription.plan === 'ultra' ? 'Ultra' : subscription.plan || '—',
    expiryAt,
    expiryLabel: subscription.graceUntil !== null ? '宽限至' : '到期时间',
  };
}
