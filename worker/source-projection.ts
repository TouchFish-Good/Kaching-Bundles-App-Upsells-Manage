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

function sourceError(status: number): Projection {
  if (status === 404) return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
  if (status === 422) return { status: 422, body: { error: { code: 'INVALID_SOURCE_QUERY' } } };
  return { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } };
}

export function projectSource(path: string, result: SourceResult): Projection {
  if (result.status !== 200) return sourceError(result.status);
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
  if (path.startsWith('/events/errors')) {
    if (!Number.isInteger(data.total) || !Array.isArray(data.items)) throw new Error('INVALID_SOURCE');
    return { status: 200, body: { data: { total: data.total, items: data.items.map((event) => {
      if (!record(event) || !Number.isInteger(event.id) || !optionalText(event.storeId) || !text(event.kind) ||
        !text(event.severity) || !text(event.code) || !optionalText(event.traceId) || !text(event.occurredAt)) throw new Error('INVALID_SOURCE');
      return { id: event.id, storeId: event.storeId, kind: event.kind, severity: event.severity, code: event.code, traceId: event.traceId, occurredAt: event.occurredAt };
    }) } } };
  }
  throw new Error('INVALID_SOURCE');
}
