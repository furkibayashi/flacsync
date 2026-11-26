/**
 * "sha256sum" çıktısından bir dosyanın özetini okur. İki biçim de olur: "özet  ad" (metin kipi)
 * ve "özet *ad" (ikili kip, Windows'ta varsayılan). Bulamazsa null.
 */
export function parseSha256Sums(sums: string, fileName: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2]!.trim() === fileName) return m[1]!.toLowerCase();
  }
  return null;
}
