import clsx from 'clsx';
import { useCallback, useState, type CSSProperties } from 'react';
import { Downloader } from './components/Downloader';
import { LanguageSwitch } from './components/LanguageSwitch';
import { MobileNav, Sidebar, Wordmark } from './components/Sidebar';
import { useI18n } from './i18n/I18nProvider';
import { HomePage } from './pages/HomePage';
import { QueuePage } from './pages/QueuePage';
import { QueueProvider } from './state/QueueProvider';
import { useHashRoute } from './state/router';

export interface SearchRequest {
  query: string;
  nonce: number;
}

function Shell() {
  const { t } = useI18n();
  const [route, navigate] = useHashRoute();
  const [art, setArt] = useState<string | null>(null);
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const onArtColor = useCallback((rgb: string | null) => setArt(rgb), []);

  const searchFromHome = (query: string) => {
    setSearchRequest({ query, nonce: Date.now() });
    navigate('search');
  };

  return (
    <div className="relative isolate flex min-h-dvh" style={art && route === 'search' ? ({ '--art': art } as CSSProperties) : undefined}>
      {/* Kapak renginden ortam ışığı */}
      <div
        aria-hidden
        className="pointer-events-none fixed -top-48 left-24 -z-10 size-[760px] rounded-full opacity-25 blur-[140px] transition-colors duration-1000"
        style={{ backgroundColor: 'rgb(var(--art))' }}
      />

      <Sidebar route={route} onNavigate={navigate} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-5 md:hidden">
          <Wordmark />
          <LanguageSwitch />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-4 pb-28 sm:px-8 md:pt-12 md:pb-16">
          {route === 'home' && <HomePage onNavigate={navigate} onSearch={searchFromHome} />}
          {/* Arama ekranı arka planda açık kalır: sayfa değişince sonuçlar ve seçimler kaybolmaz */}
          <div className={clsx(route !== 'search' && 'hidden')}>
            <Downloader onArtColor={onArtColor} request={searchRequest} onNavigate={navigate} />
          </div>
          {route === 'queue' && <QueuePage onNavigate={navigate} />}
        </main>

        <footer className="mx-auto hidden w-full max-w-6xl px-5 pb-8 text-sm text-fade sm:px-8 md:block">{t('footer.note')}</footer>
      </div>

      <MobileNav route={route} onNavigate={navigate} />
    </div>
  );
}

export function App() {
  return (
    <QueueProvider>
      <Shell />
    </QueueProvider>
  );
}
