import clsx from 'clsx';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Downloader } from './components/Downloader';
import { PlayerBar } from './components/PlayerBar';
import { MobileNav, Sidebar, Wordmark } from './components/Sidebar';
import { usePreferredFormat } from './hooks/usePreferredFormat';
import { useI18n } from './i18n/I18nProvider';
import { ArtistPage } from './pages/ArtistPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';
import { useStartupUpdateCheck } from './state/appUpdate';
import { PlayerProvider, usePlayer } from './state/PlayerProvider';
import { QueueProvider, useQueue } from './state/QueueProvider';
import { useHashRoute, type Route } from './state/router';
import { useAutoUpdateSetting, useTheme } from './state/settings';

export interface SearchRequest {
  query: string;
  nonce: number;
}

function Shell() {
  const { t } = useI18n();
  const [route, navigate, routeParam] = useHashRoute();
  const [art, setArt] = useState<string | null>(null);
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const onArtColor = useCallback((rgb: string | null) => setArt(rgb), []);
  const { current } = usePlayer();
  const queue = useQueue();
  const [format] = usePreferredFormat();
  const [autoUpdate] = useAutoUpdateSetting();

  useTheme();
  useStartupUpdateCheck(autoUpdate);

  // Masaüstü menüsü: "Ayarlar", "Güncellemeleri denetle"
  useEffect(
    () =>
      window.flacsync?.onNavigate?.((page) => {
        if (page === 'settings') navigate('settings' as Route);
      }),
    [navigate],
  );

  /** Arama ekranında bir sorgu ya da link aç (ana sayfa, keşfet albümleri) */
  const openInSearch = (query: string) => {
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
        </header>

        <main
          className={clsx(
            'mx-auto w-full max-w-6xl flex-1 px-5 pt-4 sm:px-8 md:pt-12',
            current ? 'pb-48 md:pb-32' : 'pb-28 md:pb-16',
          )}
        >
          {route === 'home' && <HomePage onNavigate={navigate} onSearch={openInSearch} />}
          {route === 'discover' && <DiscoverPage onOpen={openInSearch} />}
          {/* Arama ekranı arka planda açık kalır: sayfa değişince sonuçlar ve seçimler kaybolmaz */}
          <div className={clsx(route !== 'search' && 'hidden')}>
            <Downloader onArtColor={onArtColor} request={searchRequest} onNavigate={navigate} />
          </div>
          {route === 'library' && <LibraryPage onNavigate={navigate} />}
          {route === 'queue' && <QueuePage onNavigate={navigate} />}
          {route === 'settings' && <SettingsPage />}
          {route === 'artist' && (
            <ArtistPage
              id={routeParam}
              onOpen={openInSearch}
              onBack={() => (window.history.length > 1 ? window.history.back() : navigate('discover'))}
            />
          )}
        </main>

        <footer className={clsx('mx-auto hidden w-full max-w-6xl px-5 text-sm text-fade sm:px-8 md:block', current ? 'pb-28' : 'pb-8')}>
          {t('footer.note')}
        </footer>
      </div>

      <PlayerBar onDownload={(url) => void queue.enqueue(url, format)} />
      <MobileNav route={route} onNavigate={navigate} />
    </div>
  );
}

export function App() {
  return (
    <QueueProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </QueueProvider>
  );
}
