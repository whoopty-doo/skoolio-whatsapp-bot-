// Short-lived, read-only trace. Never prints or persists message bodies, request
// headers, phone numbers, query strings, provider error text or credentials.
import { sanitize } from '../privacy.js';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = '.artifacts/diagnostics';
await mkdir(directory, { recursive: true, mode: 0o700 });
const records = []; let buffer = ''; let connected = false; let stopping = false;
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'tail', 'skoolio-whatsapp-bot', '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_LOG_PATH: '/private/tmp/skoolio-wrangler-logs' } });
const flags = text => ({ timeout: /timed?\s*out|timeout|deadline/i.test(text), signature: /signature/i.test(text), openai: /openai/i.test(text), twilio: /twilio/i.test(text), resourceLimit: /exceed.*(?:cpu|memory|resource)|cpu.*limit/i.test(text) });
function consume(event) {
  const request = event.event?.request;
  let path = 'BACKGROUND';
  if (request?.url) { try { path = new URL(request.url).pathname; } catch { return; } }
  if (!['/webhook/whatsapp', '/health', '/', 'BACKGROUND'].includes(path)) path = path.startsWith('/api/admin/') ? '/api/admin/*' : path.startsWith('/admin') ? '/admin*' : 'OTHER_ROUTE';
  if (!connected) { connected = true; console.log('Production trace connected. Request metadata only.'); }
  const text = JSON.stringify({ logs: event.logs, exceptions: event.exceptions });
  const record = { observedAt: new Date().toISOString(), requestTimestamp: event.eventTimestamp, method: request?.method || 'ALARM', path, status: event.event?.response?.status ?? null, outcome: event.outcome, wallTimeMs: event.wallTime ?? event.wallTimeMs ?? null, exceptionCount: event.exceptions?.length || 0, errorLogCount: event.logs?.filter(item => item.level === 'error').length || 0, diagnosticFlags: flags(text), scriptVersion: event.scriptVersion?.id ?? null };
  record.exceptions = (event.exceptions || []).map(error => sanitize(String(error.message || error.name || 'Exception').replace(/https?:\/\/[^\s]+/g, '[URL]'), 300));
  record.media = (event.logs || []).flatMap(log => log.message || []).flatMap(value => { try { const item = typeof value === 'string' ? JSON.parse(value) : value; return ['media_extraction_failed', 'notification_outcome', 'media_delivery_summary'].includes(item?.event) ? [{ event: item.event, outcomes: item.outcomes, reason: item.reason, kind: item.kind, code: item.code, stage: item.stage, status: item.status, retry: item.retry, attempt: item.attempt }] : []; } catch { return []; } });
  records.push(record); console.log(JSON.stringify(record));
}
function parse() {
  while (true) {
    const start = buffer.indexOf('{'); if (start < 0) { buffer = buffer.slice(-1000); return; }
    let depth = 0; let string = false; let escaped = false; let end = -1;
    for (let i = start; i < buffer.length; i++) {
      const char = buffer[i];
      if (string) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') string = false; }
      else if (char === '"') string = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) { buffer = buffer.slice(start); return; }
    const candidate = buffer.slice(start, end); buffer = buffer.slice(end);
    try { consume(JSON.parse(candidate)); } catch {}
  }
}
child.stdout.on('data', bytes => { buffer += bytes.toString(); parse(); });
child.stderr.on('data', bytes => {
  const text = bytes.toString();
  if (/connected to|successfully created tail/i.test(text)) console.log('Tail session established; waiting for request metadata.');
  if (/authentication error|unauthorized|not authenticated|error.*10000/i.test(text)) console.log('Cloudflare authentication needs attention; trace not verified.');
});
child.on('error', () => { console.error('Unable to start the production trace.'); process.exitCode = 1; });
const probe = setInterval(async () => { if (connected || stopping) return; try { await fetch('https://ai.skoolio.co.za/health', { signal: AbortSignal.timeout(5000) }); } catch {} }, 5000);
const timeout = setTimeout(() => { stopping = true; child.kill('SIGINT'); }, 600000);
process.on('SIGINT', () => { stopping = true; child.kill('SIGINT'); });
await new Promise(resolve => child.once('exit', resolve));
clearTimeout(timeout); clearInterval(probe);
await writeFile(`${directory}/production-trace-${Date.now()}.json`, JSON.stringify({ records, connected }, null, 2) + '\n', { mode: 0o600 });
console.log(`Trace finished. ${records.filter(record => record.path !== '/health').length} non-health requests observed. Metadata saved privately.`);
