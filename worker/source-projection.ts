type SourceResult = { status: number; body: unknown };
type Projection = { status: number; body: Record<string, unknown> };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function optionalText(value: unknown): value is string | null {
  return value === null || text(value);
}

function optionalInteger(value: unknown): value is number | null {
  return value === null || Number.isInteger(value);
}

function rejectSensitive(value: unknown): void {
  if (typeof value === 'string' && /(?:bearer\s+\S+|(?:access|refresh)[_ -]?token\s*[:=]|authorization\s*[:=]|cookie\s*[:=]|password\s*[:=]|secret\s*[:=])/i.test(value)) throw new Error('INVALID_SOURCE');
  if (Array.isArray(value)) { value.forEach(rejectSensitive); return; }
  if (!record(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:access[_ -]?token|refresh[_ -]?token|authorization|cookie|password|secret|credential|api[_ -]?key|platformDiscountId|graphql|queryText)/i.test(key)) throw new Error('INVALID_SOURCE');
    rejectSensitive(child);
  }
}

function diagnosticResponseBody(value: unknown): string | null {
  if (value === null) return null;
  if (!text(value) || value.length > 8192) throw new Error('INVALID_SOURCE');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('INVALID_SOURCE'); }
  rejectSensitive(parsed);
  return value;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => !text(item))) throw new Error('INVALID_SOURCE');
  return value;
}

function storeSummary(value: unknown): Record<string, string> {
  if (!record(value) || !text(value.storeId) || !text(value.handle) || !text(value.scope) || !text(value.status) ||
    !['installed', 'uninstalled'].includes(value.status) || !text(value.installedAt) || !text(value.updatedAt)) {
    throw new Error('INVALID_SOURCE');
  }
  return { storeId: value.storeId, handle: value.handle, scope: value.scope, status: value.status, installedAt: value.installedAt, updatedAt: value.updatedAt };
}

function storeDetail(value: unknown): Record<string, unknown> {
  if (!record(value) || !Array.isArray(value.installations)) throw new Error('INVALID_SOURCE');
  return {
    ...storeSummary(value),
    installations: value.installations.map((cycle) => {
      if (!record(cycle) || !text(cycle.installedAt) || !optionalText(cycle.uninstalledAt)) throw new Error('INVALID_SOURCE');
      return { installedAt: cycle.installedAt, uninstalledAt: cycle.uninstalledAt };
    }),
  };
}

function metric(value: unknown): Record<string, string | number | null> {
  if (!record(value) || !['current', 'unavailable'].includes(String(value.sourceStatus)) ||
    !(typeof value.value === 'number' || value.value === null) || !optionalText(value.asOf)) throw new Error('INVALID_SOURCE');
  return { value: value.value, asOf: value.asOf, sourceStatus: value.sourceStatus as string };
}

function campaignConflicts(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('INVALID_SOURCE');
  return value.map((conflict) => {
    if (!record(conflict) || !text(conflict.campaignId) || !text(conflict.campaignName) || !text(conflict.scopeKind) ||
      !['products', 'collections'].includes(conflict.scopeKind) || !record(conflict.overlap) || !text(conflict.overlap.type) ||
      !['products', 'collections'].includes(conflict.overlap.type)) throw new Error('INVALID_SOURCE');
    return { campaignId: conflict.campaignId, campaignName: conflict.campaignName, scopeKind: conflict.scopeKind,
      overlap: { type: conflict.overlap.type, ids: textList(conflict.overlap.ids), names: textList(conflict.overlap.names) } };
  });
}

function sourceError(status: number, body: unknown): Projection {
  if (status === 404) return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
  if (status === 409 && record(body) && record(body.error) && body.error.code === 'CAMPAIGN_SCOPE_CONFLICT') {
    return { status: 409, body: { error: { code: 'CAMPAIGN_SCOPE_CONFLICT' }, conflicts: campaignConflicts(body.conflicts) } };
  }
  if (status === 409) return { status: 409, body: { error: { code: 'CAMPAIGN_CONFLICT' } } };
  if (status === 422) return { status: 422, body: { error: { code: 'INVALID_SOURCE_QUERY' } } };
  return { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } };
}

