import { PRODUCT_LABELS } from './products.js';
import { answerLanguage } from './support-language.js';

export function isHowTo(message) {
  return /\b(?:how (?:do|can|should|to)|where (?:do|can|is|are)|show me|guide me|step.by.step|help me (?:to )?(?:use|find|start|set up)|hoe (?:kan|doen|gebruik|begin)|waar (?:is|kan))\b/i.test(message);
}

export function supportFallback(message, knowledge, state) {
  const guide = knowledge[0]?.document_type === 'HOW_TO' ? knowledge[0] : null;
  if (answerLanguage(message) === 'af') {
    if (guide && answerLanguage(guide.content) === 'af') return guide.content.slice(0, 1450);
    if (/\b(aanmeld|wagwoord|login)\b/i.test(message)) return 'Kom ons kyk stap vir stap:\n1. Maak seker jy gebruik jou eie rekening in die regte toepassing.\n2. Kyk of jou toestel ’n internetverbinding het.\n3. Lees die boodskap op die aanmeldskerm. Moenie jou wagwoord of ’n verifikasiekode deel nie.\nWatter boodskap sien jy?';
    if (/\b(sinkroniseer|sinchroniseer|verbinding|laai|offline)\b/i.test(message)) return 'Kom ons kyk na die verbinding:\n1. Kyk of ’n ander webblad op dieselfde toestel oopmaak.\n2. Hou enige ongestoorde werk oop. Moenie die toepassing herinstalleer of sy data uitvee nie.\n3. Lees enige foutboodskap op die skerm.\nWatter boodskap sien jy?';
    return 'Ek kan jou in Afrikaans help, maar ek het nog nie bevestigde Afrikaanse stappe vir daardie skerm nie. Op watter skerm is jy, en wat wil jy doen?';
  }
  if (guide) return guide.content.length <= 1450 ? guide.content : `${guide.content.slice(0, 1400)}…\nWhich step would you like help with?`;
  const troubleshooting = knowledge[0]?.troubleshooting;
  if (troubleshooting) return `Let’s check this step by step:\n${troubleshooting.safe_steps.slice(0, 3).map((step, i) => `${i + 1}. ${step}`).join('\n')}\n${troubleshooting.questions[0]}`;
  const product = PRODUCT_LABELS[state.product] || 'this product';
  if (/\b(login|log in|sign in|password|aanmeld)\b/i.test(message)) return `Let’s work through access to ${product}:\n1. Check that you are opening the intended product and using your own account.\n2. Check that your device has an internet connection.\n3. Read any message on the sign-in screen. Do not share your password or a verification code.\nWhat does that screen say?`;
  if (/\b(sync|offline|loading|connection)\b/i.test(message)) return 'Let’s check this step by step:\n1. Check whether another website opens on the same device.\n2. Keep any unsaved work open; do not reinstall the app or clear its data.\n3. Read any connection or sync message shown in the app.\nWhat message do you see?';
  return `I can guide you through ${product}, but I don’t have verified instructions for that screen yet. What screen are you on? You can send a screenshot with names and personal details hidden, and I’ll help with what is visible.`;
}
