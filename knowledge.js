import { KNOWLEDGE_DOCUMENTS, KNOWLEDGE_INDEX, KNOWLEDGE_VERSION, KNOWLEDGE_COLLECTIONS, KNOWLEDGE_INVENTORY } from './knowledge.generated.js';
import { LocalKnowledgeIndex, knowledgeTokens } from './knowledge-index.js';
import { validateKnowledgeDocument, canReadKnowledge, safeKnowledgeResult, isPublicKnowledge, KNOWLEDGE_PRODUCTS } from './knowledge-schema.js';
import { sanitize } from './privacy.js';

export { KNOWLEDGE_VERSION, KNOWLEDGE_COLLECTIONS, KNOWLEDGE_INVENTORY };
export const records = KNOWLEDGE_DOCUMENTS;
const FOLLOW_UP = /^(?:and |okay[, ]*|ok[, ]*)?(?:what next|next(?: step)?|continue|go on|where is (?:it|that)|how (?:do i|can i) (?:do that|find it)|(?:i )?(?:can'?t|cannot|don'?t|do not) (?:see|find) (?:it|that)|that (?:didn'?t|did not) work|explain (?:that|step \d+)|what about (?:that|the next step)|en nou|gaan voort|waar is dit)[?.! ]*$/i;

// The service owns policy, validation and response budgets; candidate generation
// is replaceable. A future async backend may be awaited by the existing caller.
export class KnowledgeService {
  constructor(documents = KNOWLEDGE_DOCUMENTS, { backend } = {}) {
    this.documents = [];
    const seen = new Set();
    for (const candidate of Array.isArray(documents) ? documents.slice(0, 2000) : []) {
      try {
        if (validateKnowledgeDocument(candidate).length || seen.has(candidate.id)) continue;
        const doc = structuredClone(candidate); seen.add(doc.id); this.documents.push(doc);
      } catch { /* A bad document must not break the webhook. */ }
    }
    this.byId = new Map(this.documents.map(doc => [doc.id, doc]));
    this.backend = backend || new LocalKnowledgeIndex(this.documents, documents === KNOWLEDGE_DOCUMENTS ? KNOWLEDGE_INDEX : {});
  }
  search({ product, query, conversationContext, limit = 4, scope = null, module } = {}) {
    if (!KNOWLEDGE_PRODUCTS.includes(product) || typeof query !== 'string' || !query.trim()) return [];
    const count = Math.max(0, Math.min(8, Math.floor(Number.isFinite(limit) ? limit : 4)));
    if (!count) return [];
    let effectiveQuery = sanitize(query, 4000);
    // An unrelated new question never borrows old topic matches. Cross-product
    // context is ignored, and only explicit short follow-ups use previous turns.
    if (FOLLOW_UP.test(query.trim()) && conversationContext?.product === product) {
      const prior = (Array.isArray(conversationContext.turns) ? conversationContext.turns : []).filter(turn => turn?.role === 'user' && typeof turn.content === 'string' && turn.content !== query && !FOLLOW_UP.test(turn.content.trim())).slice(-1)[0];
      if (prior) effectiveQuery = `${sanitize(prior.content, 1500)} ${effectiveQuery}`;
    }
    if (!knowledgeTokens(effectiveQuery).length) return [];
    const allowedIds = new Set(this.documents.filter(doc => canReadKnowledge(doc, product, scope) && (!module || doc.module === module)).map(doc => doc.id));
    let candidates;
    try { candidates = this.backend.search({ product, query: effectiveQuery, limit: 32, allowedIds }); }
    catch { return []; }
    const finish = candidates => {
    if (!Array.isArray(candidates)) return [];
    const results = [], emitted = new Set(); let remaining = 10000;
    for (const candidate of candidates.slice(0, 64)) {
      const doc = this.byId.get(candidate?.id);
      if (!doc || !allowedIds.has(doc.id) || emitted.has(doc.id) || !Number.isFinite(candidate.confidence) || candidate.confidence < 0.4) continue;
      const result = safeKnowledgeResult(doc, candidate.confidence);
      const size = JSON.stringify(result).length;
      if (size > remaining) continue;
      results.push(result); emitted.add(doc.id); remaining -= size;
      if (results.length >= count) break;
    }
    return results;
    };
    return candidates && typeof candidates.then === 'function' ? candidates.then(finish).catch(() => []) : finish(candidates);
  }
  retrieve(query, { product = 'UNKNOWN', scope = null, limit = 4, conversationContext, module } = {}) {
    return this.search({ product, query, scope, limit, conversationContext, module });
  }
}
const defaultService = new KnowledgeService();
// Legacy entry point now delegates to the same product-scoped engine.
export function searchKnowledge(query, category, limit = 4) {
  return defaultService.search({ product: 'PLAYSMART', query, module: category, limit }).map(doc => ({ ...doc, category: doc.module, knowledgeVersion: KNOWLEDGE_VERSION }));
}
export class PlaySmartKnowledge extends KnowledgeService { search(options = {}) { return super.search({ ...options, product: 'PLAYSMART' }); } }
export class ReadSmartKnowledge extends KnowledgeService { search(options = {}) { return super.search({ ...options, product: 'READSMART' }); } }
export class SkoolioAdminKnowledge extends KnowledgeService { search(options = {}) { return super.search({ ...options, product: 'SKOOLIO_ADMIN' }); } }

// This is the ONLY model-facing projection. Repository paths, visibility rules,
// account scope and internal inventory do not enter the customer model prompt.
export function knowledgeForResponse(results) {
  return results.filter(isPublicKnowledge).map(({ title, content, troubleshooting }) => ({ title, content, ...(troubleshooting ? { troubleshooting: { symptoms: troubleshooting.symptoms, questions: troubleshooting.questions, safe_steps: troubleshooting.safe_steps, collect_if_unresolved: troubleshooting.collect_if_unresolved } } : {}) }));
}