const feedbackStatuses = ['pending', 'approved', 'in_progress', 'released', 'rejected'];
const feedbackDisplayStatuses = [...feedbackStatuses, 'rejected_hidden', 'withdrawn'];

function feedbackSummary(value: unknown): Record<string, unknown> {
  if (!record(value) || !text(value.id) || !text(value.storeId) || !text(value.handle) || typeof value.isAnonymous !== 'boolean' ||
    !text(value.title) || !text(value.excerpt) || !text(value.status) || !feedbackStatuses.includes(value.status) ||
    !text(value.displayStatus) || !feedbackDisplayStatuses.includes(value.displayStatus) || !optionalText(value.hiddenReason) ||
    !Number.isInteger(value.voteCount) || !Number.isInteger(value.commentCount) || !text(value.createdAt) || !text(value.updatedAt) || typeof value.hasOfficialReply !== 'boolean') throw new Error('INVALID_SOURCE');
  return {
    id: value.id, storeId: value.storeId, handle: value.handle, isAnonymous: value.isAnonymous, title: value.title, excerpt: value.excerpt,
    status: value.status, displayStatus: value.displayStatus, hiddenReason: value.hiddenReason, voteCount: value.voteCount,
    commentCount: value.commentCount, createdAt: value.createdAt, updatedAt: value.updatedAt, hasOfficialReply: value.hasOfficialReply,
  };
}

function feedbackDetail(value: unknown): Record<string, unknown> {
  const summary = feedbackSummary(value);
  if (!record(value) || !text(value.content) || !optionalText(value.hiddenAt) || !optionalText(value.hiddenBy) || !Array.isArray(value.statusHistory) || !Array.isArray(value.comments) || !Array.isArray(value.replies)) throw new Error('INVALID_SOURCE');
  return {
    ...summary,
    content: value.content,
    hiddenAt: value.hiddenAt,
    hiddenBy: value.hiddenBy,
    statusHistory: value.statusHistory.map((entry) => {
      if (!record(entry) || !text(entry.id) || !(entry.previousStatus === null || (text(entry.previousStatus) && feedbackStatuses.includes(entry.previousStatus))) || !text(entry.nextStatus) || !feedbackStatuses.includes(entry.nextStatus) || !optionalText(entry.note) || !text(entry.createdAt)) throw new Error('INVALID_SOURCE');
      return { id: entry.id, previousStatus: entry.previousStatus, nextStatus: entry.nextStatus, note: entry.note, createdAt: entry.createdAt };
    }),
    comments: value.comments.map((comment) => {
      if (!record(comment) || !text(comment.id) || !text(comment.storeId) || !text(comment.authorHandle) || typeof comment.isAnonymous !== 'boolean' || !text(comment.content) || !text(comment.createdAt) || typeof comment.isDeleted !== 'boolean' || !optionalText(comment.deletedAt) || !optionalText(comment.deletedBy) || !optionalText(comment.deletionReason)) throw new Error('INVALID_SOURCE');
      return { id: comment.id, storeId: comment.storeId, authorHandle: comment.authorHandle, isAnonymous: comment.isAnonymous, content: comment.content, createdAt: comment.createdAt, isDeleted: comment.isDeleted, deletedAt: comment.deletedAt, deletedBy: comment.deletedBy, deletionReason: comment.deletionReason };
    }),
    replies: value.replies.map((reply) => {
      if (!record(reply) || !text(reply.id) || reply.authorLabel !== '多件折扣' || reply.isOfficial !== true || !text(reply.content) || !text(reply.createdAt)) throw new Error('INVALID_SOURCE');
      return { id: reply.id, authorLabel: reply.authorLabel, isOfficial: true, content: reply.content, createdAt: reply.createdAt };
    }),
  };
}

