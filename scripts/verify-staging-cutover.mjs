// Read-only remote binding and KV verification; logs counts/IDs, never secrets.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const directory = process.argv[2]; if (!directory?.startsWith('.artifacts/staging-cutover/')) throw new Error('Supply the private staging cutover report directory');
const report = JSON.parse(await readFile(`${directory}/report.json`, 'utf8'));
const config = JSON.parse(await readFile('wrangler.staging.json', 'utf8'));
const production = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
assert.equal(config.name, 'skoolio-support-staging');
const token = (await readFile('/Users/jaredcowley/Library/Preferences/.wrangler/config/default.toml', 'utf8')).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Cloudflare login required');
const base = 'https://api.cloudflare.com/client/v4/accounts/9a735099f119c54fac3674b6d165b5c9';
const get = async path => { const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error(`Read-only staging verification HTTP ${response.status}`); const data = await response.json(); if (!data.success) throw new Error('Cloudflare read-only verification failed'); return data; };
const settings = (await get(`/workers/scripts/${config.name}/settings`)).result;
const names = new Set(settings.bindings.map(binding => binding.name));
for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_WHATSAPP_FROM', 'OWNER_WHATSAPP_NUMBER', 'OPENAI_API_KEY']) assert.equal(names.has(name), false, `No live provider binding ${name}`);
const productionIDs = new Set(production.kv_namespaces.map(binding => binding.id));
const namespaces = ['NOTES_KV', 'RECOVERY_KV'].map(name => {
  const binding = settings.bindings.find(binding => binding.name === name && binding.type === 'kv_namespace');
  assert.ok(binding && !productionIDs.has(binding.namespace_id)); return { name, id: binding.namespace_id };
});
assert.notEqual(namespaces[0].id, namespaces[1].id);
const list = async id => { const keys = []; let cursor; do { const response = await get(`/storage/kv/namespaces/${id}/keys?prefix=support-case%3APS-&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); keys.push(...response.result.map(key => key.name)); cursor = response.result_info?.cursor; } while (cursor); return keys.sort(); };
let lists;
for (let attempt = 0; attempt < 12; attempt++) {
  lists = await Promise.all(namespaces.map(ns => list(ns.id)));
  if (lists.every(keys => keys.length === report.finalCases && report.syntheticCaseIds.every(id => keys.includes(`support-case:${id}`)))) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.deepEqual(lists[0], lists[1], 'Primary and recovered case mirrors match');
assert.equal(lists[0].length, report.finalCases);
const deployments = (await get(`/workers/scripts/${config.name}/deployments`)).result;
const result = { verifiedAt: new Date().toISOString(), namespaces: namespaces.map((ns, i) => ({ binding: ns.name, id: ns.id, cases: lists[i].length })), liveProviderBindings: false, productionNamespaceBound: false, deployment: deployments.deployments?.[0]?.versions || null };
await writeFile(`${directory}/remote-verification.json`, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
