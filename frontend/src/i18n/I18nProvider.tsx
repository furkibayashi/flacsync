import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGS, translations, type Lang, type TranslationKey } from './translations';

const STORAGE_KEY = 'flacsync.lang';

type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: Vars) => string;
  /** Sunucu hata kodunu seçili dilde mesaja çevirir; bilinmeyen kodlarda sunucu mesajını kullanır. */
  tError: (code: string | undefined, fallback: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGS as string[]).includes(saved)) return saved as Lang;
  } catch {
    // depolama kapalı olabilir; tarayıcı diline düş
  }
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function format(template: string | undefined, vars?: Vars): string {
  // Eksik anahtar arayüzü çökertmesin (geliştirmede sıcak yükleme sırasında olabilir)
  if (template === undefined) return '';
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // yoksay
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = translations[lang];
    const t = (key: TranslationKey, vars?: Vars) => format(dict[key], vars);
    const tError = (code: string | undefined, fallback: string) => {
      const key = `error.${code}` as TranslationKey;
      if (code && key in dict) return dict[key];
      // Bilinmeyen kod: Türkçede sunucu mesajı zaten Türkçe; diğer dillerde genel mesaj
      return lang === 'tr' ? fallback : t('error.generic', { message: fallback });
    };
    return { lang, setLang, t, tError };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n, I18nProvider içinde kullanılmalı');
  return ctx;
}
