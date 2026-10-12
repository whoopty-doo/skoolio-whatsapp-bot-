import { sanitize, safeArray, parseObject } from './privacy.js';
import { normalizeProduct, PRODUCT_LABELS, CASE_PREFIXES } from './products.js';
export { sanitize } from './privacy.js';
export const CASE_STATUSES = ['NEW', 'NEEDS_INFORMATION', 'INVESTIGATING', 'CONFIRMED_BUG', 'FIX_IN_PROGRESS', 'FIX_READY', 'APPROVED', 'RELEASED', 'RESOLVED', 'CLOSED'];
export const CASE_CATEGORIES = ['GENERAL_SUPPORT', 'HOW_TO', 'ACCOUNT', 'CONFIGURATION', 'SYNC', 'LICENSING', 'INSTALLATION', 'HARDWARE', 'UI', 'PERFORMANCE', 'DATA', 'AUTHENTICATION', 'INTEGRATION', 'CRASH', 'SUSPECTED_BUG', 'FEATURE_REQUEST', 'HUMAN_ASSISTANCE', 'UNKNOWN'];
export const CASE_ID = /^(?:PS|RS|SA|GS)-\d{6,12}$/;
export const TERMINAL = ['CLOSED', 'RESOLVED', 'RELEASED'];
const aliases = { BUG: 'SUSPECTED_BUG', OTHER: 'UNKNOWN', DATABASE: 'DATA', ACTIVATION: 'LICENSING', PLATFORM: 'INSTALLATION' };
const textFields = ['user_description', 'ai_summary', 'feature_module', 'expected_behaviour', 'actual_behaviour', 'app_version', 'build_number', 'platform', 'os', 'architecture', 'route', 'screen', 'error_message', 'sync_status', 'database_status', 'owner_notes', 'customer_reference', 'centre_reference', 'coding_agent', 'repository', 'branch', 'pull_request', 'release', 'pending_question'];
const category = value => CASE_CATEGORIES.includes(value) ? value : aliases[value] || 'GENERAL_SUPPORT';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '1970-01-01T00:00:00.000Z';
export function normalizeCase(input, expectedId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  // Early production cases used camelCase. Adapt on read without rewriting KV
  // or assigning a product/reporter identity that the legacy record never had.
  input = { ...input };
  for (const field of [...textFields, 'case_id', 'updated_at', 'reproduction_steps', 'sanitized_logs', 'conversation_reference', 'reporter_whatsapp_identifier']) {
    const legacy = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    if (input[field] === undefined && input[legacy] !== undefined) input[field] = input[legacy];
  }
  if (input.created_at === undefined) input.created_at = input.timestamp;
  if (!input.error_message && Array.isArray(input.sanitizedErrors)) input.error_message = safeArray(input.sanitizedErrors).join('\n');
  if (!CASE_ID.test(input.case_id) || (expectedId && input.case_id !== expectedId)) return null;
  const result = { schemaVersion: 2, case_id: input.case_id, product: normalizeProduct(input.product), created_at: date(input.created_at), updated_at: date(input.updated_at || input.created_at), revision: Number.isSafeInteger(input.revision) ? input.revision : 0,
    status: CASE_STATUSES.includes(input.status) ? input.status : 'NEW', category: category(input.category), severity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(input.severity) ? input.severity : 'MEDIUM', confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    reporter_whatsapp_identifier: /^whatsapp:\+\d{8,15}$/.test(input.reporter_whatsapp_identifier) ? input.reporter_whatsapp_identifier : '[REDACTED]',
    reproduction_steps: safeArray(input.reproduction_steps), sanitized_logs: safeArray(input.sanitized_logs), related_cases: safeArray(input.related_cases).filter(id => CASE_ID.test(id)),
    conversation_reference: { channel: input.conversation_reference?.channel === 'app' ? 'app' : 'whatsapp', conversationId: input.conversation_reference?.channel === 'app' && /^[a-f0-9]{64}$/.test(input.conversation_reference?.conversationId) ? input.conversation_reference.conversationId : sanitize(input.conversation_reference?.conversationId, 80), messageCount: Number.isSafeInteger(input.conversation_reference?.messageCount) ? input.conversation_reference.messageCount : 0 },
    technical_investigation: { result: sanitize(input.technical_investigation?.result, 60), evidence: safeArray(input.technical_investigation?.evidence), tests: safeArray(input.technical_investigation?.tests) },
    approval: input.approval?.approved_by ? { approved_by: sanitize(input.approval.approved_by, 100), approved_at: date(input.approval.approved_at), revision: input.approval.revision } : null,
    history: Array.isArray(input.history) ? input.history.slice(-100).map(event => ({ at: date(event.at), actor: sanitize(event.actor, 100), action: sanitize(event.action, 150), detail: sanitize(event.detail, 1000) })) : [] };
  for (const field of textFields) result[field] = sanitize(input[field], field === 'user_description' ? 4000 : 2000);
  return result;
}
export class CaseRepository {
  constructor(kv) { this.kv = kv; }
  async create(input) {
    if (!this.kv?.atomicWrites) throw new Error('Coordinated persistence is required');
    const raw = await this.kv.get('support-case:sequence');
    const sequence = Number(raw || 0);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= 999999999999) throw new Error('Invalid case sequence');
    const caseId = `${CASE_PREFIXES[normalizeProduct(input.product)]}-${String(sequence + 1).padStart(6, '0')}`;
    if (await this.kv.get(`support-case:${caseId}`)) throw new Error('Case sequence collision');
    const now = new Date().toISOString();
    const snake = { ...input };
    for (const [key, value] of Object.entries(input)) snake[key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)] = value;
    snake.reporter_whatsapp_identifier = input.reporterWhatsappIdentifier || input.reporter_whatsapp_identifier;
    const supportCase = normalizeCase({ ...snake, case_id: caseId, created_at: now, updated_at: now, revision: 1, status: 'NEW', history: [{ at: now, actor: 'support', action: 'CASE_CREATED', detail: 'Support case recorded' }] });
    await this.kv.put('support-case:sequence', String(sequence + 1));
    await this.kv.put(`support-case:${caseId}`, JSON.stringify(supportCase));
    await this.kv.put(`support-event:${caseId}:000000000001`, JSON.stringify(supportCase.history[0]));
    return supportCase;
  }
  async get(caseId) {
    if (!CASE_ID.test(caseId)) return null;
    return normalizeCase(parseObject(await this.kv.get(`support-case:${caseId}`)), caseId);
  }
  async list() {
    const cases = []; let cursor;
    do {
      const page = await this.kv.list({ prefix: 'support-case:', cursor });
      for (const key of page.keys) {
        const id = key.name.slice('support-case:'.length);
        if (!CASE_ID.test(id)) continue;
        const item = await this.get(id);
        if (item) cases.push(item);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return cases.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.case_id.localeCompare(a.case_id));
  }
  async update(caseId, changes, { revision, actor = 'support', action = 'UPDATED', detail = '' } = {}) {
    if (!this.kv?.atomicWrites) throw new Error('Coordinated persistence is required');
    const existing = await this.get(caseId);
    if (!existing) return null;
    if (revision !== undefined && revision !== existing.revision) { const error = new Error('This case changed. Reload it before saving.'); error.status = 409; throw error; }
    const now = new Date().toISOString();
    const updated = normalizeCase({ ...existing, ...changes, case_id: caseId, created_at: existing.created_at, updated_at: now, revision: existing.revision + 1, history: [...existing.history, { at: now, actor, action, detail }] });
    await this.kv.put(`support-case:${caseId}`, JSON.stringify(updated));
    await this.kv.put(`support-event:${caseId}:${String(updated.revision).padStart(12, '0')}`, JSON.stringify(updated.history.at(-1)));
    return updated;
  }
}
export function validateTransition(existing, changes, human = false) {
  const next = changes.status || existing.status;
  if (!CASE_STATUSES.includes(next)) return 'Invalid status';
  if (!human && changes.status !== undefined && ['APPROVED', 'RELEASED'].includes(next)) return 'Human approval is required';
  const combined = { ...existing, ...changes };
  if (['CONFIRMED_BUG', 'FIX_IN_PROGRESS', 'FIX_READY', 'APPROVED'].includes(next) && (combined.technical_investigation?.result !== 'CONFIRMED_BUG' || !combined.technical_investigation?.evidence?.length)) return 'Technical confirmation and evidence are required';
  if (['FIX_READY', 'APPROVED'].includes(next) && (!/^https:\/\//.test(combined.pull_request) || !combined.technical_investigation?.tests?.length)) return 'A pull request and validation results are required';
  if (next === existing.status) return null;
  const transitions = {
    NEW: ['NEEDS_INFORMATION', 'INVESTIGATING', 'RESOLVED', 'CLOSED'],
    NEEDS_INFORMATION: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
    INVESTIGATING: ['NEEDS_INFORMATION', 'CONFIRMED_BUG', 'RESOLVED', 'CLOSED'],
    CONFIRMED_BUG: ['NEEDS_INFORMATION', 'FIX_IN_PROGRESS', 'CLOSED'],
    FIX_IN_PROGRESS: ['NEEDS_INFORMATION', 'FIX_READY', 'CLOSED'],
    FIX_READY: ['FIX_IN_PROGRESS', 'APPROVED', 'CLOSED'], APPROVED: ['FIX_IN_PROGRESS', 'RELEASED'],
    RELEASED: ['RESOLVED', 'CLOSED', 'INVESTIGATING'], RESOLVED: ['CLOSED', 'INVESTIGATING'], CLOSED: ['INVESTIGATING']
  };
  if (!transitions[existing.status]?.includes(next)) return `Cannot move from ${existing.status} to ${next}`;
  if (['APPROVED', 'RELEASED'].includes(next) && !human) return 'Human approval is required';
  if (next === 'NEEDS_INFORMATION' && !combined.pending_question) return 'A question is required';
  if (next === 'CONFIRMED_BUG' && (combined.technical_investigation?.result !== 'CONFIRMED_BUG' || !combined.technical_investigation?.evidence?.length)) return 'Technical confirmation and evidence are required';
  if (next === 'FIX_READY' && (!/^https:\/\//.test(combined.pull_request) || !combined.technical_investigation?.tests?.length)) return 'A pull request and validation results are required';
  if (next === 'RELEASED' && (!existing.approval || !combined.release)) return 'Recorded approval and a release reference are required';
  return null;
}
export class TriageDraftStore {
  constructor(kv) { this.kv = kv; }
  async get(key) { return parseObject(await this.kv.get(`support-triage:${key}`)); }
  async put(key, draft) { await this.kv.put(`support-triage:${key}`, JSON.stringify(draft), { expirationTtl: 604800 }); }
  async clear(key) { await this.kv.delete(`support-triage:${key}`); }
}
export function ownerNotification(item) {
  return `SKOOLIO AI SUPPORT\n${item.case_id}\nProduct: ${PRODUCT_LABELS[item.product]}\nStatus: ${item.status}\nSeverity: ${item.severity}\nCategory: ${item.category}\nArea: ${item.feature_module || 'Unknown'}\n${sanitize(item.ai_summary || item.user_description, 700)}`;
}
export function statusUpdateNotification(item, question) {
  if (item.status === 'NEEDS_INFORMATION') return `One more detail for ${item.case_id} (${PRODUCT_LABELS[item.product]}): ${sanitize(question || item.pending_question, 500)}`;
  return `Update on ${item.case_id} (${PRODUCT_LABELS[item.product]}): ${item.status.replaceAll('_', ' ').toLowerCase()}. ${item.status === 'FIX_READY' ? 'The proposed fix is awaiting human review.' : 'You can reply here with any questions.'}`;
}
export function createCodingAgentCaseHandoff(item) {
  return { event: 'skoolio.support_case.created', version: 2, case_id: item.case_id, product: item.product, status: item.status, category: item.category, severity: item.severity, conversation_reference: item.conversation_reference, created_at: item.created_at, execution: 'DISABLED' };
}
