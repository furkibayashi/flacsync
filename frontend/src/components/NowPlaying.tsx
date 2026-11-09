import clsx from 'clsx';
import {
  ChevronDown,
  Disc3,
  Download,
  ListMusic,
  Loader2,
  MicVocal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { usePlayer } from '../state/PlayerProvider';
import { AddToPlaylist } from './AddToPlaylist';
import { ArtistLinks } from './ArtistLinks';
import { LyricsLines, SaveLyricsButton, useTrackLyrics } from './LyricsPanel';
import { RangeSlider, SeekBar } from './PlayerBar';
import { SleepTimerButton } from './SleepTimer';

type Tab = 'lyrics' | 'queue';

const round = (on: boolean) =>
  clsx(
    'grid size-11 place-items-center rounded-full transition hover:bg-white/10',
    on ? 'text-amber hover:text-amber-hi' : 'text-paper/70 hover:text-paper',
  );

/**
 * Tam ekran "Şimdi çalıyor": büyük kapak, kapaktan kayarak çıkan ve çalarken dönen plak,
 * kapak renginden arka plan, büyük kontroller; yanda akan sözler ya da sıradakiler.
 */
export function NowPlaying({ onClose, onDownload }: { onClose: () => void; onDownload: (url: string) => void }) {
  const { t } = useI18n();
  const p = usePlayer();
  const track = p.current;
  const [tab, setTab] = useState<Tab>('lyrics');
  const [coverFailed, setCoverFailed] = useState(false);
  const [out, setOut] = useState(false);
  const lyricsState = useTrackLyrics();

  useEffect(() => setCoverFailed(false), [track?.coverUrl]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOut(true));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Şarkı kapatılırsa ekran da kapanır
  useEffect(() => {
    if (!track) onClose();
  }, [track, onClose]);

  if (!track) return null;

  const VolumeIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === 'one' ? Repeat1 : Repeat;
  const cover = track.coverUrl && !coverFailed ? track.coverUrl : null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('nowPlaying.title')} className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-night text-paper animate-rise">
      {/* Kapaktan arka plan */}
      {cover && (
        <img src={cover} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-45 blur-3xl saturate-150" />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-night/40 via-night/70 to-night" />
      <div aria-hidden className="np-grain pointer-events-none absolute inset-0 opacity-[0.07]" />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <button
          type="button"
          onClick={onClose}
          title={`${t('nowPlaying.close')} (Esc)`}
          className="inline-flex items-center gap-2 rounded-full bg-white/10 py-2 pr-4 pl-3 text-sm font-semibold text-paper ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20"
        >
          <ChevronDown className="size-5" />
          {t('nowPlaying.close')}
        </button>
        <p className="hidden text-xs font-bold tracking-[0.2em] text-paper/60 uppercase sm:block">{t('nowPlaying.title')}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('nowPlaying.close')}
          title={`${t('nowPlaying.close')} (Esc)`}
          className="grid size-10 place-items-center rounded-full bg-white/10 text-paper ring-1 ring-white/15 transition hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="relative grid min-h-0 flex-1 gap-8 overflow-y-auto px-5 pb-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:overflow-hidden lg:px-14">
        {/* Sol: plak + kapak + kontroller */}
        <section className="flex min-h-0 flex-col items-center justify-center gap-7 lg:items-start">
          <div
            className="relative shrink-0"
            style={{ width: 'calc(min(68vw, 42vh, 380px) * 1.3)', height: 'min(68vw, 42vh, 380px)' }}
          >
            <div
              aria-hidden
              className={clsx(
                'absolute top-[3%] left-[3%] aspect-square w-[94%] max-w-[calc(min(68vw,42vh,380px)*0.94)] transition-transform duration-[1100ms] ease-[cubic-bezier(.2,.7,.2,1)]',
                out ? 'translate-x-[28%]' : 'translate-x-0',
              )}
            >
              <div className={clsx('vinyl-grooves size-full rounded-full', p.playing && 'animate-record')}>
                <div className="absolute inset-[34%] overflow-hidden rounded-full">
                  {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <span className="block size-full bg-amber" />}
                  <span className="absolute inset-[42%] rounded-full bg-night" />
                </div>
              </div>
            </div>
            <div
              className="relative z-10 overflow-hidden rounded-lg bg-raised shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)]"
              style={{ width: 'min(68vw, 42vh, 380px)', height: 'min(68vw, 42vh, 380px)' }}
            >
              {cover ? (
                <img src={cover} alt="" className="size-full object-cover" onError={() => setCoverFailed(true)} />
              ) : (
                <Disc3 className="m-auto size-1/3 h-full text-fade" strokeWidth={1.25} />
              )}
            </div>
          </div>

          <div className="w-full max-w-xl text-center lg:text-left">
            {track.kind === 'preview' && (
              <span className="mb-2 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-paper/70 uppercase">
                {t('player.preview')}
              </span>
            )}
            <h2 className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">{track.title}</h2>
            <p className="mt-1.5 text-lg text-paper/70">
              <ArtistLinks names={track.artist} />
              {track.album && <span className="text-paper/45"> · {track.album}</span>}
            </p>
          </div>

          <div className="w-full max-w-xl">
            <SeekBar />
            <div className="mt-3 flex items-center justify-center gap-2 lg:justify-start">
              <button type="button" onClick={p.toggleShuffle} aria-pressed={p.shuffle} title={t('player.shuffle')} aria-label={t('player.shuffle')} className={round(p.shuffle)}>
                <Shuffle className="size-5" />
              </button>
              <button type="button" onClick={p.prev} title={t('player.prev')} aria-label={t('player.prev')} className={round(false)}>
                <SkipBack className="size-6 fill-current" />
              </button>
              <button
                type="button"
                onClick={p.toggle}
                title={p.playing ? t('player.pause') : t('player.play')}
                aria-label={p.playing ? t('player.pause') : t('player.play')}
                className="mx-2 grid size-16 place-items-center rounded-full bg-paper text-night shadow-xl shadow-black/40 transition hover:scale-105"
              >
                {p.loading && p.playing ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : p.playing ? (
                  <Pause className="size-6 fill-current" />
                ) : (
                  <Play className="ml-1 size-6 fill-current" />
                )}
              </button>
              <button type="button" onClick={p.next} title={t('player.next')} aria-label={t('player.next')} className={round(false)}>
                <SkipForward className="size-6 fill-current" />
              </button>
              <button
                type="button"
                onClick={p.cycleRepeat}
                title={t(p.repeat === 'off' ? 'player.repeatOff' : p.repeat === 'all' ? 'player.repeatAll' : 'player.repeatOne')}
                aria-label={t('player.repeatAll')}
                className={round(p.repeat !== 'off')}
              >
                <RepeatIcon className="size-5" />
              </button>
            </div>
            <div className="mt-4 flex items-center justify-center gap-1 lg:justify-start">
              <button type="button" onClick={p.toggleMute} aria-label={p.muted ? t('player.unmute') : t('player.mute')} className={round(false)}>
                <VolumeIcon className="size-5" />
              </button>
              <RangeSlider value={p.muted ? 0 : p.volume} max={1} step={0.01} onChange={p.setVolume} label={t('player.volume')} className="w-32" />
              <span className="mx-2 h-5 w-px bg-white/15" />
              <SleepTimerButton side="top" />
              {track.libraryId && <AddToPlaylist trackIds={[track.libraryId]} side="top" />}
              {track.kind === 'preview' && track.sourceUrl && (
                <button
                  type="button"
                  onClick={() => onDownload(track.sourceUrl!)}
                  title={t('player.download')}
                  aria-label={t('player.download')}
                  className={round(false)}
                >
                  <Download className="size-5" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Sağ: sözler / sıradakiler */}
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-3xl bg-black/25 ring-1 ring-white/10 backdrop-blur-md lg:my-4 lg:min-h-0">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            {(['lyrics', 'queue'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={tab === k}
                onClick={() => setTab(k)}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition',
                  tab === k ? 'bg-paper text-night' : 'text-paper/70 hover:text-paper',
                )}
              >
                {k === 'lyrics' ? <MicVocal className="size-4" /> : <ListMusic className="size-4" />}
                {k === 'lyrics' ? t('lyrics.title') : t('player.queueTitle', { count: p.queue.length })}
              </button>
            ))}
            <span className="ml-auto">{tab === 'lyrics' && <SaveLyricsButton lyricsState={lyricsState} />}</span>
          </div>
          {tab === 'lyrics' ? (
            <LyricsLines state={lyricsState.state} size="lg" />
          ) : (
            <ol className="min-h-0 flex-1 overflow-y-auto py-2">
              {p.queue.map((q, i) => (
                <li key={`${q.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => p.jumpTo(i)}
                    className={clsx('flex w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-white/5', i === p.index && 'bg-white/10')}
                  >
                    <span className="w-6 text-right text-xs text-paper/50 tabular-nums">{i + 1}</span>
                    <span className="size-10 shrink-0 overflow-hidden rounded bg-raised">
                      {q.coverUrl && <img src={q.coverUrl} alt="" loading="lazy" className="size-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block truncate font-semibold', i === p.index ? 'text-amber' : 'text-paper')}>{q.title}</span>
                      <span className="block truncate text-sm text-paper/60">{q.artist}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
