// Called only after the worker's existing Cloudflare Access verification.
export async function storeProxy(request, env, fetcher = fetch) {
  const url = new URL(request.url), suffix = url.pathname.slice('/api/admin/store'.length);
  const allowed = request.method === 'GET' && (['/products', '/scopes'].includes(suffix) || /^\/assets\/[a-f0-9]{64}\.png$/.test(suffix))
    || request.method === 'POST' && ['/products', '/assets'].includes(suffix);
  const json = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!allowed || url.search) return json('Not found', 404);
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return json('Invalid origin', 403);
  const assertion = request.headers.get('CF-Access-JWT-Assertion');
  if (!assertion) return json('Sign in through Cloudflare Access.', 401);
  let base;
  try { base = new URL(env.PLAYSMART_STORE_API_URL); }
  catch { return json('The PlaySmart store connection has not been configured.', 503); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || !base.hostname.endsWith('.run.app')) return json('The PlaySmart store connection is invalid.', 503);
  const image = suffix === '/assets', contentType = request.headers.get('Content-Type')?.split(';')[0];
  if (request.method === 'POST' && contentType !== (image ? 'image/png' : 'application/json')) return json(image ? 'Upload a PNG image.' : 'JSON product details are required.', 415);
  let body;
  if (request.method === 'POST') {
    const limit = image ? 2 * 1024 * 1024 : 32 * 1024, chunks = []; let length = 0;
    const reader = request.body?.getReader();
    if (!reader) return json('A request body is required.', 400);
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); return json('Upload or product details exceed the size limit.', 413); }
      chunks.push(value);
    }
    body = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  try {
    const response = await fetcher(new URL('/v1/store-admin' + suffix, base), {
      method: request.method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { 'CF-Access-JWT-Assertion': assertion, ...(contentType ? { 'Content-Type': contentType } : {}) }, body,
    });
    if (response.status >= 300 && response.status < 400) return json('The PlaySmart store returned an unexpected redirect.', 502);
    const type = response.headers.get('Content-Type') || '';
    if (!type.startsWith('application/json') && !type.startsWith('image/png')) return json('The PlaySmart store returned an unexpected response.', 502);
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return json('The PlaySmart store could not be reached. Please retry.', 502); }
}
