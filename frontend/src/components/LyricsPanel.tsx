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

/** Satırın ne kadarının söylendiğini tahmin etmek için: harf başına süre ve sınırlar (ms) */
const MS_PER_CHAR = 115;
const MIN_SUNG_MS = 900;
/** Ses ve ekran arasındaki küçük gecikme payı */
const LEAD_MS = 120;

interface WordTiming {
  text: string;
  /** Satırın söylenen süresi içindeki başlangıç / bitiş (0-1) */
  from: number;
  to: number;
}

/**
 * LRC yalnızca satır başlangıçlarını verir. Kelimelerin ne zaman söylendiği, satırın söylenme
 * süresi harf sayısına göre tahmin edilip kelimelere uzunluklarıyla orantılı paylaştırılarak bulunur.
 */
function wordTimings(text: string): WordTiming[] {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  const weights = words.map((w) => (/^\s+$/.test(w) ? 0 : w.length + 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return words.map((w, i) => {
    const from = acc / total;
    acc += weights[i]!;
    return { text: w, from, to: acc / total };
  });
}

function sungDuration(text: string, gapMs: number): number {
  // Hızlı satırlarda (rap) bir sonraki satıra kadar olan süre belirler, yavaşlarda harf sayısı
  return Math.min(gapMs * 0.88, Math.max(MIN_SUNG_MS, text.replace(/\s+/g, '').length * MS_PER_CHAR + 500));
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Çalan satır: kelimeler söylendikçe soldan sağa renklenir (karaoke). Saniyede 60 kez güncellenir;
 * React yeniden çizimi yapılmaz, yalnızca CSS değişkeni değişir.
 */
function KaraokeLine({ text, startMs, endMs, className }: { text: string; startMs: number; endMs: number; className: string }) {
  const { getTime } = usePlayer();
  const ref = useRef<HTMLSpanElement>(null);
  const words = useMemo(() => wordTimings(text), [text]);
  const sung = sungDuration(text, endMs - startMs);

  useEffect(() => {
    let raf = 0;
    const spans = ref.current ? [...ref.current.querySelectorAll<HTMLElement>('[data-w]')] : [];
    const tick = () => {
      const f = clamp01((getTime() * 1000 + LEAD_MS - startMs) / sung);
      spans.forEach((el, i) => {
        const w = words[i]!;
        const v = w.to > w.from ? clamp01((f - w.from) / (w.to - w.from)) : f >= w.to ? 1 : 0;
        el.style.setProperty('--w', String(v));
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [getTime, startMs, sung, words]);

  return (
    <span ref={ref} className={className}>
      {words.map((w, i) =>
        /^\s+$/.test(w.text) ? (
          <span key={i} data-w>
            {w.text}
          </span>
        ) : (
          <span key={i} data-w className="karaoke-word">
            {w.text}
          </span>
        ),
      )}
    </span>
  );
}

/** Enstrümantal ara: üç nokta sırayla dolar */
function GapDots({ startMs, endMs, active }: { startMs: number; endMs: number; active: boolean }) {
  const { getTime } = usePlayer();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const dots = ref.current ? [...ref.current.children] as HTMLElement[] : [];
    const tick = () => {
      const f = clamp01((getTime() * 1000 - startMs) / Math.max(1, endMs - startMs));
      dots.forEach((d, i) => d.style.setProperty('--w', String(clamp01(f * 3 - i))));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, getTime, startMs, endMs]);
  return (
    <span ref={ref} className={clsx('inline-flex gap-2 py-2', !active && 'opacity-40')} aria-label="♪">
      {[0, 1, 2].map((i) => (
        <span key={i} className="gap-dot size-2.5 rounded-full" />
      ))}
    </span>
  );
}

/**
 * Söz satırları. Tam şarkılarda kelimeler söylendikçe renklenir, satır ortada tutulur,
 * bir satıra tıklayınca şarkı oraya atlar. `size="lg"`: Şimdi çalıyor ekranındaki büyük gösterim.
 */
export function LyricsLines({ state, size = 'md' }: { state: LoadState; size?: 'md' | 'lg' }) {
  const { t } = useI18n();
  const { current, seek } = usePlayer();
  const { time } = usePlayerProgress();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const lyrics = state.status === 'ready' ? state.lyrics : null;
  const lines = useMemo(() => (lyrics?.synced ? parseLrc(lyrics.synced) : []), [lyrics]);
  // Önizleme 30 sn'lik bir kesit: zamanlar tam şarkıya göre olduğu için akış yalnızca tam şarkıda
  const synced = lines.length > 0 && current?.kind === 'full';
  const active = synced ? activeLine(lines, time * 1000 + LEAD_MS) : -1;

  useEffect(() => setFollow(true), [current?.id]);

  // Yalnızca söz kutusu kaydırılır (scrollIntoView tüm ekranı da kaydırıp üst çubuğu gizliyordu)
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!follow || !scroller) return;
    const el = scroller.querySelector<HTMLElement>(`[data-line="${Math.max(active, 0)}"]`);
    if (!el) return;
    scroller.scrollTo({ top: Math.max(0, el.offsetTop - scroller.clientHeight * 0.32), behavior: 'smooth' });
  }, [active, follow]);

  const text = size === 'lg' ? 'text-[26px] sm:text-[34px]' : 'text-[22px]';

  return (
    <div
      ref={scrollerRef}
      className="lyrics-mask relative min-h-0 flex-1 overflow-y-auto px-6 py-8"
      onWheel={() => setFollow(false)}
      onTouchMove={() => setFollow(false)}
    >
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
        <ol className={clsx('pt-[20vh] pb-[45vh]', size === 'lg' ? 'space-y-6' : 'space-y-4')}>
          {current?.kind === 'preview' && <li className="text-sm text-fade">{t('lyrics.previewNote')}</li>}
          {lines.map((line, i) => {
            const isActive = synced && i === active;
            const endMs = lines[i + 1]?.timeMs ?? line.timeMs + 6000;
            const base = clsx('font-display leading-snug font-bold', text);
            return (
              <li key={`${line.timeMs}-${i}`} data-line={i}>
                <button
                  type="button"
                  disabled={!synced}
                  onClick={() => {
                    seek(line.timeMs / 1000);
                    setFollow(true);
                  }}
                  className={clsx(
                    'block origin-left text-left transition-[opacity,transform,filter] duration-500 disabled:cursor-text',
                    !synced && 'text-paper/80',
                    isActive && 'scale-[1.03]',
                    synced && i < active && 'text-paper/40 hover:text-paper/75',
                    synced && i > active && 'text-paper/70 hover:text-paper',
                    synced && Math.abs(i - active) > 3 && 'blur-[0.6px]',
                  )}
                >
                  {!line.text ? (
                    <GapDots startMs={line.timeMs} endMs={endMs} active={isActive} />
                  ) : isActive ? (
                    <KaraokeLine text={line.text} startMs={line.timeMs} endMs={endMs} className={clsx(base, 'karaoke-glow')} />
                  ) : (
                    <span className={base}>{line.text}</span>
                  )}
                </button>
              </li>
            );
          })}
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