function feedbackComment(value: unknown): Record<string, unknown> {
  if (!record(value) || !text(value.id) || !text(value.feedbackId) || !text(value.feedbackTitle) || !text(value.feedbackStatus) || !feedbackStatuses.includes(value.feedbackStatus) ||
    !text(value.storeId) || !text(value.authorHandle) || typeof value.isAnonymous !== 'boolean' || !text(value.content) || !text(value.createdAt) || typeof value.isDeleted !== 'boolean' ||
    !optionalText(value.deletedAt) || !optionalText(value.deletedBy) || !optionalText(value.deletionReason)) throw new Error('INVALID_SOURCE');
  return { id: value.id, feedbackId: value.feedbackId, feedbackTitle: value.feedbackTitle, feedbackStatus: value.feedbackStatus, storeId: value.storeId,
    authorHandle: value.authorHandle, isAnonymous: value.isAnonymous, content: value.content, createdAt: value.createdAt, isDeleted: value.isDeleted,
    deletedAt: value.deletedAt, deletedBy: value.deletedBy, deletionReason: value.deletionReason };
}

function feedbackWrite(value: unknown): Record<string, unknown> {
  if (!record(value) || !record(value.feedback) || !text(value.feedback.id) || !text(value.feedback.status) || !feedbackStatuses.includes(value.feedback.status)) throw new Error('INVALID_SOURCE');
  return { feedback: { id: value.feedback.id, status: value.feedback.status } };
}

const campaignStatuses = ['draft', 'active', 'expired', 'scheduled', 'paused', 'ended'];
const campaignDiscountTypes = ['none', 'percentage', 'fixed_amount', 'fixed_price', 'bundle_fixed_amount', 'bundle_fixed_price'];
const diagnosticEventTypes = ['shopline_api', 'worker_error', 'campaign_pause', 'campaign_platform_delete', 'campaign_read'];
const diagnosticOutcomes = ['success', 'failure', 'uncertain'];

function campaignScope(value: unknown): Record<string, unknown> {
  if (!record(value) || !text(value.kind) || !['all', 'products', 'collections'].includes(value.kind) || !Array.isArray(value.excludedProductIds)) throw new Error('INVALID_SOURCE');
  const result: Record<string, unknown> = { kind: value.kind, excludedProductIds: textList(value.excludedProductIds) };
  if (value.productIds !== undefined) result.productIds = textList(value.productIds);
  if (value.collectionIds !== undefined) result.collectionIds = textList(value.collectionIds);
  if (value.resolvedProductIds !== undefined) result.resolvedProductIds = textList(value.resolvedProductIds);
  return result;
}

function campaignTier(value: unknown): Record<string, unknown> {
  if (!record(value) || !text(value.tierId) || !Number.isInteger(value.displayOrder) || !Number.isInteger(value.quantity) || Number(value.quantity) < 1 || !text(value.discountType) || !campaignDiscountTypes.includes(value.discountType)) throw new Error('INVALID_SOURCE');
  const result: Record<string, unknown> = { tierId: value.tierId, displayOrder: value.displayOrder, quantity: value.quantity, discountType: value.discountType };
  if (Number.isInteger(value.discountValue)) result.discountValue = value.discountValue;
  if (typeof value.recommended === 'boolean') result.recommended = value.recommended;
  for (const key of ['label', 'subtitle', 'tag']) if (text(value[key])) result[key] = value[key];
  return result;
}

