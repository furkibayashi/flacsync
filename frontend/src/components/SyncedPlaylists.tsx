import clsx from 'clsx';
import { AlertCircle, Link2, ListMusic, Loader2, RefreshCw, Repeat2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { useI18n } from '../i18n/I18nProvider';
import { detectPlatform, PLATFORM_LABEL } from '../lib/format';
import { relativeTime } from '../lib/time';
import { api, toUiError } from '../services/api';
import { reloadPlaylists } from '../state/playlists';
import type { WatchedPlaylist } from '../types/api';
import { PlatformTag } from './PlatformTag';

/**
 * Takip edilen listeler: bir Spotify / Apple Music / Deezer / YouTube Music listesi takibe alınır,
 * FlacSync 30 dakikada bir bakıp yalnızca yeni eklenen şarkıları indirir ve aynı adlı listeye ekler.
 */
export function SyncedPlaylists({ onOpenPlaylist }: { onOpenPlaylist: (playlistId: string) => void }) {
  const { t, lang, tError } = useI18n();
  const [format] = usePreferredFormat();
  const [items, setItems] = useState<WatchedPlaylist[]>([]);
  const [url, setUrl] = useState('');
  const [downloadExisting, setDownloadExisting] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .syncList()
      .then((r) => setItems(r.playlists))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    // Kontrol sürerken durum tazelenir
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (!value) return;
    setAdding(true);
    setError(null);
    try {
      await api.syncAdd(value, format, downloadExisting);
      setUrl('');
      load();
      void reloadPlaylists();
    } catch (err) {
      const ui = toUiError(err);
      setError(tError(ui.code, ui.message));
    } finally {
      setAdding(false);
    }
  };

  const check = async (id: string) => {
    setItems((list) => list.map((w) => (w.id === id ? { ...w, checking: true } : w)));
    await api.syncCheck(id).catch(() => undefined);
    load();
    void reloadPlaylists();
  };

  const platform = detectPlatform(url);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-paper">
          <Repeat2 className="size-5 text-amber" />
          {t('sync.title')}
        </h2>
        <p className="mt-1 text-sm text-dust">{t('sync.subtitle')}</p>
      </div>

      <form onSubmit={(e) => void add(e)} className="space-y-2 rounded-2xl bg-panel/70 p-4 ring-1 ring-rule">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fade" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('sync.placeholder')}
              aria-label={t('sync.placeholder')}
              className="h-11 w-full rounded-xl bg-night pr-3 pl-10 text-paper ring-1 ring-rule outline-none placeholder:text-fade focus:ring-amber"
            />
          </label>
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-amber px-5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40"
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Repeat2 className="size-4" />}
            {t('sync.add')}
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-dust">
          <input type="checkbox" checked={downloadExisting} onChange={(e) => setDownloadExisting(e.target.checked)} className="size-4 accent-[var(--color-amber)]" />
          {t('sync.downloadExisting')}
          {platform && <span className="ml-auto text-xs text-fade">{PLATFORM_LABEL[platform]}</span>}
        </label>
        {error && (
          <p className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        <p className="text-xs text-fade">{t('sync.hint')}</p>
      </form>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((w) => (
            <li key={w.id} className={clsx('flex items-center gap-3 rounded-xl bg-panel/60 p-3 ring-1 ring-rule', !w.enabled && 'opacity-60')}>
              <span className="size-12 shrink-0 overflow-hidden rounded-md bg-raised">
                {w.coverUrl ? <img src={w.coverUrl} alt="" className="size-full object-cover" /> : <ListMusic className="m-3 size-6 text-fade" />}
              </span>
              <button type="button" onClick={() => onOpenPlaylist(w.playlistId)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold text-paper hover:text-amber">{w.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-dust">
                  <PlatformTag platform={w.platform} />
                  <span>{t('library.trackCount', { count: w.trackCount })}</span>
                  {w.lastCheckedAt && <span>· {t('sync.checked', { time: relativeTime(w.lastCheckedAt, lang) })}</span>}
                  {w.lastAdded > 0 && <span className="text-ok">· {t('sync.added', { count: w.lastAdded })}</span>}
                  {w.lastError && <span className="text-danger" title={w.lastError}>· {t('sync.failed')}</span>}
                </span>
              </button>
              <label className="hidden items-center gap-1.5 text-xs text-dust sm:flex" title={t('sync.autoHint')}>
                <input
                  type="checkbox"
                  checked={w.enabled}
                  onChange={(e) => void api.syncUpdate(w.id, { enabled: e.target.checked }).then(load)}
                  className="size-4 accent-[var(--color-amber)]"
                />
                {t('sync.auto')}
              </label>
              <button
                type="button"
                onClick={() => void check(w.id)}
                disabled={w.checking}
                title={t('sync.checkNow')}
                aria-label={t('sync.checkNow')}
                className="grid size-9 place-items-center rounded-full text-dust transition hover:bg-raised hover:text-paper disabled:opacity-60"
              >
                <RefreshCw className={clsx('size-4', w.checking && 'animate-spin')} />
              </button>
              <button
                type="button"
                onClick={() => void api.syncRemove(w.id).then(load)}
                title={t('sync.remove')}
                aria-label={t('sync.remove')}
                className="grid size-9 place-items-center rounded-full text-fade transition hover:bg-raised hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
