// Local synthetic browser acceptance only. All external requests are blocked.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { moolaAdminResponse } from '../moola-admin.js';
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to an isolated installation.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BINARY ? { executablePath: process.env.CHROME_BINARY } : {}) });
try {
  const response = moolaAdminResponse(), html = await response.text();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const row = { accountId: 'a'.repeat(64), scope: { tenantId: 'tenant-one', centreId: 'centre-one', studentId: 'student-one' },
    learnerName: 'Synthetic Explorer', tenantName: 'Synthetic tenant', centreName: 'Synthetic centre', accountStatus: 'recorded',
    current: { balanceMoolaUnits: 59325, earnedMoolaUnits: 59325, spentMoolaUnits: 0, xp: { total: 18 }, revision: 13 }, reset: { status: 'not_recorded' } };
  const receipts = new Map(), requests = []; let applied = 0, loseResponse = true;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, 'https://moola.synthetic.test', 'No production requests allowed');
    if (url.pathname === '/admin/moola') return route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body: html });
    if (url.pathname === '/api/admin/moola/accounts') return route.fulfill({ json: { schemaVersion: 1, items: [row], nextCursor: null, fetchedAt: '2026-10-12T12:00:00.000Z' } });
    if (url.pathname.endsWith('/' + row.accountId + '/awards')) return route.fulfill({ json: { items: [...receipts.values()].map(v => v.audit), hasMore: false } });
    assert.equal(url.pathname, '/api/admin/moola/awards'); assert.equal(request.method(), 'POST');
    const body = request.postDataJSON(); requests.push(body);
    const previous = receipts.get(body.requestId);
    if (previous) { assert.deepEqual(previous.body, body); return route.fulfill({ json: { audit: previous.audit, replayed: true } }); }
    if (body.expectedRevision !== row.current.revision) return route.fulfill({ status: 409, json: { code: 'REWARDS_ACCOUNT_CHANGED', error: 'Refresh account' } });
    const units = Math.round(Number(body.amountMoola) * 1000), before = row.current.balanceMoolaUnits;
    const audit = { requestId: body.requestId, accountId: row.accountId, actor: 'access:' + 'b'.repeat(64), reason: body.reason,
      amountMoolaUnits: units, balanceBeforeUnits: before, balanceAfterUnits: before + units, revisionBefore: row.current.revision,
      revisionAfter: row.current.revision + 1, acceptedAt: '2026-10-12T12:00:00.000Z' };
    receipts.set(body.requestId, { body, audit }); applied++;
    row.current.balanceMoolaUnits += units; row.current.earnedMoolaUnits += units; row.current.revision++;
    if (loseResponse) { loseResponse = false; return route.abort('failed'); }
    return route.fulfill({ json: { audit, replayed: false } });
  });
  const loaded = () => page.getByText('All recorded reward accounts loaded.', { exact: true }).waitFor();
  const open = async () => {
    await page.getByRole('button', { name: 'View details for Synthetic Explorer', exact: true }).click();
    await page.locator('#open-award').click();
  };
  await page.goto('https://moola.synthetic.test/admin/moola'); await loaded(); assert.equal(requests.length, 0);
  await open(); await page.locator('#award-amount').fill('0'); await page.locator('#award-reason').fill('Synthetic recognition');
  await page.locator('#review-award').click(); assert.match(await page.locator('#award-status').textContent(), /Enter 0.001/);
  assert.equal(requests.length, 0);
  await page.locator('#award-amount').fill('5,125'); await page.locator('#review-award').click();
  assert.match(await page.locator('#award-review').textContent(), /59\.325 → 64\.45/);
  if (process.env.MOOLA_AWARD_SCREENSHOT) await page.screenshot({ path: process.env.MOOLA_AWARD_SCREENSHOT, fullPage: true });
  await page.locator('#confirm-award').evaluate(button => { button.click(); button.click(); });
  await page.getByRole('button', { name: 'Retry same award', exact: true }).waitFor();
  assert.equal(requests.length, 1); assert.equal(applied, 1);
  assert.ok(await page.evaluate(() => sessionStorage.getItem('playsmart.pendingAdminMoolaAward.v1')));
  await page.reload(); await loaded(); assert.equal(requests.length, 1, 'Reload must not submit automatically');
  await page.locator('#resume-award').click(); await page.locator('#confirm-award').click();
  await page.locator('#award-status').filter({ hasText: 'Already recorded — no duplicate award.' }).waitFor();
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]); assert.equal(applied, 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('playsmart.pendingAdminMoolaAward.v1')), null);
  await page.locator('#cancel-award').click(); await loaded();
  assert.match(await page.locator('#rows').textContent(), /64\.45/);
  await open(); await page.locator('#award-amount').fill('2'); await page.locator('#award-reason').fill('Stale proposal');
  await page.locator('#review-award').click(); row.current.revision++;
  await page.locator('#confirm-award').click();
  await page.locator('#notice').filter({ hasText: 'The balance changed. No award was applied.' }).waitFor(); assert.equal(applied, 1);
  await open(); await page.locator('#award-amount').fill('0.001'); await page.locator('#award-reason').fill('<img src=x onerror="window.injected=true">');
  await page.locator('#review-award').click(); await page.locator('#confirm-award').click();
  await page.locator('#award-status').filter({ hasText: 'Award recorded.' }).waitFor(); assert.equal(applied, 2);
  await page.locator('#cancel-award').click(); await loaded();
  await page.getByRole('button', { name: 'View details for Synthetic Explorer', exact: true }).click();
  await page.locator('#award-history').filter({ hasText: 'Synthetic recognition' }).waitFor();
  assert.equal(await page.locator('#award-history img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.match(await page.locator('#award-history').textContent(), /access:/);
  await page.locator('#open-award').click(); await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: confirmation, validation, double-click, lost response/reload/replay, stale revision, exact decimal display, audit history, XSS and mobile layout.');
} finally { await browser.close(); }
