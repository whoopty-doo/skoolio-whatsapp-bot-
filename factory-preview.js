// Called only after the same Super Admin check as the Factory workspace.
export async function factoryPreviewResponse(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405, headers:{Allow:'GET, HEAD'}});
  if (!env.FACTORY_PREVIEW_ASSETS) return new Response('The PlaySmart preview player is not installed.', {status:503});
  const url = new URL(request.url);
  const protectedBase = '/api/admin/game-studio/learning/player/';
  const protectedPath = url.pathname.startsWith(protectedBase);
  if (protectedPath) url.pathname = '/factory-preview/' + url.pathname.slice(protectedBase.length);
  if (url.pathname === '/factory-preview/') url.pathname += 'index.html';
  // Forward only the path, never the admin assertion or browser cookies.
  const asset = await env.FACTORY_PREVIEW_ASSETS.fetch(new Request(url, {method:request.method}));
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'");
  let body = request.method === 'HEAD' ? null : asset.body;
  if (protectedPath && url.pathname === '/factory-preview/index.html' && asset.ok && request.method === 'GET') {
    body = (await asset.text()).replace('<base href="/factory-preview/">', '<base href="'+protectedBase+'">');
    headers.delete('Content-Length');
    headers.delete('ETag');
  }
  return new Response(body, {status:asset.status, headers});
}
