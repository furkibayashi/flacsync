import type { AudioFormat, Platform } from '../types/api';

export const PLATFORM_LABEL: Record<Platform, string> = {
  spotify: 'Spotify',
  'apple-music': 'Apple Music',
  deezer: 'Deezer',
  'youtube-music': 'YouTube Music',
};

/** Rozetlerde marka logosu yerine renk noktası kullanılır. */
export const PLATFORM_DOT: Record<Platform, string> = {
  spotify: 'bg-[#1ed760]',
  'apple-music': 'bg-[#fa586a]',
  deezer: 'bg-[#a238ff]',
  'youtube-music': 'bg-[#ff4e45]',
};

const HOSTS: Array<[RegExp, Platform]> = [
  [/^spotify:|(^|\.)spotify\.(com|link|app\.link)$/i, 'spotify'],
  [/(^|\.)music\.apple\.com$|^itunes\.apple\.com$/i, 'apple-music'],
  [/(^|\.)deezer\.(com|page\.link)$|^link\.deezer\.com$/i, 'deezer'],
  [/(^|\.)youtube\.com$|^youtu\.be$/i, 'youtube-music'],
];

/** Yazarken anlık platform tespiti (sunucu tarafı tespitinin hafif kopyası). */
export function detectPlatform(input: string): Platform | null {
  const value = input.trim();
  if (!value) return null;
  if (/^spotify:/i.test(value)) return 'spotify';
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname;
    return HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '–';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function codecLabel(format: AudioFormat): string {
  const codec = /^opus/i.test(format.codec)
    ? 'Opus'
    : /^mp4a/i.test(format.codec)
      ? 'AAC'
      : format.codec.toUpperCase();
  return format.bitrateKbps ? `${codec} ${format.bitrateKbps} kbps` : codec;
}

/** Metin bir web adresine benziyor mu (desteklenmese bile)? */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  return /^https?:\/\//i.test(value) || /^[\w-]+(\.[\w-]+)+\/\S*/.test(value);
}
