import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { authenticator } from 'otplib';
import { AdminStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { signInternal } from '../server/internal-client.js';

const dir = mkdtempSync(join(tmpdir(), 'kaching-browser-'));
const shots = resolve('docs/qa');
mkdirSync(shots, { recursive: true });
const store = new AdminStore(join(dir, 'admin.sqlite'));
await store.ready();
const mfaSecret = authenticator.generateSecret();
await store.createUser({ email: 'qa@example.com', password: 'browser-test-passphrase', role: 'Owner', mfaSecret });

const fixture = express();
fixture.use((req, res, next) => {
  const path = req.originalUrl;
  const expected = signInternal('browser-internal-secret', req.method, path, req.header('x-admin-timestamp'), req.header('x-admin-nonce'));
  if (expected !== req.header('x-admin-signature')) { res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); return; }
  next();
});
fixture.get('/internal/admin-read/v1/overview', (_req, res) => res.json({ data: {
  installedStoreCount: { value: 1, asOf: '2026-10-14T08:00:00Z', sourceStatus: 'current' },
  activeBundleCount: { value: null, asOf: null, sourceStatus: 'unavailable' },
  errorCount: { value: 1, asOf: '2026-10-14T08:00:00Z', sourceStatus: 'current' },
} }));
fixture.get('/internal/admin-read/v1/stores', (req, res) => res.json({ data: {
  total: req.query.query === 'missing' ? 0 : 1,
  items: req.query.query === 'missing' ? [] : [{ storeId: 'store-42', handle: 'fixture-shop', scope: 'write_products', status: 'installed', installedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T08:00:00Z' }],
} }));
fixture.get('/internal/admin-read/v1/stores/store-42', (_req, res) => res.json({ data: {
  storeId: 'store-42', handle: 'fixture-shop', scope: 'write_products', status: 'installed', installedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T08:00:00Z', installations: [{ installedAt: '2026-10-14T01:00:00Z', uninstalledAt: null }],
} }));
fixture.get('/internal/admin-read/v1/bundles', (_req, res) => res.status(503).json({ error: { code: 'SOURCE_UNAVAILABLE' } }));
fixture.get('/internal/admin-read/v1/events/errors', (_req, res) => res.json({ data: { total: 1, items: [{ id: 1, storeId: 'store-42', kind: 'webhook', severity: 'error', code: 'WEBHOOK_PROCESSING_FAILED', traceId: 'trace-fixture', occurredAt: '2026-10-14T07:00:00Z' }] } }));
const fixtureServer = fixture.listen(0);
const fixturePort = fixtureServer.address().port;
const adminApp = createApp(store, { internalUrl: `http://127.0.0.1:${fixturePort}`, internalSecret: 'browser-internal-secret', environment: 'development' });
const adminServer = adminApp.listen(0);
const adminPort = adminServer.address().port;
const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/admin-api': `http://127.0.0.1:${adminPort}` } } });
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  desktop.on('pageerror', (error) => errors.push(error.message));
  await desktop.goto(url);
  await desktop.getByLabel('邮箱').fill('qa@example.com');
  await desktop.getByLabel('密码').fill('browser-test-passphrase');
  await desktop.getByRole('button', { name: '继续' }).click();
  await desktop.getByLabel('验证码').fill(authenticator.generate(mfaSecret));
  await desktop.getByRole('button', { name: '验证并登录' }).click();
  await desktop.getByRole('heading', { name: 'Overview' }).waitFor();
  await desktop.getByText('已安装店铺').waitFor();
  await desktop.screenshot({ path: join(shots, 'fixture-overview-1440.png'), fullPage: true });
  await desktop.getByRole('link', { name: 'Stores' }).click();
  await desktop.getByText('fixture-shop').first().waitFor();
  await desktop.screenshot({ path: join(shots, 'fixture-stores-1440.png'), fullPage: true });
  await desktop.getByLabel('搜索店铺').fill('missing');
  await desktop.getByRole('button', { name: '搜索' }).click();
  await desktop.getByText('没有符合条件的店铺').waitFor();
  await desktop.getByRole('button', { name: '清除筛选' }).click();
  await desktop.getByText('fixture-shop').first().click();
  await desktop.getByRole('heading', { name: '安装周期' }).waitFor();
  await desktop.getByRole('link', { name: 'Bundles' }).click();
  await desktop.getByRole('heading', { name: 'Bundles' }).waitFor();
  await desktop.getByText('活动数据源未接入').waitFor();
  await desktop.screenshot({ path: join(shots, 'fixture-bundles-1440.png'), fullPage: true });
  await desktop.getByRole('link', { name: 'Errors' }).click();
  await desktop.getByText('WEBHOOK_PROCESSING_FAILED').first().waitFor();
  await desktop.getByRole('link', { name: 'Administrators' }).click();
  await desktop.getByText('qa@example.com').last().waitFor();
  await desktop.getByRole('button', { name: '邀请管理员' }).click();
  await desktop.getByLabel('邮箱').fill('new-operator@example.com');
  await desktop.getByLabel('角色').selectOption('Operator');
  await desktop.getByRole('button', { name: '生成邀请链接' }).click();
  const invitationUrl = await desktop.locator('.invitation-link').textContent();
  assert.ok(invitationUrl?.includes('/activate#token='));
  const invited = await browser.newPage({ viewport: { width: 768, height: 900 }, deviceScaleFactor: 1 });
  await invited.goto(invitationUrl);
  await invited.getByRole('heading', { name: '设置账号' }).waitFor();
  const inviteSecret = await invited.locator('.mfa-setup code').textContent();
  await invited.getByLabel('设置密码').fill('new-operator-passphrase');
  await invited.getByLabel('验证码').fill(authenticator.generate(inviteSecret));
  await invited.getByRole('button', { name: '激活账号' }).click();
  await invited.getByRole('heading', { name: '账号已激活' }).waitFor();
  await invited.screenshot({ path: join(shots, 'fixture-activation-768.png'), fullPage: true });
  await desktop.getByRole('button', { name: '关闭' }).click();
  await desktop.reload();
  await desktop.getByRole('row', { name: /new-operator@example.com/ }).waitFor();
  await desktop.getByRole('row', { name: /new-operator@example.com/ }).getByRole('button', { name: '停用' }).click();
  await desktop.getByRole('dialog', { name: '停用管理员？' }).getByRole('button', { name: '停用' }).click();
  await desktop.getByRole('row', { name: /new-operator@example.com/ }).getByText('已停用').waitFor();
  assert.deepEqual(errors, []);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(url);
  await mobile.screenshot({ path: join(shots, 'fixture-login-390.png'), fullPage: true });
  await mobile.getByLabel('邮箱').fill('qa@example.com');
  await mobile.getByLabel('密码').fill('browser-test-passphrase');
  await mobile.getByRole('button', { name: '继续' }).click();
  await mobile.getByLabel('验证码').fill(authenticator.generate(mfaSecret));
  await mobile.getByRole('button', { name: '验证并登录' }).click();
  await mobile.getByRole('heading', { name: 'Overview' }).waitFor();
  await mobile.screenshot({ path: join(shots, 'fixture-overview-390.png'), fullPage: true });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `mobile horizontal overflow: ${overflow}px`);
  await mobile.getByRole('button', { name: '打开导航' }).click();
  await mobile.getByRole('link', { name: 'Stores' }).click();
  await mobile.waitForFunction(() => document.querySelector('.sidebar')?.getBoundingClientRect().right <= 0);
  await mobile.locator('.mobile-records').getByText('fixture-shop').waitFor();
  await mobile.screenshot({ path: join(shots, 'fixture-stores-390.png'), fullPage: true });
  const storesOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(storesOverflow <= 1, `mobile stores horizontal overflow: ${storesOverflow}px`);
  for (const width of [360, 768]) {
    await mobile.setViewportSize({ width, height: 844 });
    const amount = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(amount <= 1, `${width}px horizontal overflow: ${amount}px`);
  }
  console.log(JSON.stringify({ desktop: 'pass', mobile: 'pass', pageErrors: errors.length, screenshots: shots }));
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolve) => adminServer.close(resolve));
  await new Promise((resolve) => fixtureServer.close(resolve));
  await store.close();
  rmSync(dir, { recursive: true, force: true });
}
