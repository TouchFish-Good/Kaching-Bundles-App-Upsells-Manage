import { pathToFileURL } from 'node:url';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_BUCKET = 'kaching-worker-diagnostics';
const REQUIRED_JOBS = [
  { name: 'kaching-merchant-raw-logs', prefix: 'merchant-app/' },
  { name: 'kaching-admin-raw-logs', prefix: 'developer-admin/' },
];

export function evaluateDiagnosticsResources({ bucketName, buckets, lifecycle, jobs, r2Unavailable = false, logpushUnavailable = false }) {
  const missing = [];
  if (r2Unavailable) {
    return { status: 'degraded', missing: ['R2'], message: '原始 Worker 日志未启用：当前 Cloudflare 账户尚未启用 R2；D1 业务诊断仍可使用。' };
  }
  if (!buckets.some((bucket) => bucket?.name === bucketName)) missing.push(`R2 bucket: ${bucketName}`);
  const hasSevenDayExpiration = (lifecycle?.rules || []).some((rule) => rule?.enabled !== false && rule?.action === 'Delete' && rule?.conditions?.age === SEVEN_DAYS_SECONDS);
  if (!hasSevenDayExpiration) missing.push('R2 7 天生命周期删除规则');
  if (logpushUnavailable) missing.push('Logpush 读取权限或套餐能力');
  for (const expected of REQUIRED_JOBS) {
    const job = jobs.find((candidate) => candidate?.name === expected.name);
    if (!job || !String(job.destination_conf || '').includes(bucketName) || !String(job.destination_conf || '').includes(expected.prefix)) {
      missing.push(`Logpush job: ${expected.name}`);
    }
  }
  return {
    status: missing.length ? 'degraded' : 'ready',
    missing,
    message: missing.length ? `原始 Worker 日志未完全启用：缺少 ${missing.join('、')}；D1 业务诊断仍可使用。` : '诊断资源已就绪：R2 原始日志保留 7 天，D1 业务诊断保留 30 天。',
  };
}

class CloudflareApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function getJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const error = body.errors?.[0] || {};
    throw new CloudflareApiError(error.message || `Cloudflare API 请求失败 (${response.status})`, error.code, response.status);
  }
  return body.result;
}

function r2Unavailable(error) {
  return error.code === 10042 || /enable R2/i.test(error.message);
}

function lifecycleNotConfigured(error) {
  return error.status === 404 || error.code === 10007;
}

function logpushUnavailable(error) {
  return error.status === 403 || error.status === 404 || /logpush|permission|not entitled/i.test(error.message);
}

function bucketItems(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.buckets) ? result.buckets : [];
}

export async function checkDiagnosticsResources({ accountId, token, bucketName = DEFAULT_BUCKET, fetchImpl = fetch }) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
  let buckets;
  try {
    buckets = bucketItems(await getJson(fetchImpl, `${api}/r2/buckets`, token));
  } catch (error) {
    if (error instanceof CloudflareApiError && r2Unavailable(error)) return evaluateDiagnosticsResources({ bucketName, buckets: [], lifecycle: null, jobs: [], r2Unavailable: true });
    throw error;
  }

  let lifecycle = null;
  if (buckets.some((bucket) => bucket?.name === bucketName)) {
    try {
      lifecycle = await getJson(fetchImpl, `${api}/r2/buckets/${encodeURIComponent(bucketName)}/lifecycle`, token);
    } catch (error) {
      if (!(error instanceof CloudflareApiError && lifecycleNotConfigured(error))) throw error;
    }
  }

  let jobs = [];
  let unavailable = false;
  try {
    const result = await getJson(fetchImpl, `${api}/logpush/jobs`, token);
    jobs = Array.isArray(result) ? result : [];
  } catch (error) {
    if (error instanceof CloudflareApiError && logpushUnavailable(error)) unavailable = true;
    else throw error;
  }
  return evaluateDiagnosticsResources({ bucketName, buckets, lifecycle, jobs, logpushUnavailable: unavailable });
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const bucketName = process.env.DIAGNOSTICS_R2_BUCKET || DEFAULT_BUCKET;
  if (!accountId || !token) {
    console.error('缺少 CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_API_TOKEN。请使用仅含 Account Read、R2 Read、Logpush Read 权限的临时令牌运行此只读检查。');
    process.exitCode = 2;
    return;
  }
  try {
    const report = await checkDiagnosticsResources({ accountId, token, bucketName });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'ready') process.exitCode = 2;
  } catch (error) {
    console.error(`资源检查失败：${error instanceof Error ? error.message : '未知错误'}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
