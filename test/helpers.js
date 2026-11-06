import worker, { SupportCoordinator } from '../worker.js';
import { StagedStore } from '../persistence.js';
export class MemoryStorage {
  constructor() { this.values = new Map(); this.alarm = null; }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix = '', limit = Infinity } = {}) { return new Map([...this.values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); }
  async setAlarm(time) { this.alarm = time; }
  async transaction(fn) { const before = structuredClone(this.values); try { return await fn(this); } catch (error) { this.values = before; throw error; } }
}
export function memoryKV(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async delete(key) { values.delete(key); }, async list({ prefix = '' }) { return { keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
}
export function setup(overrides = {}, initial = {}) {
  const storage = new MemoryStorage();
  const env = { ENVIRONMENT: 'test', VALIDATE_TWILIO_SIGNATURE: 'false', COORDINATOR_BOOTSTRAP_APPROVED: 'true', NOTES_KV: memoryKV(initial), ...overrides };
  const coordinator = new SupportCoordinator({ storage }, env);
  env.SUPPORT_COORDINATOR = { idFromName: name => name, get: () => coordinator };
  let number = 0;
  const send = (message, from = 'whatsapp:+15550001111', sid = `SMtest${String(++number).padStart(10, '0')}`) => worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body: new URLSearchParams({ From: from, Body: message, MessageSid: sid }) }), env);
  return { env, storage, coordinator, send, store: () => new StagedStore(storage) };
}
export async function accessHeaders(overrides = {}) {
  const encode = value => Buffer.from(value instanceof Uint8Array ? value : JSON.stringify(value)).toString('base64url');
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey); publicJwk.kid = crypto.randomUUID();
  const payload = { iss: 'https://team.example.com', aud: ['dashboard-audience'], email: 'owner@example.com', exp: Math.floor(Date.now() / 1000) + 300, ...overrides };
  const unsigned = `${encode({ alg: 'RS256', kid: publicJwk.kid })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keys.privateKey, new TextEncoder().encode(unsigned));
  return { headers: { 'CF-Access-JWT-Assertion': `${unsigned}.${encode(new Uint8Array(signature))}` }, publicJwk };
}
export const adminConfig = { ADMIN_ACCESS_TEAM_DOMAIN: 'https://team.example.com', ADMIN_ACCESS_AUDIENCE: 'dashboard-audience', ADMIN_EMAILS: 'owner@example.com' };
