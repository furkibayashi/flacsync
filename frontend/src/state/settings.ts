import { useCallback, useEffect, useState } from 'react';

/**
 * localStorage'da tutulan kullanıcı tercihleri. Aynı anahtarı kullanan tüm bileşenler
 * özel bir olayla eşitlenir (ör. Ayarlar'da ses seviyesi değişince oynatıcı da günceller).
 */
const EVENT = 'flacsync:setting';

function read<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : fallback;
  } catch {
    // Eski sürümlerde düz metin yazılmış olabilir (ör. tema adı)
    try {
      const raw = localStorage.getItem(key);
      return raw !== null && valid(raw) ? (raw as T) : fallback;
    } catch {
      return fallback;
    }
  }
}

export function useStoredState<T>(key: string, fallback: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback, valid));

  useEffect(() => {
    const sync = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) setValue(read(key, fallback, valid));
    };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
    // fallback / valid sabit kabul edilir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, typeof next === 'string' ? next : JSON.stringify(next));
      } catch {
        // depolama kapalı: yalnızca bu oturumda geçerli
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key],
  );

  return [value, update];
}

// --- Tema -------------------------------------------------------------------

export const THEMES = ['night', 'oled', 'ocean', 'sakura', 'forest', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** Ayarlar'daki önizleme kartları için: zemin, panel, yazı, vurgu */
export const THEME_SWATCH: Record<Theme, [string, string, string, string]> = {
  night: ['#17151f', '#2a2638', '#efeaf6', '#f2b544'],
  oled: ['#000000', '#17171b', '#f2f2f4', '#f2b544'],
  ocean: ['#0c1720', '#192c39', '#e4f0f5', '#4fd1c5'],
  sakura: ['#1c1317', '#32232a', '#f8e9ef', '#ff8fb1'],
  forest: ['#111914', '#203026', '#e7f2e9', '#9bd36a'],
  light: ['#f5f2ec', '#ebe6dd', '#1d1a22', '#c27400'],
};

const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'night') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const bg = THEME_SWATCH[theme][0];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'light' ? 'light' : 'dark');
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useStoredState<Theme>('flacsync.theme', 'night', isTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return [theme, setTheme];
}

// --- Tasarım stili (renkten bağımsız: köşe, yazı tipi, boşluk, gölge, doku) ----------------------

export const STYLES = ['classic', 'soft', 'compact', 'minimal', 'retro', 'glass'] as const;
export type DesignStyle = (typeof STYLES)[number];
const isStyle = (v: unknown): v is DesignStyle => typeof v === 'string' && (STYLES as readonly string[]).includes(v);

export function useDesignStyle(): [DesignStyle, (s: DesignStyle) => void] {
  const [style, setStyle] = useStoredState<DesignStyle>('flacsync.style', 'classic', isStyle);
  useEffect(() => {
    const root = document.documentElement;
    if (style === 'classic') root.removeAttribute('data-style');
    else root.setAttribute('data-style', style);
  }, [style]);
  return [style, setStyle];
}

// --- Diğer tercihler -----------------------------------------------------------

const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Oynatıcı ses seviyesi (0-1, kaydırıcı konumu). Varsayılan yarım: önceki sürümde çok yüksekti. */
export const useVolumeSetting = () => useStoredState<number>('flacsync.volume', 0.5, isUnit);

/** Açılışta güncelleme denetlensin mi (masaüstü) */
export const useAutoUpdateSetting = () => useStoredState<boolean>('flacsync.autoUpdate', true, isBool);