function campaign(value: unknown): Record<string, unknown> {
  if (!record(value) || !text(value.id) || !text(value.name) || !text(value.status) || !campaignStatuses.includes(value.status) || !Number.isInteger(value.revision) || !Array.isArray(value.tiers) || !optionalText(value.startsAt) || !optionalText(value.endsAt) || !optionalText(value.pauseReason) || !text(value.updatedAt)) throw new Error('INVALID_SOURCE');
  if (value.platformDiscountState !== undefined && !(value.platformDiscountState === null || ['active', 'paused', 'removed'].includes(String(value.platformDiscountState)))) throw new Error('INVALID_SOURCE');
  const status = value.status === 'draft' || value.status === 'active' ? value.status : 'expired';
  return {
    id: value.id, name: value.name, status, revision: value.revision,
    scope: campaignScope(value.scope), tiers: value.tiers.map(campaignTier), startsAt: value.startsAt,
    endsAt: value.endsAt, pauseReason: value.pauseReason, updatedAt: value.updatedAt,
    ...(value.storeId !== undefined ? { storeId: text(value.storeId) ? value.storeId : (() => { throw new Error('INVALID_SOURCE'); })() } : {}),
    ...(value.shopHandle !== undefined ? { shopHandle: text(value.shopHandle) ? value.shopHandle : (() => { throw new Error('INVALID_SOURCE'); })() } : {}),
    platformDiscountState: value.platformDiscountState ?? null,
  };
}

function diagnostic(value: unknown): Record<string, unknown> {
  const upstreamResponseBody = record(value) ? diagnosticResponseBody(value.upstreamResponseBody) : null;
  if (!record(value) || !text(value.id) || !text(value.traceId) || !text(value.workerName) || !optionalText(value.storeId) ||
    !optionalText(value.shopHandle) || !optionalText(value.campaignId) || !text(value.eventType) || !diagnosticEventTypes.includes(value.eventType) ||
    !text(value.outcome) || !diagnosticOutcomes.includes(value.outcome) || !optionalText(value.upstreamService) || !optionalText(value.upstreamPath) ||
    !optionalInteger(value.upstreamStatus) || !optionalText(value.upstreamRequestId) || !optionalText(value.upstreamResponseCode) || !optionalText(value.upstreamResponseMessage) || !optionalText(value.errorCode) || !optionalInteger(value.durationMs) || !text(value.occurredAt)) throw new Error('INVALID_SOURCE');
  return {
    id: value.id, traceId: value.traceId, workerName: value.workerName, storeId: value.storeId, shopHandle: value.shopHandle,
    campaignId: value.campaignId, eventType: value.eventType, outcome: value.outcome, upstreamService: value.upstreamService,
    upstreamPath: value.upstreamPath, upstreamStatus: value.upstreamStatus, upstreamRequestId: value.upstreamRequestId,
    upstreamResponseCode: value.upstreamResponseCode, upstreamResponseMessage: value.upstreamResponseMessage,
    upstreamResponseBody,
    errorCode: value.errorCode, durationMs: value.durationMs, occurredAt: value.occurredAt,
  };
}

