import clsx from 'clsx';
import {
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
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { ArtistLinks } from './ArtistLinks';
import { LyricsPanel } from './LyricsPanel';
import { usePlayer, usePlayerProgress } from '../state/PlayerProvider';

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** Doldurulmuş kısmı vurgu renginde olan kaydırıcı */
function Slider({
  value,
  max,
  onChange,
  label,
  className,
  step = 'any',
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
  step?: number | 'any';
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <input
      type="range"
      min={0}
      max={max || 1}
      step={step}
      value={Math.min(value, max || 1)}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      className={clsx('fs-range', className)}
      style={{ '--fill': `${pct}%` } as CSSProperties}
    />
  );
}

function SeekBar() {
  const { seek } = usePlayer();
  const { time, duration } = usePlayerProgress();
  const { t } = useI18n();
  // Sürüklerken anlık değer gösterilir, bırakınca atlanır
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? time;
  return (
    <div className="flex w-full items-center gap-2 text-[11px] text-fade tabular-nums">
      <span className="w-9 text-right">{clock(shown)}</span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step="any"
        value={Math.min(shown, duration || 1)}
        disabled={!duration}
        aria-label={t('player.seek')}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        className="fs-range flex-1"
        style={{ '--fill': `${duration ? (shown / duration) * 100 : 0}%` } as CSSProperties}
      />
      <span className="w-9">{clock(duration)}</span>
    </div>
  );
}

function QueuePopover({ onClose }: { onClose: () => void }) {
  const { queue, index, jumpTo } = usePlayer();
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 bottom-[calc(100%+12px)] z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl bg-panel shadow-2xl shadow-black/50 ring-1 ring-rule"
    >
      <p className="border-b border-rule px-4 py-3 font-display text-sm font-bold text-paper">
        {t('player.queueTitle', { count: queue.length })}
      </p>
      <ol className="max-h-80 overflow-y-auto py-1">
        {queue.map((track, i) => (
          <li key={`${track.id}-${i}`}>
            <button
              type="button"
              aria-current={i === index}
              onClick={() => jumpTo(i)}
              className={clsx(
                'flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-raised',
                i === index && 'bg-raised/70',
              )}
            >
              <span className="w-5 shrink-0 text-right text-xs text-fade tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-sm', i === index ? 'font-semibold text-amber' : 'text-paper')}>
                  {track.title}
                </span>
                <span className="block truncate text-xs text-dust">{track.artist}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const iconBase =
  'grid size-9 place-items-center rounded-full transition hover:bg-raised disabled:pointer-events-none disabled:opacity-30';
/** Renk sınıfları çakışmasın diye (Tailwind'de sonra gelen kazanmaz) durum rengi ayrı verilir */
const iconBtn = (on = false) => clsx(iconBase, on ? 'text-amber hover:text-amber-hi' : 'text-dust hover:text-paper');

/** Altta sabit oynatıcı: önceki / sonraki, karıştır, tekrar, ses seviyesi, sıra. */
export function PlayerBar({ onDownload }: { onDownload: (url: string) => void }) {
  const { t } = useI18n();
  const p = usePlayer();
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const track = p.current;

  useEffect(() => setCoverFailed(false), [track?.coverUrl]);

  if (!track) return null;

  const VolumeIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === 'one' ? Repeat1 : Repeat;
  const repeatLabel = t(p.repeat === 'off' ? 'player.repeatOff' : p.repeat === 'all' ? 'player.repeatAll' : 'player.repeatOne');

  return (
    <div
      role="region"
      aria-label={t('player.label')}
      className="fixed inset-x-0 bottom-[60px] z-40 border-t border-rule bg-panel/95 backdrop-blur-xl md:bottom-0 md:left-64"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2.5 sm:gap-5 sm:px-6">
        {/* Parça */}
        <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[28%] md:flex-none">
          <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-raised shadow-md shadow-black/30">
            {track.coverUrl && !coverFailed ? (
              <img src={track.coverUrl} alt="" className="size-full object-cover" onError={() => setCoverFailed(true)} />
            ) : (
              <Disc3 className={clsx('m-2.5 size-7 text-fade', p.playing && 'animate-record')} strokeWidth={1.5} />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-paper">{track.title}</span>
            <span className="flex items-center gap-1.5 text-xs text-dust">
              {track.kind === 'preview' && (
                <span className="shrink-0 rounded bg-raised px-1.5 py-px text-[10px] font-bold tracking-wide text-fade uppercase">
                  {t('player.preview')}
                </span>
              )}
              <ArtistLinks names={track.artist} className="truncate" />
            </span>
            {p.error && <span className="block text-xs text-danger">{t('player.error')}</span>}
          </span>
        </div>

        {/* Kontroller */}
        <div className="flex flex-col items-center gap-0.5 md:flex-1">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={p.toggleShuffle}
              aria-pressed={p.shuffle}
              title={t('player.shuffle')}
              aria-label={t('player.shuffle')}
              className={clsx(iconBtn(p.shuffle), 'hidden sm:grid')}
            >
              <Shuffle className="size-4" />
            </button>
            <button type="button" onClick={p.prev} title={t('player.prev')} aria-label={t('player.prev')} className={clsx(iconBtn(), 'hidden sm:grid')}>
              <SkipBack className="size-[18px] fill-current" />
            </button>
            <button
              type="button"
              onClick={p.toggle}
              title={p.playing ? t('player.pause') : t('player.play')}
              aria-label={p.playing ? t('player.pause') : t('player.play')}
              className="grid size-10 place-items-center rounded-full bg-paper text-night transition hover:scale-105"
            >
              {p.loading && p.playing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : p.playing ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="ml-0.5 size-4 fill-current" />
              )}
            </button>
            <button
              type="button"
              onClick={p.next}
              disabled={p.queue.length < 2 && p.repeat !== 'all'}
              title={t('player.next')}
              aria-label={t('player.next')}
              className={iconBtn()}
            >
              <SkipForward className="size-[18px] fill-current" />
            </button>
            <button
              type="button"
              onClick={p.cycleRepeat}
              title={repeatLabel}
              aria-label={repeatLabel}
              className={clsx(iconBtn(p.repeat !== 'off'), 'relative hidden sm:grid')}
            >
              <RepeatIcon className="size-4" />
              {p.repeat !== 'off' && <span className="absolute bottom-0.5 size-1 rounded-full bg-amber" />}
            </button>
          </div>
          <div className="hidden w-full max-w-xl md:block">
            <SeekBar />
          </div>
        </div>

        {/* Ses, sıra, indir */}
        <div className="flex items-center justify-end gap-0.5 md:w-[28%]">
          <button
            type="button"
            onClick={() => setShowLyrics((v) => !v)}
            aria-pressed={showLyrics}
            title={t('lyrics.title')}
            aria-label={t('lyrics.title')}
            className={iconBtn(showLyrics)}
          >
            <MicVocal className="size-[18px]" />
          </button>
          {track.kind === 'preview' && track.sourceUrl && (
            <button
              type="button"
              onClick={() => onDownload(track.sourceUrl!)}
              title={t('player.download')}
              aria-label={t('player.download')}
              className={clsx(iconBtn(), 'hidden sm:grid')}
            >
              <Download className="size-4" />
            </button>
          )}
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setShowQueue((v) => !v)}
              aria-expanded={showQueue}
              title={t('player.queue')}
              aria-label={t('player.queue')}
              className={iconBtn(showQueue)}
            >
              <ListMusic className="size-[18px]" />
            </button>
            {showQueue && <QueuePopover onClose={() => setShowQueue(false)} />}
          </div>
          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={p.toggleMute}
              title={p.muted ? t('player.unmute') : t('player.mute')}
              aria-label={p.muted ? t('player.unmute') : t('player.mute')}
              className={iconBtn()}
            >
              <VolumeIcon className="size-[18px]" />
            </button>
            <Slider
              value={p.muted ? 0 : p.volume}
              max={1}
              step={0.01}
              onChange={p.setVolume}
              label={t('player.volume')}
              className="w-16 lg:w-24"
            />
          </div>
          <button type="button" onClick={p.close} title={t('player.close')} aria-label={t('player.close')} className={iconBtn()}>
            <X className="size-4" />
          </button>
        </div>
      </div>
      {showLyrics && <LyricsPanel onClose={() => setShowLyrics(false)} />}
      {/* Mobilde ince ilerleme çizgisi */}
      <MobileProgress />
    </div>
  );
}

function MobileProgress() {
  const { time, duration } = usePlayerProgress();
  return (
    <span className="absolute inset-x-0 top-0 h-0.5 bg-rule md:hidden">
      <span className="block h-full bg-amber" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
    </span>
  );
}

export { Slider as RangeSlider };
