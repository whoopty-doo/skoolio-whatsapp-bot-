export const PRODUCTS = ['PLAYSMART', 'READSMART', 'SKOOLIO_ADMIN', 'GENERAL', 'UNKNOWN'];
export const PRODUCT_LABELS = { PLAYSMART: 'PlaySmart', READSMART: 'ReadSmart', SKOOLIO_ADMIN: 'Skoolio Admin', GENERAL: 'General', UNKNOWN: 'Not yet identified' };
export const CASE_PREFIXES = { PLAYSMART: 'PS', READSMART: 'RS', SKOOLIO_ADMIN: 'SA', GENERAL: 'GS', UNKNOWN: 'GS' };
export const normalizeProduct = value => PRODUCTS.includes(value) ? value : 'UNKNOWN';
export class ProductRouter {
  resolve(message, context = {}) {
    const mentions = [
      [/\b(?:play\s?smart|ps(?!-))\b/i, 'PLAYSMART'], [/\b(?:read\s?smart|rsmart|rs(?!-))\b/i, 'READSMART'],
      [/\b(?:skoolio\s+(?:admin|backoffice|back office)|backoffice|back office)\b/i, 'SKOOLIO_ADMIN']
    ].filter(([pattern]) => pattern.test(message)).map(([, product]) => product);
    if (mentions.length > 1) return { product: 'UNKNOWN', confidence: 0, needsClarification: true, source: 'multiple_products' };
    if (mentions.length === 1) return { product: mentions[0], confidence: 1, needsClarification: false, source: 'explicit' };
    const previous = normalizeProduct(context.product);
    if (previous !== 'UNKNOWN') return { product: previous, confidence: 0.9, needsClarification: false, source: 'conversation' };
    return { product: 'UNKNOWN', confidence: 0, needsClarification: true, source: 'insufficient_evidence' };
  }
}
export const PRODUCT_QUESTION = 'Is this happening in PlaySmart, ReadSmart, or Skoolio Admin / backoffice?';
// This is a policy boundary, not a running coding agent.
export class CodingAgentRouter {
  constructor(registry = {}) { this.registry = registry; }
  plan(supportCase) {
    if (!['PLAYSMART', 'READSMART', 'SKOOLIO_ADMIN'].includes(supportCase.product)) throw new Error('A confirmed product is required');
    const target = this.registry[supportCase.product];
    if (!target?.repository || !target?.worker) throw new Error('No repository worker configured for this product');
    if (supportCase.category === 'INTEGRATION' && !supportCase.integration_approval?.approved_by) throw new Error('Cross-system investigation requires human approval');
    return { case_id: supportCase.case_id, product: supportCase.product, repository: target.repository, worker: target.worker, mode: 'INVESTIGATE_ONLY', untrusted_case_data: true, may_merge: false, may_release: false };
  }
}