export function projectSource(path: string, result: SourceResult): Projection {
  if (result.status !== 200) return sourceError(result.status, result.body);
  if (!record(result.body) || !record(result.body.data)) throw new Error('INVALID_SOURCE');
  const data = result.body.data;

  if (path === '/overview') return { status: 200, body: { data: {
    installedStoreCount: metric(data.installedStoreCount),
    activeBundleCount: metric(data.activeBundleCount),
    errorCount: metric(data.errorCount),
  } } };
  if (path === '/stores' || path.startsWith('/stores?')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map(storeSummary) } } };
  }
  if (/^\/stores\/[^/]+$/.test(path)) return { status: 200, body: { data: storeDetail(data) } };
  if (/^\/stores\/[^/]+\/campaigns(?:\?.*)?$/.test(path)) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map(campaign) } } };
  }
  if (/^\/stores\/[^/]+\/campaigns\/[^/]+$/.test(path)) return { status: 200, body: { data: { campaign: campaign(data) } } };
  if (/^\/stores\/[^/]+\/campaigns\/[^/]+\/pause$/.test(path)) {
    if (!record(data.campaign)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { campaign: campaign(data.campaign) } } };
  }
  if (path === '/campaigns' || path.startsWith('/campaigns?')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map(campaign) } } };
  }
  if (/^\/stores\/[^/]+\/campaigns\/[^/]+\/(activate|platform-delete)$/.test(path)) {
    if (!record(data.campaign)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { campaign: campaign(data.campaign) } } };
  }
  if (path === '/diagnostics' || path.startsWith('/diagnostics?')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map(diagnostic) } } };
  }
  if (path.startsWith('/events/errors')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map((event) => {
      if (!record(event) || !Number.isInteger(event.id) || !optionalText(event.storeId) || !text(event.kind) ||
        !optionalText(event.handle) || !text(event.severity) || !text(event.code) || !optionalText(event.traceId) ||
        !optionalText(event.source) || (event.source !== null && !['worker', 'browser'].includes(event.source)) ||
        !optionalText(event.operation) || !optionalText(event.route) || !optionalText(event.method) || !optionalInteger(event.httpStatus) ||
        !optionalText(event.message) || !optionalText(event.relatedTraceId) || !text(event.occurredAt)) throw new Error('INVALID_SOURCE');
      return { id: event.id, storeId: event.storeId, handle: event.handle, kind: event.kind, severity: event.severity, code: event.code,
        traceId: event.traceId, source: event.source, operation: event.operation, route: event.route, method: event.method,
        httpStatus: event.httpStatus, message: event.message, relatedTraceId: event.relatedTraceId, occurredAt: event.occurredAt };
    }) } } };
  }
  if (path.startsWith('/diagnostics/requests')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map((event) => {
      if (!record(event) || !text(event.id) || !text(event.traceId) || !optionalText(event.storeId) || !optionalText(event.handle) || !text(event.route) || !text(event.method) || !Number.isInteger(event.httpStatus) || !Number.isInteger(event.durationMs) || !['success', 'client_error', 'server_error'].includes(String(event.outcome)) || !text(event.occurredAt)) throw new Error('INVALID_SOURCE');
      return { id: event.id, traceId: event.traceId, storeId: event.storeId, handle: event.handle, route: event.route, method: event.method, httpStatus: event.httpStatus, durationMs: event.durationMs, outcome: event.outcome, occurredAt: event.occurredAt };
    }) } } };
  }
  if (path === '/feedback' || path.startsWith('/feedback?')) {
    if (!Number.isInteger(data.total) || !Number.isInteger(data.offset) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, offset: data.offset, items: data.items.map(feedbackSummary) } } };
  }
  if (path === '/feedback-comments' || path.startsWith('/feedback-comments?')) {
    if (!Number.isInteger(data.total) || !Number.isInteger(data.offset) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, offset: data.offset, items: data.items.map(feedbackComment) } } };
  }
  if (/^\/feedback\/[^/]+$/.test(path)) return { status: 200, body: { data: feedbackDetail(data) } };
  if (/^\/feedback\/[^/]+\/status$/.test(path)) return { status: 200, body: { data: feedbackWrite(data) } };
  if (/^\/feedback\/[^/]+\/replies$/.test(path)) {
    if (!record(data.reply) || !text(data.reply.id) || data.reply.authorLabel !== '多件折扣' || data.reply.isOfficial !== true || !text(data.reply.content) || !text(data.reply.createdAt)) throw new Error('INVALID_SOURCE');
    return { status: 201, body: { data: { reply: { id: data.reply.id, authorLabel: data.reply.authorLabel, isOfficial: true, content: data.reply.content, createdAt: data.reply.createdAt } } } };
  }
  if (/^\/feedback\/[^/]+\/comments\/[^/]+$/.test(path)) {
    if (!text(data.commentId) || data.deleted !== true) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { commentId: data.commentId, deleted: true } } };
  }
  throw new Error('INVALID_SOURCE');
}
