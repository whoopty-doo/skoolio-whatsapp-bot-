// A conservative hint for fallback speech. The client can override short or
// mixed-language answers explicitly; this is not a translation service.
export function answerLanguage(text) {
  const af = String(text).toLowerCase().match(/\b(ek|jy|jou|julle|die|nie|vir|kies|gaan|kliek|skerm|verslag|les|instellings|asseblief|hallo|goeiedag)\b/g) || [];
  const en = String(text).toLowerCase().match(/\b(the|your|you|please|choose|screen|report|settings|lesson|this|with)\b/g) || [];
  return af.length > en.length && af.length > 0 ? 'af' : 'en';
}
