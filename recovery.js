import { digest } from './privacy.js';
export async function validateSnapshot(snapshot) {
  const payload = snapshot?.payload;
  if (payload?.format !== 'skoolio-coordinator-v1' || !Array.isArray(payload.entries) || payload.entries.length > 10000 || snapshot.sha256 !== await digest(JSON.stringify(payload))) throw new Error('Invalid snapshot or checksum');
  const keys = new Set();
  for (const entry of payload.entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid snapshot entry');
    const [key, value] = entry;
    if (typeof key !== 'string' || keys.has(key) || !(key.startsWith('record:') || key.startsWith('mirror:') || key.startsWith('held:') || ['initialized', 'maintenance:mode', 'maintenance:sequence'].includes(key))) throw new Error('Invalid or duplicate snapshot key');
    keys.add(key);
    if (key.startsWith('record:') && (!value || typeof value.value !== 'string' || !(value.expires === null || Number.isFinite(value.expires)))) throw new Error('Invalid record envelope');
    if (key.startsWith('held:') && (!value || !['PENDING', 'PROCESSED'].includes(value.status) || !Number.isSafeInteger(value.sequence) || value.sequence < 1)) throw new Error('Invalid held message');
    if (key.startsWith('held:') && value.status === 'PENDING' && (!/^whatsapp:\+\d{8,15}$/.test(value.from) || !/^[A-Za-z0-9_-]{8,100}$/.test(value.sid) || typeof value.body !== 'string' || value.body.length > 4000 || !Number.isFinite(value.receivedAt))) throw new Error('Invalid held message body');
  }
  // Checksums detect corruption; they do not authenticate the file's origin.
  return payload;
}
export async function restoreSnapshot(storage, snapshot) {
  const payload = await validateSnapshot(snapshot);
  const existing = await storage.list({ limit: 2 });
  if ([...existing.keys()].some(key => key !== 'maintenance:mode')) throw new Error('Restore requires an empty, isolated coordinator');
  await storage.transaction(async tx => {
    for (const [key, original] of payload.entries) {
      let value = original;
      if (key.startsWith('record:outbox:')) {
        const job = JSON.parse(value.value);
        if (job.status === 'SENDING') value = { ...value, value: JSON.stringify({ ...job, status: 'UNCERTAIN', reason: 'RECOVERED_INTERRUPTED_SEND' }) };
      }
      await tx.put(key, value);
    }
    // Rebuild every case mirror, including legacy cases that had no pending
    // mirror at snapshot time. Recovery may use an empty KV namespace.
    for (const [key, value] of payload.entries) if (key.startsWith('record:support-case:')) {
      await tx.put(`mirror:${key.slice(7)}`, value.expires && value.expires <= Date.now() ? { deleted: true } : value);
    }
    // Restoring never resumes traffic or sends messages automatically.
    await tx.put('maintenance:mode', 'hold');
    await tx.setAlarm(Date.now() + 60000);
  });
  return { restored: payload.entries.length, mode: 'hold' };
}
export async function readSnapshot(request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Snapshot required');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('Snapshot exceeds recovery size limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
