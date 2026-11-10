import { Disc3, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useDesignStyle, useTheme } from '../state/settings';

const drag = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const clock = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/**
 * Mini oynatıcı penceresi (#/mini). Ses çalmaz: durumu ana pencereden alır, komutları ona gönderir.
 * Pencere çerçevesizdir; boş alanlardan tutup sürüklenir.
 */
export function MiniPlayer() {
  const { t } = useI18n();
  useTheme();
  useDesignStyle();
  const desktop = window.flacsync;
  const [np, setNp] = useState<DesktopNowPlaying | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void desktop.getNowPlaying().then(setNp);
    return desktop.onNowPlaying((s) => setNp(s));
  }, [desktop]);
  useEffect(() => setCoverFailed(false), [np?.coverUrl]);

  // Süre, bildirimler arasında akıcı ilerlesin
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!np?.playing) return;
    const started = Date.now();
    setTick(0);
    const timer = setInterval(() => setTick((Date.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, [np]);
  const time = np ? Math.min(np.duration || Infinity, np.time + (np.playing ? tick : 0)) : 0;
  const pct = np?.duration ? (time / np.duration) * 100 : 0;

  const btn = 'grid size-9 place-items-center rounded-full text-paper/80 transition hover:bg-white/10 hover:text-paper';

  return (
    <div style={drag} className="relative flex h-screen select-none items-center gap-3 overflow-hidden bg-night px-3 text-paper">
      {np?.coverUrl && !coverFailed && (
        <img src={np.coverUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full scale-150 object-cover opacity-30 blur-2xl" />
      )}
      <span className="relative size-[88px] shrink-0 overflow-hidden rounded-lg bg-raised shadow-lg shadow-black/40">
        {np?.coverUrl && !coverFailed ? (
          <img src={np.coverUrl} alt="" className="size-full object-cover" onError={() => setCoverFailed(true)} />
        ) : (
          <Disc3 className={`m-auto mt-6 size-10 text-fade ${np?.playing ? 'animate-record' : ''}`} />
        )}
      </span>
      <div className="relative flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="min-w-0 pr-14">
          <p className="truncate font-display text-[15px] font-bold">{np?.title ?? t('mini.idle')}</p>
          <p className="truncate text-xs text-paper/60">{np?.artist ?? 'FlacSync'}</p>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-amber transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div style={noDrag} className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => desktop?.playerCommand('prev')} aria-label={t('player.prev')} disabled={!np}>
            <SkipBack className="size-4 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => desktop?.playerCommand('toggle')}
            disabled={!np}
            aria-label={np?.playing ? t('player.pause') : t('player.play')}
            className="grid size-9 place-items-center rounded-full bg-paper text-night transition hover:scale-105 disabled:opacity-40"
          >
            {np?.playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </button>
          <button type="button" className={btn} onClick={() => desktop?.playerCommand('next')} aria-label={t('player.next')} disabled={!np}>
            <SkipForward className="size-4 fill-current" />
          </button>
          <span className="ml-auto text-[11px] text-paper/50 tabular-nums">
            {clock(time)} / {clock(np?.duration ?? 0)}
          </span>
        </div>
      </div>
      <div style={noDrag} className="absolute top-1.5 right-1.5 flex gap-0.5">
        <button type="button" onClick={() => desktop?.showMain()} title={t('mini.showMain')} aria-label={t('mini.showMain')} className="grid size-7 place-items-center rounded-full text-paper/60 hover:bg-white/10 hover:text-paper">
          <Maximize2 className="size-3.5" />
        </button>
        <button type="button" onClick={() => window.close()} title={t('mini.close')} aria-label={t('mini.close')} className="grid size-7 place-items-center rounded-full text-paper/60 hover:bg-white/10 hover:text-paper">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
