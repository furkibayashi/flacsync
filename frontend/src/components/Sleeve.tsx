import clsx from 'clsx';
import { Disc3, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

function PreviewButton({ url }: { url: string }) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio(url);
    audio.volume = 0.8;
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onStop);
    audio.addEventListener('ended', onStop);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [url]);

  return (
    <button
      type="button"
      onClick={() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play().catch(() => setPlaying(false));
        else audio.pause();
      }}
      aria-label={playing ? t('track.previewPause') : t('track.previewPlay')}
      title={playing ? t('track.previewPause') : t('track.previewPlay')}
      className="absolute bottom-3 left-3 z-20 grid size-11 place-items-center rounded-full bg-paper text-night shadow-lg shadow-black/40 transition hover:scale-105"
    >
      {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
    </button>
  );
}

interface Props {
  coverUrl: string | null;
  alt: string;
  /** İndirme sürerken plak döner */
  spinning: boolean;
  previewUrl: string | null;
}

/**
 * Plak kapağı + arkasından kayarak çıkan plak. Uygulamanın tek "gösterişli" öğesi:
 * şarkı yüklenince plak kapaktan çıkar, indirme boyunca döner.
 * Her yeni şarkıda `key` ile yeniden mount edilir ki çıkış animasyonu tekrar oynasın.
 */
export function Sleeve({ coverUrl, alt, spinning, previewUrl }: Props) {
  const [failed, setFailed] = useState(false);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setOut(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="relative shrink-0" style={{ width: 'calc(var(--cover) * 1.32)', height: 'var(--cover)' }}>
      {/* Plak */}
      <div
        aria-hidden
        className={clsx(
          'absolute top-[4%] left-[4%] aspect-square w-[calc(var(--cover)*0.92)] transition-transform duration-[900ms] ease-[cubic-bezier(.2,.7,.2,1)]',
          out ? 'translate-x-[34%]' : 'translate-x-0',
        )}
      >
        <div className={clsx('vinyl-grooves size-full rounded-full', spinning && 'animate-record')}>
          <div
            className="absolute inset-[33%] grid place-items-center rounded-full"
            style={{ backgroundColor: 'rgb(var(--art))' }}
          >
            <span className="size-[14%] rounded-full bg-night" />
          </div>
        </div>
      </div>

      {/* Kapak */}
      <div
        className="relative z-10 overflow-hidden rounded-[6px] bg-raised shadow-[0_30px_60px_-24px_rgb(0_0_0/0.85)]"
        style={{ width: 'var(--cover)', height: 'var(--cover)' }}
      >
        {coverUrl && !failed ? (
          <img src={coverUrl} alt={alt} className="size-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <div className="grid size-full place-items-center text-fade">
            <Disc3 className="size-1/3" strokeWidth={1.25} />
          </div>
        )}
        {previewUrl && <PreviewButton url={previewUrl} />}
      </div>
    </div>
  );
}
