// Runs copied production records only in an ephemeral local workerd instance.
// No production bindings or provider secrets are supplied. No content is logged.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { accessHeaders, adminConfig } from '../test/helpers.js';
import { normalizeCase } from '../support-cases.js';
const directory = process.argv[2]; if (!directory) throw new Error('Supply a private preflight snapshot directory');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const records = JSON.parse(await readFile(join(directory, 'kv-second-pass.private.json'), 'utf8'));
assert.equal(createHash('sha256').update(JSON.stringify(records)).digest('hex'), manifest.snapshotSha256, 'Backup manifest checksum matches');
for (const record of records) assert.equal(createHash('sha256').update(Buffer.from(record.base64, 'base64')).digest('hex'), record.sha256, 'Individual record checksum matches');
const expected = records.filter(record => /^support-case:(?:PS|RS|SA|GS)-\d+$/.test(record.name)).map(record => {
  const parsed = JSON.parse(Buffer.from(record.base64, 'base64').toString());
  return normalizeCase(parsed, record.name.slice(13));
});
assert.ok(expected.every(Boolean), 'All backed-up case records normalize successfully');
const pairs = records.filter(r => r.name.startsWith('support-case:') || r.name.startsWith('conversation:mapping:')).map(r => [r.name, Buffer.from(r.base64, 'base64').toString()]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const expectedHash = createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
const auth = await accessHeaders(); let prohibitedCalls = 0;
const built = await build({ entryPoints: ['worker.js'], bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022' });
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-21', kvNamespaces: ['NOTES_KV'], durableObjects: { SUPPORT_COORDINATOR: { className: 'SupportCoordinator', useSQLite: true } }, bindings: { ...adminConfig, ENVIRONMENT: 'production', VALIDATE_TWILIO_SIGNATURE: 'true', TWILIO_AUTH_TOKEN: 'synthetic', COORDINATOR_BOOTSTRAP_APPROVED: 'true', CUTOVER_MODE: 'hold', MIGRATION_EXPECTED_SHA256: expectedHash }, outboundService: async request => {
  if (request.url === 'https://team.example.com/cdn-cgi/access/certs') return Response.json({ keys: [auth.publicJwk] });
  prohibitedCalls++; return new Response('External provider access disabled in rehearsal', { status: 403 });
} }));
try {
  const kv = await runtime.getKVNamespace('NOTES_KV');
  for (const record of records) {
    if (record.expiration && record.expiration <= Date.now() / 1000) continue;
    await kv.put(record.name, Buffer.from(record.base64, 'base64'), record.expiration ? { expiration: record.expiration } : {});
  }
  const control = action => runtime.dispatchFetch('https://local.example/api/admin/maintenance/' + action, { method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await runtime.dispatchFetch('https://local.example/admin/activate', auth)).status, 200);
  assert.equal((await control('prepare-production')).status, 200);
  assert.equal((await control('resume')).status, 200);
  assert.equal(JSON.parse(await kv.get('production-activation:latest')).mode, 'live');
  const response = await runtime.dispatchFetch('https://local.example/api/admin/cases', auth); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.total, expected.length);
  for (const before of expected) {
    const after = data.cases.find(item => item.case_id === before.case_id);
    assert.ok(Boolean(after), 'Original case ID remains visible');
    assert.ok(after.user_description === before.user_description, 'Case description preserved under normal sanitization');
    assert.ok(after.created_at === before.created_at, 'Case creation timestamp preserved');
    assert.ok(after.product === 'UNKNOWN', 'No unsupported product inferred for legacy case');
  }
  for (const record of records.filter(record => record.name.startsWith('conversation:mapping:'))) {
    const value = await kv.get(record.name); if (!record.expiration || record.expiration > Date.now() / 1000) assert.ok(value === Buffer.from(record.base64, 'base64').toString(), 'Original conversation mapping remains untouched');
  }
  const form = new URLSearchParams({ From: 'whatsapp:+15550009000', MessageSid: 'SMmigrationrehearsal0001', Body: 'PlaySmart spelling crashes when I press Start' });
  const signature = createHmac('sha1', 'synthetic').update('https://local.example/webhook/whatsapp' + [...form.keys()].sort().map(k => k + form.get(k)).join('')).digest('base64');
  const created = await runtime.dispatchFetch('https://local.example/webhook/whatsapp', { method: 'POST', headers: { 'X-Twilio-Signature': signature }, body: new URLSearchParams({ From: 'whatsapp:+15550009000', MessageSid: 'SMmigrationrehearsal0001', Body: 'PlaySmart spelling crashes when I press Start' }) });
  assert.equal(created.status, 200); const reply = await created.text(); const nextId = `PS-${String(manifest.nextCaseNumber).padStart(6, '0')}`; assert.ok(reply.includes(nextId), 'New allocation continues the production sequence');
  const repeated = await runtime.dispatchFetch('https://local.example/webhook/whatsapp', { method: 'POST', headers: { 'X-Twilio-Signature': signature }, body: new URLSearchParams({ From: 'whatsapp:+15550009000', MessageSid: 'SMmigrationrehearsal0001', Body: 'PlaySmart spelling crashes when I press Start' }) }); assert.ok(await repeated.text() === reply, 'Replay returns the committed response');
  const after = await (await runtime.dispatchFetch('https://local.example/api/admin/cases', auth)).json(); assert.equal(after.total, expected.length + 1);
  assert.equal(prohibitedCalls, 0, 'No external provider request was attempted');
  const report = { passed: true, snapshotDirectory: resolve(directory), originalCasesPreserved: expected.length, nextCaseId: nextId, duplicateReplay: 'passed', externalProviderCalls: prohibitedCalls, environment: 'ephemeral local workerd + SQLite Durable Object', completedAt: new Date().toISOString() };
  await writeFile(join(directory, 'rehearsal-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); console.log(JSON.stringify(report, null, 2));
} finally { await runtime.dispose(); }
