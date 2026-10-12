// Optional local browser check. Install Playwright in an isolated tools directory,
// then set PLAYWRIGHT_MODULE to its absolute index.mjs. No production endpoints.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to an isolated local Playwright installation.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const temporary = await mkdtemp(join(tmpdir(), 'moola-browser-'));
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_BINARY ? { executablePath: process.env.CHROME_BINARY } : {}) });
try {
  // Exercise the bundled/minified script as it will be embedded by the Worker.
  const bundle = join(temporary, 'page.mjs');
  await build({ entryPoints: [new URL('../moola-admin.js', import.meta.url).pathname], bundle: true, format: 'esm', minify: true, keepNames: true, outfile: bundle, target: 'es2022' });
  const { moolaAdminResponse } = await import(pathToFileURL(bundle));
  const response = moolaAdminResponse(), html = await response.text();
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const first = { accountId: 'a'.repeat(64), scope: { tenantId: 'tenant-one', centreId: 'centre-one', studentId: 'student-one' },
    learnerName: 'Synthetic Explorer', tenantName: 'Synthetic tenant', centreName: 'Synthetic centre', accountStatus: 'recorded',
    current: { balanceMoolaUnits: 59325, earnedMoolaUnits: 69325, spentMoolaUnits: 10000, xp: { total: 18 }, revision: 13 },
    reset: { status: 'confirmed', at: '2026-09-30T09:10:02.000Z', previousBalanceMoolaUnits: 12345, openingBalanceMoolaUnits: 0, previousXp: 100, openingXp: 0, waivedOverspendUnits: 0 } };
  const second = { ...first, accountId: 'b'.repeat(64), learnerName: '<img src=x onerror="window.injected=true">',
    scope: { tenantId: 'tenant-two', centreId: 'centre-two', studentId: 'student-two' }, tenantName: 'Other tenant', centreName: 'Other centre',
    current: { ...first.current, balanceMoolaUnits: 0 }, reset: { status: 'not_recorded' } };
  let mode = 'normal', calls = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'https://moola.synthetic.test', 'Browser must not call a real backend');
    if (url.pathname === '/admin/moola') return route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body: html });
    if (/^\/api\/admin\/moola\/accounts\/[a-f0-9]{64}\/awards$/.test(url.pathname)) return route.fulfill({ json: { items: [], hasMore: false } });
    if (url.pathname === '/api/admin/moola/accounts') {
      calls++; assert.equal(route.request().method(), 'GET');
      if (mode === 'denied') return route.fulfill({ status: 401, json: { error: 'Expired' } });
      if (mode === 'failure' && url.search) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      if (mode === 'empty') return route.fulfill({ json: { schemaVersion: 1, items: [], nextCursor: null, fetchedAt: '2026-10-12T12:00:00.000Z' } });
      return route.fulfill({ json: { schemaVersion: 1, items: url.search ? [second] : [first], nextCursor: url.search ? null : first.accountId, fetchedAt: '2026-10-12T12:00:00.000Z' } });
    }
    throw Error('Unexpected request: ' + url.pathname);
  });
  await page.goto('https://moola.synthetic.test/admin/moola');
  await page.getByText('All recorded reward accounts loaded.', { exact: true }).waitFor();
  assert.equal(calls, 2); assert.equal(await page.locator('#loaded').textContent(), '2');
  assert.equal(await page.locator('#positive').textContent(), '1'); assert.equal(await page.locator('#reset-count').textContent(), '1');
  assert.match(await page.locator('#rows').textContent(), /59\.325/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('#rows img').count(), 0);
  await page.locator('#balance').selectOption('positive'); assert.equal(await page.locator('#rows tr').count(), 1);
  await page.getByRole('button', { name: 'View details for Synthetic Explorer', exact: true }).click();
  assert.match(await page.locator('#detail-values').textContent(), /12\.345/);
  assert.match(await page.locator('#detail-values').textContent(), /Not recorded in the archive/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#balance').selectOption('all'); await page.locator('#tenant').selectOption('tenant-two');
  assert.equal(await page.locator('#rows tr').count(), 1); assert.match(await page.locator('#rows').textContent(), /No archive found/);
  await page.locator('#tenant').selectOption(''); await page.locator('#search').fill('student-one');
  assert.equal(await page.locator('#rows tr').count(), 1);
  await page.locator('#search').fill('missing'); assert.equal(await page.locator('#rows tr').count(), 0);
  await page.getByText('No recorded accounts match these filters.', { exact: true }).waitFor();
  await page.locator('#search').fill('');
  if (process.env.MOOLA_SCREENSHOT) await page.screenshot({ path: process.env.MOOLA_SCREENSHOT, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  mode = 'failure'; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Accounts could not be fully loaded. Refresh to retry.', { exact: true }).waitFor();
  assert.match(await page.locator('#coverage').textContent(), /Partial results/);
  assert.equal(await page.locator('#loaded').textContent(), '1');
  mode = 'denied'; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText(/Your administrator session has expired/).waitFor();
  assert.equal(await page.locator('#rows tr').count(), 0); assert.equal(await page.locator('#loaded').textContent(), '0');
  mode = 'empty'; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('All recorded reward accounts loaded.', { exact: true }).waitFor();
  assert.equal(await page.locator('#loaded').textContent(), '0');
  assert.deepEqual(errors, []);
  console.log('PASS: bundled browser rendering, precision, pagination, XSS, filters, history, mobile layout, partial failure, Access expiry and empty state.');
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
