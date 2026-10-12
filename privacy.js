// Redaction is data minimization, not HTML escaping or a guarantee of anonymity.
export function sanitize(value, maxLength = 2000) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/\bBearer\s+[^\s,;"<>]+/gi, '[REDACTED_TOKEN]')
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\d+\|[A-Za-z0-9]{20,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(api[_ -]?key|access[_ -]?token|token|secret|password|license|licence|sanctum|authorization)\b["']?\s*(?::|=|\bis\b)\s*(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[REDACTED_NUMBER]')
    .replace(/\b(student|learner|parent|guardian)(?:\s+name)?\s*[:#=]\s*[^\n,;]+/gi, '$1: [REDACTED_NAME]')
    .replace(/\b(Student|Learner|Parent|Guardian)\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\b/g, '$1 [REDACTED_NAME]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim().slice(0, maxLength);
}
export const safeArray = (value, limit = 20) => Array.isArray(value) ? value.slice(0, limit).map(item => sanitize(item, 500)).filter(Boolean) : [];
export function parseObject(value) { try { const result = JSON.parse(value); return result && typeof result === 'object' && !Array.isArray(result) ? result : null; } catch { return null; } }
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function boundedFetch(url, options = {}, milliseconds = 8000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(milliseconds) });
}
