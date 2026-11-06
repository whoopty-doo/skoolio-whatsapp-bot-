// Read-only, metadata-only observation of the owner-authenticated activation.
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('wrangler.production.reviewed.json', 'utf8'));
const auth = await readFile('/Users/jaredcowley/Library/Preferences/.wrangler/config/default.toml', 'utf8');
const token = process.env.CLOUDFLARE_API_TOKEN || auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Cloudflare login required');
const namespace = config.kv_namespaces.find(x => x.binding === 'NOTES_KV').id;
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/storage/kv/namespaces/${namespace}/values/production-activation%3Alatest`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
if (response.status === 404) console.log(JSON.stringify({ status: 'Awaiting owner activation' }));
else {
  if (!response.ok) throw new Error(`Status lookup failed (${response.status})`);
  const r = await response.json();
  console.log(JSON.stringify({ mode: r.mode, verified: r.verified, cases: r.cases, nextCaseNumber: r.nextCaseNumber, verifiedAt: r.verifiedAt, activatedAt: r.activatedAt }, null, 2));
}
