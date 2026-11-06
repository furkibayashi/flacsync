import { useCallback, useState } from 'react';
import { Downloader } from './components/Downloader';
import { LanguageSwitch } from './components/LanguageSwitch';
import { useI18n } from './i18n/I18nProvider';

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#2a2638" />
        <circle cx="16" cy="16" r="11" fill="none" stroke="#383349" strokeWidth="1" />
        <circle cx="16" cy="16" r="7.5" fill="none" stroke="#383349" strokeWidth="1" />
        <circle cx="16" cy="16" r="4.5" fill="#f2b544" />
        <circle cx="16" cy="16" r="1.2" fill="#17151f" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight">FlacSync</span>
    </span>
  );
}

export function App() {
  const { t } = useI18n();
  const [art, setArt] = useState<string | null>(null);
  const onArtColor = useCallback((rgb: string | null) => setArt(rgb), []);

  return (
    <div
      className="relative isolate flex min-h-dvh flex-col overflow-x-hidden"
      style={art ? ({ '--art': art } as React.CSSProperties) : undefined}
    >
      {/* Kapak renginden ortam ışığı */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 -left-40 -z-10 size-[720px] rounded-full opacity-25 blur-[140px] transition-colors duration-1000"
        style={{ backgroundColor: 'rgb(var(--art))' }}
      />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Wordmark />
        <LanguageSwitch />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-6 pb-24 sm:px-8 sm:pt-12">
        <Downloader onArtColor={onArtColor} />
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 pb-8 text-sm text-fade sm:px-8">{t('footer.note')}</footer>
    </div>
  );
}
