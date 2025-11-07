// app/lib/ai/specs.ts
export function parseDimsFrom(text: string){
  const m1 = text.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  const m2 = text.match(/\bL\s*=?\s*(\d+(?:\.\d+)?)\b.*\bW\s*=?\s*(\d+(?:\.\d+)?)\b.*\bH\s*=?\s*(\d+(?:\.\d+)?)/i);
  if (m1) return { L: Number(m1[1]), W: Number(m1[2]), H: Number(m1[3]) };
  if (m2) return { L: Number(m2[1]), W: Number(m2[2]), H: Number(m2[3]) };
  return null;
}
export function parseQty(text: string){
  const m = text.match(/\bqty\s*[:=]?\s*(\d+)\b/i) || text.match(/\b(\d+)\s*(pcs|pieces|units|ea)\b/i) || text.match(/\b(?:need|for|make)\s+(\d{1,5})\b/i);
  return m ? Number(m[1]) : null;
}
export function parseDensity(text: string){
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|pounds?)\s*\/?\s*ft3\b/i) || text.match(/\b(\d+(?:\.\d+)?)\s*pcf\b/i);
  return m ? Number(m[1]) : null;
}
export function parseThicknessUnder(text: string){
  const m = text.match(/\b(thickness|under|bottom)\b.*?\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i);
  return m ? Number(m[2]) : null;
}
export function mentionsUnits(text: string){
  return /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(text);
}
