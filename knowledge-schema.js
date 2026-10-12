import { sanitize } from './privacy.js';

export const KNOWLEDGE_PRODUCTS = ['PLAYSMART', 'READSMART', 'SKOOLIO_ADMIN'];
export const KNOWLEDGE_VISIBILITIES = ['PUBLIC_SUPPORT', 'AUTHENTICATED_CUSTOMER', 'CENTRE_ADMIN', 'INTERNAL_SUPPORT'];
export const KNOWLEDGE_TYPES = ['OVERVIEW', 'HOW_TO', 'TROUBLESHOOTING', 'KNOWN_ISSUE', 'FEATURE', 'INSTALLATION', 'RELEASE_NOTE', 'INTERNAL_SUPPORT'];
const REQUIRED = ['id', 'product', 'module', 'title', 'content', 'document_type', 'version', 'updated_at', 'source', 'visibility', 'support_safe', 'keywords'];
const ALLOWED = new Set([...REQUIRED, 'troubleshooting', 'customer_reference', 'centre_reference']);
const TROUBLESHOOTING_FIELDS = ['symptoms', 'questions', 'safe_steps', 'collect_if_unresolved', 'escalate_as'];
// A guard, not a substitute for reviewing prose before publication.
export function containsSensitiveKnowledge(value) {
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => containsSensitiveKnowledge(key) || containsSensitiveKnowledge(item));
  if (typeof value !== 'string') return false;
  const text = value.replace(/\b(?:password|secret|api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*\[REDACTED(?:_[A-Z]+)?\]/gi, '');
  return /\b(?:sk-(?:proj-)?[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b|\bBearer\s+[^\s,;"<>]+|-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|\b(?:password|secret|api[_ -]?key|access[_ -]?token|authorization)\s*["']?\s*[:=]\s*["']?[^\s,;"'}]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+\d[\d ()-]{7,}\d|\b(?:postgres(?:ql)?|mysql|mongodb):\/\/|\b(?:student|learner|parent|guardian)(?:\s+name)?\s*[:=]\s*[^\n,;]+/i.test(text || '');
}
export function validateKnowledgeDocument(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['Document must be an object'];
  for (const key of REQUIRED) if (!Object.hasOwn(doc, key)) errors.push(`Missing ${key}`);
  for (const key of Object.keys(doc)) if (!ALLOWED.has(key)) errors.push(`Unknown field ${key}`);
  for (const [key, max] of Object.entries({ id: 120, module: 100, title: 180, content: 6000, version: 100, source: 1000 })) {
    if (typeof doc[key] !== 'string' || !doc[key].trim() || doc[key].length > max) errors.push(`Invalid ${key}`);
  }
  if (typeof doc.id === 'string' && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(doc.id)) errors.push('Invalid id format');
  if (!KNOWLEDGE_PRODUCTS.includes(doc.product)) errors.push('Invalid product');
  if (!KNOWLEDGE_TYPES.includes(doc.document_type)) errors.push('Invalid document_type');
  if (!KNOWLEDGE_VISIBILITIES.includes(doc.visibility)) errors.push('Invalid visibility');
  if (typeof doc.support_safe !== 'boolean') errors.push('Invalid support_safe');
  if (typeof doc.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(doc.updated_at) || !Number.isFinite(Date.parse(doc.updated_at)) || new Date(doc.updated_at).toISOString().slice(0, 10) !== doc.updated_at.slice(0, 10)) errors.push('Invalid updated_at');
  if (!Array.isArray(doc.keywords) || !doc.keywords.length || doc.keywords.length > 40 || doc.keywords.some(word => typeof word !== 'string' || !word.trim() || word.length > 100)) errors.push('Invalid keywords');
  for (const key of ['customer_reference', 'centre_reference']) if (doc[key] !== undefined && (typeof doc[key] !== 'string' || !doc[key] || doc[key].length > 120)) errors.push(`Invalid ${key}`);
  if (doc.document_type === 'TROUBLESHOOTING' && !doc.troubleshooting) errors.push('Troubleshooting record required');
  if (doc.troubleshooting !== undefined) {
    const t = doc.troubleshooting;
    if (!t || typeof t !== 'object' || Array.isArray(t)) errors.push('Invalid troubleshooting');
    else {
      for (const key of Object.keys(t)) if (!TROUBLESHOOTING_FIELDS.includes(key)) errors.push(`Unknown troubleshooting field ${key}`);
      for (const key of TROUBLESHOOTING_FIELDS.slice(0, 4)) if (!Array.isArray(t[key]) || !t[key].length || t[key].length > 10 || t[key].some(item => typeof item !== 'string' || !item.trim() || item.length > 400)) errors.push(`Invalid troubleshooting.${key}`);
      if (!['SUSPECTED_BUG', 'CONFIGURATION', 'SYNC', 'HUMAN_ASSISTANCE'].includes(t.escalate_as)) errors.push('Invalid troubleshooting.escalate_as');
    }
  }
  if (containsSensitiveKnowledge(doc)) errors.push('Potential secret or personal information; review the document');
  return errors;
}
export function isPublicKnowledge(doc) {
  return doc?.visibility === 'PUBLIC_SUPPORT' && doc.support_safe === true && doc.document_type !== 'INTERNAL_SUPPORT';
}
export function canReadKnowledge(doc, product, scope) {
  if (doc.product !== product || doc.support_safe !== true || doc.document_type === 'INTERNAL_SUPPORT' || doc.visibility === 'INTERNAL_SUPPORT') return false;
  if (isPublicKnowledge(doc)) return true;
  // The WhatsApp route never constructs this scope. Only trusted future identity
  // integration may provide it; a phone number or customer text is not identity.
  if (scope?.verified !== true || scope.product !== product || !scope.allowedDocumentIds?.includes(doc.id) || !doc.customer_reference || !doc.centre_reference || doc.customer_reference !== scope.customer_reference || doc.centre_reference !== scope.centre_reference) return false;
  return doc.visibility === 'AUTHENTICATED_CUSTOMER' || doc.visibility === 'CENTRE_ADMIN' && scope.role === 'CENTRE_ADMIN';
}
export function safeKnowledgeResult(doc, confidence) {
  const result = Object.fromEntries(['id', 'product', 'module', 'title', 'content', 'source', 'version', 'updated_at', 'document_type', 'visibility', 'support_safe'].map(key => [key, typeof doc[key] === 'string' && !['updated_at', 'version'].includes(key) ? sanitize(doc[key], key === 'content' ? 6000 : 1000) : doc[key]]));
  result.confidence = Math.max(0, Math.min(0.95, Number(confidence) || 0));
  if (doc.troubleshooting) result.troubleshooting = Object.fromEntries(Object.entries(doc.troubleshooting).map(([key, value]) => [key, Array.isArray(value) ? value.map(item => sanitize(item, 400)) : value]));
  return result;
}
