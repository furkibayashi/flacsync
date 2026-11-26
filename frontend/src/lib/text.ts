/**
 * Aramada karşılaştırma için metni sadeleştirir: küçük harf, Türkçe "ı" → "i", aksanlar atılır,
 * noktalama boşluğa döner. "Gülümse" ↔ "gulumse", "İSTANBUL" ↔ "istanbul" eşleşir.
 */
export const foldText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
