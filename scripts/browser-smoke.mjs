// Local fixture server only. No authentication bypass is added to the Worker.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { accessHeaders, adminConfig } from '../test/helpers.js';
execFileSync(process.execPath, ['scripts/build-admin.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'wrangler.local.jsonc', '--outdir', '.artifacts/browser-worker'], { stdio: 'pipe', env: { ...process.env, WRANGLER_LOG_PATH: '/private/tmp/skoolio-browser-build-logs', WRANGLER_SEND_METRICS: 'false' } });
const { default: bundledWorker } = await import(pathToFileURL(resolve('.artifacts/browser-worker/worker.js')).href);
const auth = await accessHeaders();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => String(url) === 'https://team.example.com/cdn-cgi/access/certs' ? Response.json({ keys: [auth.publicJwk] }) : originalFetch(url, options);
import { KNOWLEDGE_COLLECTIONS, KNOWLEDGE_INVENTORY } from '../knowledge.generated.js';
import { normalizeCase, CASE_STATUSES, CASE_CATEGORIES } from '../support-cases.js';
const products = ['PLAYSMART', 'READSMART', 'SKOOLIO_ADMIN'];
const summaries = ['Spelling lesson closes when pressing Start', 'Reading progress is not syncing across devices', 'Guardian cannot see linked students', 'Activation key needs review after reinstall', 'Comprehension results are missing from the report', 'Subscription renewal shows an outdated status', 'Lesson audio stops after returning to the app', 'Reading assessment takes longer to load', 'Centre dashboard shows an incorrect student count'];
const cases = summaries.map((text, i) => normalizeCase({ case_id: `PS-${String(123 + i).padStart(6, '0')}`, product: products[i % 3], created_at: '2026-09-22T08:00:00Z', updated_at: '2026-09-22T09:15:00Z', status: ['NEW', 'INVESTIGATING', 'NEEDS_INFORMATION', 'CONFIRMED_BUG', 'FIX_IN_PROGRESS', 'FIX_READY', 'RESOLVED', 'NEW', 'INVESTIGATING'][i], severity: i % 3 === 0 ? 'HIGH' : 'MEDIUM', category: ['CRASH', 'SYNC', 'ACCOUNT'][i % 3], feature_module: ['Spelling', 'Reading', 'Students'][i % 3], platform: ['Windows', 'Android', 'Web'][i % 3], ai_summary: text, user_description: i === 0 ? '<img src=x onerror="window.__xss=1"> Customer reports the lesson closes after Start.' : text, revision: 1, history: [{ at: '2026-09-22T08:00:00Z', actor: 'support', action: 'CASE_CREATED', detail: 'Support case recorded' }] }));
let fixtureGuides = [];
let saves = 0; let failListing = false;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/admin') { const page = await bundledWorker.fetch(new Request('https://example.com/admin', auth), adminConfig); assert.equal(page.status, 200); response.writeHead(200, Object.fromEntries(page.headers)); response.end(await page.text()); return; }
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/api/admin/knowledge') { response.end(JSON.stringify({ collections: KNOWLEDGE_COLLECTIONS, documents: KNOWLEDGE_INVENTORY, ownerGuides: fixtureGuides })); return; }
  if (url.pathname === '/api/admin/guides') {
    if (request.method === 'POST') { let raw = ''; for await (const chunk of request) raw += chunk; const guide = { ...JSON.parse(raw), id: 'guide-owner-fixture', revision: 1 }; guide.keywords = guide.keywords.split(','); fixtureGuides = [guide]; response.end(JSON.stringify({ guide })); }
    else response.end(JSON.stringify({ guides: fixtureGuides }));
    return;
  }
  if (url.pathname === '/api/admin/operations') { response.end(JSON.stringify({ notifications: { PENDING: 2, ACCEPTED: 7 }, media: { configured: true, outboundConfigured: true, transcriptionModel: 'whisper-1', visionModel: 'gpt-4o-mini', queued: { PENDING: 1 }, diagnostics: { completed: 2, failed: 1, retries: 1, last: { outcome: 'FAILED', at: '2026-09-23T09:00:00Z', stage: 'download', code: 'DOWNLOAD_HTTP_401' } } } })); return; }
  if (url.pathname === '/api/admin/cases') {
    if (failListing) { response.writeHead(503); response.end(JSON.stringify({ error: 'Test service unavailable' })); return; }
    const filtered = cases.filter(item => !url.searchParams.get('product') || item.product === url.searchParams.get('product')).filter(item => { const status = url.searchParams.get('status'); return !status || (status === 'OPEN' ? !['CLOSED','RESOLVED','RELEASED'].includes(item.status) : status === 'RESOLVED_GROUP' ? ['CLOSED','RESOLVED','RELEASED'].includes(item.status) : item.status === status); });
    response.end(JSON.stringify({ cases: filtered, total: filtered.length, stats: { totalOpen: 8, newCases: 2, needsInformation: 1, investigating: 2, confirmedBugs: 1, fixInProgress: 1, fixReady: 1, resolved: 1, products: { PLAYSMART: 2, READSMART: 3, SKOOLIO_ADMIN: 3, GENERAL: 0, UNKNOWN: 0 } }, filters: { platform: ['Windows', 'Android', 'Web'], feature_module: ['Spelling', 'Reading', 'Students'] }, statuses: CASE_STATUSES, categories: CASE_CATEGORIES })); return;
  }
  const item = cases.find(item => url.pathname.endsWith(item.case_id));
  if (item && request.method === 'PATCH') { let raw = ''; for await (const chunk of request) raw += chunk; Object.assign(item, JSON.parse(raw)); saves++; }
  response.end(JSON.stringify({ case: item }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'skoolio-browser-'));
const browser = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => { let output = ''; const timeout = setTimeout(() => reject(new Error('Chrome did not start')), 15000); browser.stderr.on('data', bytes => { output += bytes; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } }); browser.on('error', reject); });
  socket = new WebSocket(endpoint); await new Promise(resolve => socket.once('open', resolve));
  let next = 0; const pending = new Map(); const errors = [];
  socket.on('message', raw => { const message = JSON.parse(raw); if (message.id) { const call = pending.get(message.id); pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => command(method, params, sessionId);
  await send('Runtime.enable'); await send('Page.enable');
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const waitFor = async expression => { const end = Date.now() + 8000; while (!await evaluate(expression)) { if (Date.now() > end) throw new Error('Browser wait timed out: ' + expression); await new Promise(resolve => setTimeout(resolve, 40)); } };
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/admin` }); await waitFor("document.querySelectorAll('#cases tr').length === 9");
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/dashboard-desktop.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate("document.querySelector('#cases tr .summary').click()"); await waitFor("document.getElementById('case-dialog').open");
  assert.equal(await evaluate('window.__xss'), undefined); assert.equal(await evaluate("document.querySelector('#detail img') === null"), true); assert.match(await evaluate("document.getElementById('detail').textContent"), /<img src=x/);
  await writeFile('.artifacts/dashboard-case.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate("document.getElementById('tab-history').click()"); assert.match(await evaluate("document.getElementById('case-history').textContent"), /Case created/);
  await evaluate("document.getElementById('tab-actions').click()"); assert.equal(await evaluate("document.getElementById('case-actions').hidden"), false);
  await evaluate("document.getElementById('edit-notes').value='Browser tested'; document.getElementById('save').click()"); await waitFor("!document.getElementById('case-dialog').open"); assert.equal(saves, 1);
  await evaluate("document.getElementById('product').value='READSMART'; document.getElementById('product').dispatchEvent(new Event('change'))"); await waitFor("document.querySelectorAll('#cases tr').length === 3");
  await evaluate("document.getElementById('operations-button').click()"); await waitFor("document.getElementById('operations-dialog').open"); assert.match(await evaluate("document.getElementById('operations-body').textContent"), /DOWNLOAD_HTTP_401/); await evaluate("document.getElementById('close-operations').click(); document.getElementById('reset-filters').click()"); await waitFor("document.querySelectorAll('#cases tr').length === 9");
  await evaluate("document.querySelectorAll('#stats button')[1].click()"); await waitFor("document.querySelectorAll('#cases tr').length === 2");
  await evaluate("document.getElementById('reset-filters').click()"); await waitFor("document.querySelectorAll('#cases tr').length === 9");
  failListing = true; await evaluate("document.getElementById('refresh').click()"); await waitFor("!document.getElementById('load-error').hidden"); assert.match(await evaluate("document.getElementById('cases').textContent"), /could not be loaded/);
  failListing = false; await evaluate("document.getElementById('retry-load').click()"); await waitFor("document.querySelectorAll('#cases tr').length === 9");
  await evaluate("document.getElementById('guides-button').click()"); await waitFor("document.getElementById('guides-dialog').open");
  assert.match(await evaluate("document.getElementById('knowledge-summary').textContent"), /ReadSmart/);
  assert.match(await evaluate("document.getElementById('knowledge-summary').textContent"), /Still needed/);
  await evaluate("document.getElementById('guide-product').value='READSMART'; document.getElementById('guide-title').value='Practice timer'; document.getElementById('guide-keywords').value='timer,practice'; document.getElementById('guide-content').value='1. Open Practice. 2. Choose Timer.'; document.getElementById('guide-published').checked=true; document.getElementById('guide-save').click()");
  await waitFor("document.getElementById('guide-error').textContent.includes('available for customer replies')");
  assert.equal(fixtureGuides[0].published, true); assert.equal(fixtureGuides[0].product, 'READSMART');
  await evaluate("document.getElementById('close-guides').click()");
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  await writeFile('.artifacts/dashboard-mobile.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  assert.deepEqual(errors, []); console.log('Wrangler-bundled Chrome desktop/mobile: rendering, row opening, tabs, status/product filters, save, error recovery and XSS fixture passed.');
} finally { globalThis.fetch = originalFetch; socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve)); await rm(profile, { recursive: true, force: true }); }
