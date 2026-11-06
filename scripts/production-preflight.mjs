// Read-only Cloudflare inspection and a private local snapshot. Never mutates
// remote configuration, KV, Workers, provider credentials or customer messages.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
if (!args.includes('--account') || !/^[a-f0-9]{32}$/.test(arg('--account'))) throw new Error('Supply --account with the Cloudflare account identifier');
const account = arg('--account');
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
if (config.name !== 'skoolio-whatsapp-bot') throw new Error('Unexpected production Worker');
const auth = await readFile('/Users/jaredcowley/Library/Preferences/.wrangler/config/default.toml', 'utf8');
const token = process.env.CLOUDFLARE_API_TOKEN || auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Cloudflare login is required');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function response(path) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Read-only Cloudflare request failed (${response.status}) for ${path.split('?')[0]}`);
  return response;
}
async function get(path) { const data = await (await response(path)).json(); if (!data.success) throw new Error('Cloudflare returned an unsuccessful result'); return data.result; }
const script = `/workers/scripts/${config.name}`;
const [settings, deployments, subdomain, domains] = await Promise.all([get(script + '/settings'), get(script + '/deployments'), get(script + '/subdomain'), get('/workers/domains')]);
const bindings = settings.bindings || [];
const namespace = bindings.find(binding => binding.name === 'NOTES_KV' && binding.type === 'kv_namespace')?.namespace_id;
if (!namespace || !/^[a-f0-9]{32}$/.test(namespace)) throw new Error('Production NOTES_KV binding missing');
const snapshotDir = resolve('.artifacts/production-backups', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(snapshotDir, { recursive: true, mode: 0o700 }); await chmod(snapshotDir, 0o700);
async function save(name, data) { const path = join(snapshotDir, name); await writeFile(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); return path; }
await save('worker-settings.private.json', settings);
await save('worker-deployments.private.json', deployments);
await save('worker-routing.private.json', { subdomain, domains: domains.filter(domain => domain.service === config.name) });
const sourceResponse = await response(script + '/content/v2');
const source = Buffer.from(await sourceResponse.arrayBuffer());
await save('deployed-worker.private.bin', source);
await save('deployed-worker-metadata.json', { contentType: sourceResponse.headers.get('content-type'), sha256: createHash('sha256').update(source).digest('hex') });
async function listKeys() {
  const keys = []; let cursor;
  do {
    const url = `/storage/kv/namespaces/${namespace}/keys?limit=1000` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const data = await (await response(url)).json(); if (!data.success) throw new Error('KV listing failed'); keys.push(...data.result); cursor = data.result_info?.cursor;
  } while (cursor);
  return keys.sort((a, b) => a.name.localeCompare(b.name));
}
async function snapshot() {
  const keys = await listKeys(); const records = [];
  for (const key of keys) {
    const value = Buffer.from(await (await response(`/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key.name)}`)).arrayBuffer());
    records.push({ ...key, base64: value.toString('base64'), sha256: createHash('sha256').update(value).digest('hex') });
  }
  return records;
}
const started = new Date().toISOString();
const first = await snapshot(); await save('kv-first-pass.private.json', first);
const second = await snapshot(); await save('kv-second-pass.private.json', second);
const signature = records => createHash('sha256').update(JSON.stringify(records)).digest('hex');
const counts = { caseKeys: 0, parseableCases: 0, legacyCases: 0, malformedCases: 0, conversationMappings: 0, triageDrafts: 0, otherKeys: 0 };
let highestCaseId = 0; let sequence = null;
for (const record of second) {
  const match = record.name.match(/^support-case:(?:PS|RS|SA|GS)-(\d{6,12})$/);
  if (match) { counts.caseKeys++; highestCaseId = Math.max(highestCaseId, Number(match[1])); try { const value = JSON.parse(Buffer.from(record.base64, 'base64').toString('utf8')); if ((value?.case_id ?? value?.caseId) !== record.name.slice(13)) throw new Error('Mismatched ID'); counts.parseableCases++; if (!value.case_id && value.caseId) counts.legacyCases++; } catch { counts.malformedCases++; } }
  else if (record.name === 'support-case:sequence') sequence = Number(Buffer.from(record.base64, 'base64').toString('utf8'));
  else if (record.name.startsWith('conversation:mapping:')) counts.conversationMappings++;
  else if (record.name.startsWith('support-triage:')) counts.triageDrafts++;
  else counts.otherKeys++;
}
const safeVarNames = new Set(['OPENAI_MODEL', 'VALIDATE_TWILIO_SIGNATURE', 'CONVERSATION_RETENTION_SECONDS']);
const publicVars = Object.fromEntries(bindings.filter(binding => binding.type === 'plain_text' && safeVarNames.has(binding.name)).map(binding => [binding.name, binding.text]));
const publicRouting = domains.filter(domain => domain.service === config.name).map(({ hostname, zone_id }) => ({ hostname, zone_id }));
const report = { worker: config.name, account, namespace, localNamespaceMatches: config.kv_namespaces.some(binding => binding.binding === 'NOTES_KV' && binding.id === namespace), started, completed: new Date().toISOString(), snapshotDirectory: snapshotDir, counts, sequence, highestCaseId, nextCaseNumber: Number.isSafeInteger(sequence) ? Math.max(sequence, highestCaseId) + 1 : null, twoPassesMatch: signature(first) === signature(second), snapshotSha256: signature(second), sourceSha256: createHash('sha256').update(source).digest('hex'), bindings: bindings.map(({name,type})=>({name,type})), safeVars: publicVars, compatibilityDate: settings.compatibility_date, compatibilityFlags: settings.compatibility_flags, customDomains: publicRouting, subdomain, currentDeployment: deployments.deployments?.[0] || deployments[0] || null, note: 'Read-only live snapshot, not an atomic or quiesced migration backup. Secret values cannot be exported from Worker secret bindings.' };
await save('manifest.json', report);
console.log(JSON.stringify(report, null, 2));
