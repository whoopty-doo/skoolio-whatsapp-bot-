const memoryCases = [];
let memorySequence = 0;

const CASE_STATUSES = ['NEW', 'INVESTIGATING', 'NEEDS_INFORMATION', 'CONFIRMED_BUG', 'FIX_IN_PROGRESS', 'FIX_READY', 'APPROVED', 'RELEASED', 'CLOSED'];
const CASE_CATEGORIES = ['AUTHENTICATION', 'ACTIVATION', 'LICENSING', 'STUDENT_MANAGEMENT', 'LESSON', 'READING', 'SPELLING', 'PERCEPTUAL_READING', 'PERCEPTUAL_SPELLING', 'COMPREHENSION', 'EYE_KINETICS', 'EVALUATION', 'RESULTS', 'SETTINGS', 'PARENT', 'CENTRE', 'SYNC', 'DATABASE', 'PLATFORM', 'PERFORMANCE', 'OTHER'];
const TRIAGE_KEY_PREFIX = 'support-triage:';

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
      case_id: caseId,
      created_at: now,
      updated_at: now,
      status: 'NEW',
      reporter_whatsapp_identifier: input.reporterWhatsappIdentifier || '[REDACTED]',
      user_description: sanitize(input.userDescription),
      ai_summary: sanitize(input.aiSummary),
      category: normalizeCategory(input.category),
      severity: normalizeSeverity(input.severity),
      confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
      feature_module: sanitize(input.featureModule, 120),
      reproduction_steps: (input.reproductionSteps || []).map((step) => sanitize(step, 300)).slice(0, 8),
      expected_behaviour: sanitize(input.expectedBehaviour, 500),
      actual_behaviour: sanitize(input.actualBehaviour, 500),
      app_version: sanitize(input.appVersion, 80),
      build_number: sanitize(input.buildNumber, 40),
      platform: sanitize(input.platform, 40),
      os: sanitize(input.os, 80),
      architecture: sanitize(input.architecture, 40),
      route: sanitize(input.route, 120),
      screen: sanitize(input.screen, 120),
      error_message: sanitize(input.errorMessage, 500),
      sanitized_logs: (input.sanitizedLogs || []).map((entry) => sanitize(entry, 500)).slice(0, 10),
      sync_status: sanitize(input.syncStatus, 80),
      database_status: sanitize(input.databaseStatus, 80),
      conversation_reference: input.conversationReference || {},
      owner_notes: sanitize(input.ownerNotes, 500)
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
    `PLAYSMART SUPPORT\n${supportCase.case_id}`,
    '',
    `Category: ${supportCase.category}`,
    `Severity: ${supportCase.severity}`,
    `Confidence: ${confidence}`,
    `Status: ${supportCase.status}`,
    '',
    `Summary: ${supportCase.ai_summary || supportCase.user_description}`,
    `Area: ${supportCase.feature_module || 'Unknown'}`,
    `Screen: ${supportCase.screen || 'Unknown'}`,
    `Route: ${supportCase.route || 'Unknown'}`,
    `App: ${supportCase.app_version || 'Unknown'}${supportCase.build_number ? ` (${supportCase.build_number})` : ''}`,
    `Platform: ${supportCase.platform || 'Unknown'}${supportCase.os ? ` / ${supportCase.os}` : ''}`,
    '',
    `Expected: ${supportCase.expected_behaviour || 'Not provided'}`,
    `Actual: ${supportCase.actual_behaviour || supportCase.user_description}`,
    `Error: ${supportCase.error_message || 'Unknown'}`,
    `Sync/database: ${supportCase.sync_status || 'Unknown'} / ${supportCase.database_status || 'Unknown'}`
  ].map((line) => sanitize(line, 500)).join('\n');
}

class TriageDraftStore {
  constructor(kv) {
    this.kv = kv;
  }

  async get(senderKey) {
    if (!this.kv) return null;
    const value = await this.kv.get(`${TRIAGE_KEY_PREFIX}${senderKey}`);
    return value ? JSON.parse(value) : null;
  }

  async put(senderKey, draft) {
    if (this.kv) await this.kv.put(`${TRIAGE_KEY_PREFIX}${senderKey}`, JSON.stringify(draft), { expirationTtl: 60 * 60 * 24 * 7 });
  }

  async clear(senderKey) {
    if (this.kv) await this.kv.delete(`${TRIAGE_KEY_PREFIX}${senderKey}`);
  }
}

export { CASE_CATEGORIES, CASE_STATUSES, CaseRepository, TriageDraftStore, ownerNotification, sanitize };