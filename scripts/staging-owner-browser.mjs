// Dedicated visible browser for owner-authorized staging checks. No existing
// browser profile, cookies, credentials or session tokens are read or printed.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, chmod, unlink, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
const directory = resolve('.artifacts/staging-owner-browser');
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
const browser = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${directory}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => { let output = ''; const timeout = setTimeout(() => reject(new Error('Dedicated browser startup timed out')), 20000); browser.stderr.on('data', bytes => { output += bytes; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } }); browser.on('error', reject); });
  socket = new WebSocket(endpoint); await new Promise(resolve => socket.once('open', resolve));
  socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'https://skoolio-support-staging.cowleyjared.workers.dev/admin' } }));
  const target = await new Promise(resolve => socket.on('message', raw => { const data = JSON.parse(raw); if (data.id === 1) resolve(data.result.targetId); }));
  await writeFile(`${directory}/connection.private.json`, JSON.stringify({ endpoint, target }), { mode: 0o600 });
  console.log('Dedicated staging browser opened. Sign in through Cloudflare Access as the allowed owner. No session tokens will be printed.');
  await new Promise(resolve => browser.once('exit', resolve));
} finally {
  socket?.close(); await unlink(`${directory}/connection.private.json`).catch(() => {});
  if (browser.exitCode === null) { browser.kill(); await new Promise(resolve => browser.once('exit', resolve)); }
  await rm(`${directory}/profile`, { recursive: true, force: true });
}
