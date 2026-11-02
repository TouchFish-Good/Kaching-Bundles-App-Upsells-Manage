const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string';
const optionalText = (value) => value === null || text(value);

function storeSummary(value) {
  if (!record(value) || !text(value.storeId) || !text(value.handle) || !text(value.scope) ||
    !['installed', 'uninstalled'].includes(value.status) || !text(value.installedAt) || !text(value.updatedAt)) {
    throw new Error('Invalid store source');
  }
  const { storeId, handle, scope, status, installedAt, updatedAt } = value;
  return { storeId, handle, scope, status, installedAt, updatedAt };
}

function storeDetail(value) {
  const summary = storeSummary(value);
  if (!Array.isArray(value.installations)) throw new Error('Invalid installation source');
  return {
    ...summary,
    installations: value.installations.map((cycle) => {
      if (!record(cycle) || !text(cycle.installedAt) || !optionalText(cycle.uninstalledAt)) throw new Error('Invalid installation cycle');
      return { installedAt: cycle.installedAt, uninstalledAt: cycle.uninstalledAt };
    }),
  };
}

function metric(value) {
  if (!record(value) || !['current', 'unavailable'].includes(value.sourceStatus) ||
    !(typeof value.value === 'number' || value.value === null) || !optionalText(value.asOf)) throw new Error('Invalid metric source');
  return { value: value.value, asOf: value.asOf, sourceStatus: value.sourceStatus };
}

export function projectSource(path, { status, body }) {
  if (status !== 200) {
    const code = status === 404 ? 'NOT_FOUND' : status === 422 ? 'INVALID_SOURCE_QUERY' : 'SOURCE_UNAVAILABLE';
    return { status: [404, 422].includes(status) ? status : 503, body: { error: { code } } };
  }
  const data = body?.data;
  if (!record(data)) throw new Error('Invalid source response');
  if (path === '/overview') {
    return { status: 200, body: { data: {
      installedStoreCount: metric(data.installedStoreCount),
      activeBundleCount: metric(data.activeBundleCount),
      errorCount: metric(data.errorCount),
    } } };
  }
  if (path.startsWith('/stores?') || path === '/stores') {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('Invalid store list');
    return { status: 200, body: { data: { total: data.total, items: data.items.map(storeSummary) } } };
  }
  if (/^\/stores\/[^/]+$/.test(path)) return { status: 200, body: { data: storeDetail(data) } };
  if (path.startsWith('/events/errors')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('Invalid error list');
    return { status: 200, body: { data: { total: data.total, items: data.items.map((event) => {
      if (!record(event) || !Number.isInteger(event.id) || !optionalText(event.storeId) ||
        !text(event.kind) || !text(event.severity) || !text(event.code) ||
        !optionalText(event.traceId) || !text(event.occurredAt)) throw new Error('Invalid error event');
      const { id, storeId, kind, severity, code, traceId, occurredAt } = event;
      return { id, storeId, kind, severity, code, traceId, occurredAt };
    }) } } };
  }
  throw new Error('Unsupported source response');
}
