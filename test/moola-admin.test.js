import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { moolaProxy } from '../moola-admin-proxy.js';
import { moolaAdminResponse } from '../moola-admin.js';
import { renderAdmin } from '../admin.js';
import worker from '../worker.js';
import { accessHeaders, adminConfig } from './helpers.js';
const env = { PLAYSMART_STORE_API_URL: 'https://synthetic-api.us-central1.run.app' };
const request = (suffix = '', method = 'GET') => new Request('https://admin.example.test/api/admin/moola/accounts' + suffix,
  { method, headers: { 'CF-Access-JWT-Assertion': 'synthetic-assertion', Authorization: 'never-forward', Cookie: 'never-forward' } });
test('page and API require the existing verified Access owner session', async t => {
  for (const path of ['/admin/moola', '/api/admin/moola/accounts']) assert.equal((await worker.fetch(new Request('https://admin.example.test' + path), {})).status, 401);
  const access = await accessHeaders();
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(String(url), /\/cdn-cgi\/access\/certs$/); return Response.json({ keys: [access.publicJwk] });
  });
  const response = await worker.fetch(new Request('https://admin.example.test/admin/moola', { headers: access.headers }), adminConfig);
  assert.equal(response.status, 200); assert.match(await response.text(), /Moola balances & reset history/);
  const denied = await accessHeaders({ email: 'parent@example.test' });
  assert.equal((await worker.fetch(new Request('https://admin.example.test/admin/moola', { headers: denied.headers }), adminConfig)).status, 401);
});
test('read-only proxy passes the bounded cursor and only the verified Access assertion', async () => {
  const after = 'a'.repeat(64);
  const response = await moolaProxy(request('?after=' + after), env, async (url, options) => {
    assert.equal(String(url), env.PLAYSMART_STORE_API_URL + '/v1/rewards-admin/accounts?after=' + after);
    assert.deepEqual(options.headers, { 'CF-Access-JWT-Assertion': 'synthetic-assertion', Accept: 'application/json' });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); return Response.json({ items: [] });
  });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
test('mutations, arbitrary routes, duplicate/query injection, missing assertion and invalid origins never reach upstream', async () => {
  let calls = 0; const noFetch = async () => { calls++; throw Error('Must not fetch'); };
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH', 'HEAD']) assert.equal((await moolaProxy(request('', method), env, noFetch)).status, 405);
  for (const query of ['?url=https://outside.test', '?after=../x', '?after=' + 'a'.repeat(64) + '&after=' + 'b'.repeat(64)]) assert.equal((await moolaProxy(request(query), env, noFetch)).status, 400);
  assert.equal((await moolaProxy(request('/reset'), env, noFetch)).status, 404);
  const missing = request(); missing.headers.delete('CF-Access-JWT-Assertion');
  assert.equal((await moolaProxy(missing, env, noFetch)).status, 401);
  for (const origin of ['http://synthetic.run.app', 'https://outside.test', 'https://synthetic.run.app@outside.test', 'https://synthetic.run.app/other', 'https://synthetic.run.app?token=bad', 'https://synthetic.run.app:8443']) assert.equal((await moolaProxy(request(), { PLAYSMART_STORE_API_URL: origin }, noFetch)).status, 503);
  assert.equal(calls, 0);
});
test('redirects, HTML and network errors fail safely; upstream access failures stay failures', async () => {
  for (const upstream of [new Response(null, { status: 302, headers: { Location: 'https://outside.test' } }), new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } })]) assert.equal((await moolaProxy(request(), env, async () => upstream)).status, 502);
  assert.equal((await moolaProxy(request(), env, async () => { throw Error('Network details must not leak'); })).status, 502);
  assert.equal((await moolaProxy(request(), env, async () => Response.json({ error: 'Denied' }, { status: 403 }))).status, 403);
});
test('admin navigation exposes Moola; page is private with restrictive CSP and executable self-contained script', async () => {
  assert.match(renderAdmin('synthetic'), /href="\/admin\/moola"/);
  const response = moolaAdminResponse(), html = await response.text();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(html, /Account overview & awards/); assert.match(html, /A zero balance does not prove a reset/);
  assert.doesNotMatch(html, /unsafe-inline|localStorage|innerHTML/);
  new vm.Script(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
});

test('award proxy requires same origin and bounded JSON; forwards only Access identity', async () => {
  const body = { accountId: 'a'.repeat(64), requestId: '00000000-0000-4000-8000-000000000001', amountMoola: '5', reason: 'Synthetic award', expectedRevision: 13 };
  const make = (headers = {}, value = JSON.stringify(body)) => new Request('https://admin.example.test/api/admin/moola/awards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://admin.example.test', 'CF-Access-JWT-Assertion': 'synthetic', Cookie: 'private', Authorization: 'private', ...headers }, body: value,
  });
  let calls = 0;
  const upstream = async (url, options) => {
    calls++; assert.equal(String(url), env.PLAYSMART_STORE_API_URL + '/v1/rewards-admin/awards');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
    assert.deepEqual(options.headers, { 'CF-Access-JWT-Assertion': 'synthetic', Accept: 'application/json', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(new TextDecoder().decode(options.body)), body);
    return Response.json({ replayed: false });
  };
  assert.equal((await moolaProxy(make(), env, upstream)).status, 200);
  for (const origin of ['', 'https://evil.example.test']) assert.equal((await moolaProxy(make({ Origin: origin }), env, upstream)).status, 403);
  assert.equal((await moolaProxy(make({ 'Content-Type': 'text/plain' }), env, upstream)).status, 415);
  assert.equal((await moolaProxy(make({}, 'x'.repeat(8193)), env, upstream)).status, 413);
  assert.equal(calls, 1);
});
test('award and history routes still require verified owner Access at the Worker', async () => {
  for (const path of ['/api/admin/moola/awards', '/api/admin/moola/accounts/' + 'a'.repeat(64) + '/awards']) {
    assert.equal((await worker.fetch(new Request('https://admin.example.test' + path, { method: path.endsWith('/moola/awards') ? 'POST' : 'GET' }), {})).status, 401);
  }
  const r = new Request('https://admin.example.test/api/admin/moola/accounts/' + 'a'.repeat(64) + '/awards', { headers: { 'CF-Access-JWT-Assertion': 'synthetic' } });
  assert.equal((await moolaProxy(r, env, async (url, opts) => {
    assert.equal(String(url), env.PLAYSMART_STORE_API_URL + '/v1/rewards-admin/accounts/' + 'a'.repeat(64) + '/awards');
    assert.equal(opts.method, 'GET'); return Response.json({ items: [], hasMore: false });
  })).status, 200);
});
