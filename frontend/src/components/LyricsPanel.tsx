import clsx from 'clsx';
import { Check, Loader2, MicVocal, Save, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { activeLine, parseLrc } from '../lib/lrc';
import { api, isAbort } from '../services/api';
import { usePlayer, usePlayerProgress } from '../state/PlayerProvider';
import type { Lyrics } from '../types/api';

type LoadState = { status: 'loading' } | { status: 'ready'; lyrics: Lyrics | null } | { status: 'error' };

/** Çalan şarkının sözleri: kütüphanede dosyadan, yoksa LRCLib'den. Parça değişince yeniden yüklenir. */
export function useTrackLyrics() {
  const { current } = usePlayer();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const trackKey = current?.id;
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    setSaved('idle');
    const request = current.libraryId
      ? api.libraryLyrics(current.libraryId, controller.signal)
      : api.lyrics(
          { title: current.title, artist: current.artist, album: current.album, duration: current.duration },
          controller.signal,
        );
    request
      .then((r) => setState({ status: 'ready', lyrics: r.lyrics }))
      .catch((err) => !isAbort(err) && setState({ status: 'error' }));
    return () => controller.abort();
    // Yalnızca parça değişince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const save = async () => {
    if (!current?.libraryId) return;
    setSaved('saving');
    const result = await api.embedLyrics(current.libraryId).catch(() => null);
    setSaved(result?.status === 'embedded' ? 'saved' : 'failed');
  };

  return { state, lyrics: state.status === 'ready' ? state.lyrics : null, saved, save };
}

/**
 * Söz satırları. Tam şarkılarda satırlar şarkıyla akar, tıklanınca oraya atlar.
 * `size="lg"`: Şimdi çalıyor ekranındaki büyük gösterim.
 */
export function LyricsLines({ state, size = 'md' }: { state: LoadState; size?: 'md' | 'lg' }) {
  const { t } = useI18n();
  const { current, seek } = usePlayer();
  const { time } = usePlayerProgress();
  const listRef = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  const lyrics = state.status === 'ready' ? state.lyrics : null;
  const lines = useMemo(() => (lyrics?.synced ? parseLrc(lyrics.synced) : []), [lyrics]);
  // Önizleme 30 sn'lik bir kesit: zamanlar tam şarkıya göre olduğu için akış yalnızca tam şarkıda
  const synced = lines.length > 0 && current?.kind === 'full';
  const active = synced ? activeLine(lines, time * 1000 + 250) : -1;

  useEffect(() => setFollow(true), [current?.id]);

  useEffect(() => {
    if (!follow || active < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-line="${active}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, follow]);

  const text = size === 'lg' ? 'text-[26px] sm:text-[32px]' : 'text-[22px]';

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-8" onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>
      {state.status === 'loading' && (
        <div className="grid h-full place-items-center text-dust">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}
      {state.status === 'error' && <p className="text-center text-danger">{t('lyrics.error')}</p>}
      {state.status === 'ready' && !lyrics && <p className="pt-10 text-center text-dust">{t('lyrics.none')}</p>}
      {lyrics?.instrumental && !lyrics.synced && !lyrics.plain && (
        <p className="pt-10 text-center text-dust">{t('lyrics.instrumental')}</p>
      )}

      {lines.length > 0 ? (
        <ol ref={listRef} className="space-y-4 pb-[40vh]">
          {current?.kind === 'preview' && <li className="text-sm text-fade">{t('lyrics.previewNote')}</li>}
          {lines.map((line, i) => (
            <li key={`${line.timeMs}-${i}`} data-line={i}>
              <button
                type="button"
                disabled={!synced}
                onClick={() => {
                  seek(line.timeMs / 1000);
                  setFollow(true);
                }}
                className={clsx(
                  'text-left font-display leading-snug font-bold transition-[color,transform] duration-300 disabled:cursor-text',
                  text,
                  !synced && 'text-paper/80',
                  synced && i === active && 'origin-left scale-[1.02] text-amber',
                  synced && i < active && 'text-paper/45 hover:text-paper/80',
                  synced && i > active && 'text-paper/75 hover:text-paper',
                )}
              >
                {line.text || '♪'}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        lyrics?.plain && (
          <p className={clsx('font-display leading-relaxed font-semibold whitespace-pre-line text-paper/85', size === 'lg' ? 'text-2xl' : 'text-xl')}>
            {lyrics.plain}
          </p>
        )
      )}

      {synced && !follow && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="sticky bottom-0 left-1/2 mx-auto block rounded-full bg-paper px-4 py-1.5 text-sm font-bold text-night shadow-lg"
        >
          {t('lyrics.follow')}
        </button>
      )}
    </div>
  );
}

/** Kütüphane şarkısının LRCLib sözlerini dosyaya gömme düğmesi */
export function SaveLyricsButton({ lyricsState }: { lyricsState: ReturnType<typeof useTrackLyrics> }) {
  const { t } = useI18n();
  const { current } = usePlayer();
  const { lyrics, saved, save } = lyricsState;
  if (!current?.libraryId || lyrics?.source !== 'lrclib') return null;
  return (
    <button
      type="button"
      onClick={() => void save()}
      disabled={saved === 'saving' || saved === 'saved'}
      title={t('lyrics.saveHint')}
      className="inline-flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-xs font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-70"
    >
      {saved === 'saving' ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : saved === 'saved' ? (
        <Check className="size-3.5 text-ok" />
      ) : (
        <Save className="size-3.5" />
      )}
      {saved === 'saved' ? t('lyrics.saved') : saved === 'failed' ? t('lyrics.saveFailed') : t('lyrics.save')}
    </button>
  );
}

/** Oynatıcının üstünde açılan söz paneli. */
export function LyricsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { current } = usePlayer();
  const lyricsState = useTrackLyrics();
  const { lyrics } = lyricsState;

  if (!current) return null;

  // body'ye taşınır: oynatıcı çubuğundaki backdrop-filter, fixed konumlu çocukların kapsayıcısı olur
  return createPortal(
    <aside
      aria-label={t('lyrics.title')}
      className="fixed top-0 right-0 bottom-[132px] z-40 flex w-full flex-col border-l border-rule bg-panel/97 shadow-2xl shadow-black/50 backdrop-blur-xl md:bottom-[73px] md:w-[min(440px,40vw)]"
    >
      <header className="flex items-center gap-3 border-b border-rule px-5 py-4">
        <MicVocal className="size-5 shrink-0 text-amber" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display font-bold text-paper">{current.title}</span>
          <span className="block truncate text-xs text-dust">
            {lyrics?.source === 'embedded' ? t('lyrics.fromFile') : lyrics ? t('lyrics.fromLrclib') : current.artist}
          </span>
        </span>
        <SaveLyricsButton lyricsState={lyricsState} />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('lyrics.close')}
          className="grid size-8 place-items-center rounded-full text-dust hover:bg-raised hover:text-paper"
        >
          <X className="size-4" />
        </button>
      </header>
      <LyricsLines state={lyricsState.state} />
    </aside>,
    document.body,
  );
}
