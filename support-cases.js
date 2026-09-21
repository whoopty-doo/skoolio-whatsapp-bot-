const memoryCases = [];
let memorySequence = 0;

const CASE_STATUSES = ['NEW', 'INVESTIGATING', 'NEEDS_INFORMATION', 'CONFIRMED_BUG', 'FIX_IN_PROGRESS', 'FIX_READY', 'APPROVED', 'RELEASED', 'CLOSED'];
const CASE_CATEGORIES = ['AUTHENTICATION', 'ACTIVATION', 'LICENSING', 'STUDENT_MANAGEMENT', 'LESSON', 'READING', 'SPELLING', 'PERCEPTUAL_READING', 'PERCEPTUAL_SPELLING', 'COMPREHENSION', 'EYE_KINETICS', 'EVALUATION', 'RESULTS', 'SETTINGS', 'PARENT', 'CENTRE', 'SYNC', 'DATABASE', 'PLATFORM', 'PERFORMANCE', 'OTHER'];

function sanitize(value, maxLength = 1000) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]')
    .replace(/(?:api[_-]?key|token|secret|password|license|licence)[\s:=]+[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_PHONE]')
    .replace(/\b(?:student|learner|parent|guardian)\s*[:#-]?\s*[A-Z][A-Za-z' -]{1,40}\b/gi, '$1 [REDACTED_NAME]')
    .trim()
    .slice(0, maxLength);
}

function normalizeCategory(value) {
  const category = String(value || 'OTHER').toUpperCase().replace(/[^A-Z_]/g, '_');
  return CASE_CATEGORIES.includes(category) ? category : 'OTHER';
}

function normalizeSeverity(value) {
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : 'MEDIUM';
}

class CaseIdAllocator {
  constructor(kv) {
    this.kv = kv;
  }

  async next() {
    if (!this.kv) {
      memorySequence += 1;
      return `PS-${String(memorySequence).padStart(6, '0')}`;
    }
    const nextValue = Number(await this.kv.get('support-case:sequence') || '0') + 1;
    await this.kv.put('support-case:sequence', String(nextValue));
    return `PS-${String(nextValue).padStart(6, '0')}`;
  }
}

class CaseRepository {
  constructor(kv) {
    this.kv = kv;
  }

  async create(input) {
    const caseId = await new CaseIdAllocator(this.kv).next();
    const now = new Date().toISOString();
    const supportCase = {
      schemaVersion: 1,
      caseId,
      timestamp: now,
      updatedAt: now,
      userDescription: sanitize(input.userDescription),
      aiSummary: sanitize(input.aiSummary),
      category: normalizeCategory(input.category),
      severity: normalizeSeverity(input.severity),
      confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
      reproductionSteps: (input.reproductionSteps || []).map((step) => sanitize(step, 300)).slice(0, 8),
      expectedBehaviour: sanitize(input.expectedBehaviour, 500),
      actualBehaviour: sanitize(input.actualBehaviour, 500),
      appVersion: sanitize(input.appVersion, 80),
      buildNumber: sanitize(input.buildNumber, 40),
      platform: sanitize(input.platform, 40),
      os: sanitize(input.os, 80),
      architecture: sanitize(input.architecture, 40),
      route: sanitize(input.route, 120),
      screen: sanitize(input.screen, 120),
      sanitizedLogs: (input.sanitizedLogs || []).map((entry) => sanitize(entry, 500)).slice(0, 10),
      sanitizedErrors: (input.sanitizedErrors || []).map((entry) => sanitize(entry, 500)).slice(0, 10),
      syncStatus: sanitize(input.syncStatus, 80),
      databaseStatus: sanitize(input.databaseStatus, 80),
      conversationReference: input.conversationReference || {},
      status: 'NEW'
    };
    if (!this.kv) {
      memoryCases.push(supportCase);
      return supportCase;
    }
    await this.kv.put(`support-case:${caseId}`, JSON.stringify(supportCase));
    return supportCase;
  }
}

function ownerNotification(supportCase) {
  const confidence = `${Math.round(supportCase.confidence * 100)}%`;
  return [
    `New PlaySmart support case ${supportCase.caseId}`,
    '',
    `Category: ${supportCase.category}`,
    `Severity: ${supportCase.severity}`,
    `Confidence: ${confidence}`,
    `Status: ${supportCase.status}`,
    '',
    `Summary: ${supportCase.aiSummary || supportCase.userDescription}`,
    `Screen: ${supportCase.screen || 'Unknown'}`,
    `Route: ${supportCase.route || 'Unknown'}`,
    `App: ${supportCase.appVersion || 'Unknown'}${supportCase.buildNumber ? ` (${supportCase.buildNumber})` : ''}`,
    `Platform: ${supportCase.platform || 'Unknown'}${supportCase.os ? ` / ${supportCase.os}` : ''}`,
    '',
    `Expected: ${supportCase.expectedBehaviour || 'Not provided'}`,
    `Actual: ${supportCase.actualBehaviour || supportCase.userDescription}`,
    `Sync/database: ${supportCase.syncStatus || 'Unknown'} / ${supportCase.databaseStatus || 'Unknown'}`
  ].map((line) => sanitize(line, 500)).join('\n');
}

export { CASE_CATEGORIES, CASE_STATUSES, CaseRepository, ownerNotification, sanitize };