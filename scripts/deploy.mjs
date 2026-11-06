// Deliberate deployment only. The unchanged legacy production config lacks the
// coordinator binding; deploying it with this code would disable support writes.
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const configAt = args.indexOf('--config');
const path = configAt >= 0 ? args[configAt + 1] : null;
if (!args.includes('--owner-approved') || !path || /wrangler\.local\./.test(path)) {
  console.error('Deployment requires a reviewed production JSON configuration and explicit owner approval. See docs/ROLLOUT.md.'); process.exit(1);
}
let config;
try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { console.error('Use a valid reviewed JSON configuration.'); process.exit(1); }
if (!config.durable_objects?.bindings?.some(binding => binding.name === 'SUPPORT_COORDINATOR') || !config.kv_namespaces?.some(binding => binding.binding === 'NOTES_KV') || config.vars?.VALIDATE_TWILIO_SIGNATURE !== 'true' || config.vars?.ENVIRONMENT !== 'production') {
  console.error('Reviewed production configuration must enable coordinated persistence and signature validation.'); process.exit(1);
}
execFileSync(process.execPath, ['scripts/knowledge-build.mjs', '--check'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-admin.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-store-admin.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-moola-admin.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/store-support-runtime.mjs'], { stdio: 'inherit' });
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', path, '--keep-vars'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
