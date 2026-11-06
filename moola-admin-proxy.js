// Invoked only after the Worker's existing Cloudflare Access verification.
export async function moolaProxy(request, env, fetcher = fetch) {
  const json = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const url = new URL(request.url);
  const suffix = url.pathname.slice('/api/admin/moola'.length);
  const award = suffix === '/awards';
  const history = /^\/accounts\/[a-f0-9]{64}\/awards$/.test(suffix);
  if (request.method !== (award ? 'POST' : 'GET')) return json('Method not allowed.', 405);
  if (!award && !history && suffix !== '/accounts') return json('Not found.', 404);
  if (award && request.headers.get('Origin') !== url.origin) return json('Invalid origin.', 403);
  if (award && request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return json('JSON award details required.', 415);
  const entries = [...url.searchParams];
  if ((award || history) && entries.length || entries.length > 1 || entries.some(([key, value]) => key !== 'after' || !/^[a-f0-9]{64}$/.test(value))) return json('Invalid account page request.', 400);
  const assertion = request.headers.get('CF-Access-JWT-Assertion');
  if (!assertion) return json('Sign in through Cloudflare Access.', 401);
  let base;
  try { base = new URL(env.PLAYSMART_STORE_API_URL); }
  catch { return json('The PlaySmart connection has not been configured.', 503); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || base.pathname !== '/' || !base.hostname.endsWith('.run.app') || base.port) return json('The PlaySmart connection is invalid.', 503);
  let body;
  if (award) {
    const reader = request.body?.getReader();
    if (!reader) return json('Award details required.', 400);
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return json('Award details are too large.', 413); }
      chunks.push(value);
    }
    body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  try {
    const upstream = new URL('/v1/rewards-admin' + suffix, base);
    upstream.search = url.search;
    const response = await fetcher(upstream, { method: request.method, body, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { 'CF-Access-JWT-Assertion': assertion, Accept: 'application/json', ...(award ? { 'Content-Type': 'application/json' } : {}) } });
    if (response.status >= 300 && response.status < 400 || !response.headers.get('Content-Type')?.startsWith('application/json')) return json('The PlaySmart connection returned an unexpected response.', 502);
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return json('Moola request could not be reached. Retry the same request to check its result.', 502); }
}
