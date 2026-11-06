// Each request stages writes, then commits them together in the coordinator's
// durable transaction. A process-local mutex alone would not make Workers KV safe.
export class StagedStore {
  constructor(storage) { this.storage = storage; this.writes = new Map(); this.atomicWrites = true; }
  async get(key) {
    const item = this.writes.has(key) ? this.writes.get(key) : await this.storage.get(`record:${key}`);
    return item && (!item.expires || item.expires > Date.now()) ? item.value : null;
  }
  async put(key, value, options = {}) { this.writes.set(key, { value, expires: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null }); }
  async delete(key) { this.writes.set(key, null); }
  async list({ prefix = '', cursor, limit = 500 } = {}) {
    const stored = await this.storage.list({ prefix: `record:${prefix}` });
    const names = new Set([...stored.keys()].map(key => key.slice(7)));
    for (const key of this.writes.keys()) if (key.startsWith(prefix)) names.add(key);
    const keys = [];
    for (const name of [...names].sort()) if ((!cursor || name > cursor) && await this.get(name) !== null) keys.push({ name });
    const page = keys.slice(0, limit);
    return { keys: page, list_complete: keys.length <= limit, cursor: page.at(-1)?.name };
  }
  async commit(checkpoint) {
    await this.storage.transaction(async transaction => {
      for (const [key, item] of this.writes) {
        if (item === null) await transaction.delete(`record:${key}`);
        else await transaction.put(`record:${key}`, item);
        // Mirror cases and their sequence to the original KV, never raw drafts.
        if (key.startsWith('support-case:')) await transaction.put(`mirror:${key}`, item || { deleted: true });
      }
      // A heartbeat also performs expiry cleanup; it is installed atomically.
      if (this.writes.size) await transaction.setAlarm(Date.now() + 1000);
      if (checkpoint) await checkpoint(transaction);
    });
  }
}
export async function bootstrap(storage, kv, approved) {
  if (await storage.get('initialized')) return;
  if (!approved || !kv) throw new Error('Coordinator bootstrap requires approved, quiesced migration');
  const imports = new Map(); let maximum = 0;
  for (const prefix of ['support-case:', 'conversation:mapping:', 'support-triage:']) {
    let cursor;
    do {
      const page = await kv.list({ prefix, cursor });
      for (const key of page.keys) {
        const value = await kv.get(key.name);
        if (value === null) continue;
        if (key.name === 'support-case:sequence') {
          const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid legacy sequence'); maximum = Math.max(maximum, n);
        }
        const match = key.name.match(/^support-case:(?:PS|RS|SA|GS)-(\d{6,12})$/);
        if (match) maximum = Math.max(maximum, Number(match[1]));
        // Old triage drafts may contain unsanitized personal data: expire rather than import.
        if (prefix === 'support-triage:') continue;
        imports.set(`record:${key.name}`, { value, expires: key.expiration ? key.expiration * 1000 : null });
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  imports.set('record:support-case:sequence', { value: String(maximum), expires: null });
  await storage.transaction(async transaction => {
    for (const [key, value] of imports) await transaction.put(key, value);
    await transaction.put('initialized', new Date().toISOString());
    await transaction.setAlarm(Date.now() + 1000);
  });
}
