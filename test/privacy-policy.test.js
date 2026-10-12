import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

test('legal pages are public without accessing storage or external providers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected external request'); };
  const env = new Proxy({}, { get() { throw new Error('Unexpected binding access'); } });
  try {
    for (const path of ['/privacy', '/privacy/', '/account-deletion', '/account-deletion/']) {
      const response = await worker.fetch(new Request(`https://example.com${path}`), env);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      const html = await response.text();
      assert.match(html, /PlaySmart/);
      assert.match(html, /Draft for owner review/);
      assert.doesNotMatch(html, /<script|<form|<iframe|<img/i);
      assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    }
  } finally { globalThis.fetch = original; }
});

test('legal routes support HEAD and reject mutations', async () => {
  for (const path of ['/privacy', '/account-deletion']) {
    const head = await worker.fetch(new Request(`https://example.com${path}`, { method: 'HEAD' }), {});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await worker.fetch(new Request(`https://example.com${path}`, { method }), {});
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
    }
  }
});

test('public legal pages do not open admin routes', async () => {
  for (const path of ['/admin', '/admin/store', '/api/admin/cases']) {
    const response = await worker.fetch(new Request(`https://example.com${path}`), {});
    assert.equal(response.status, 401);
  }
});
