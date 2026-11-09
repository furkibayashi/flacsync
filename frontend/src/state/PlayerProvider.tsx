import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import { useVolumeSetting } from './settings';

/** Oynatıcıda çalınabilen her şey: 30 sn önizlemeler ve kütüphanedeki tam dosyalar. */
export interface PlayerTrack {
  /** Kuyrukta benzersiz kimlik */
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  src: string;
  /** preview = 30 sn örnek; full = kütüphanedeki dosya */
  kind: 'preview' | 'full';
  /** İndirme akışına verilecek link (önizlemelerde "İndir" için) */
  sourceUrl?: string | null;
  /** saniye (tam şarkının süresi; söz eşleştirmede kullanılır) */
  duration?: number | null;
  /** Kütüphane kaydı (sözler dosyadan okunur / dosyaya gömülür) */
  libraryId?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  sleepTimer: SleepTimer;
  queue: PlayerTrack[];
  index: number;
  current: PlayerTrack | null;
  playing: boolean;
  loading: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  error: boolean;
}

interface PlayerActions {
  /** Listeyi kuyruğa alıp `start` sıradakini çalar; `shuffle` ile karışık başlar */
  playList: (tracks: PlayerTrack[], start?: number, options?: { shuffle?: boolean }) => void;
  /** Tek parça: zaten çalıyorsa duraklat / devam */
  toggleTrack: (track: PlayerTrack) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  /** Anlık konum (sn) — saniyede 60 kez okunabilir (sözlerin kelime kelime akışı için) */
  getTime: () => number;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (index: number) => void;
  close: () => void;
  /** Uyku zamanlayıcı: dakika sonra ya da 'track' = bu şarkı bitince durur; null iptal eder */
  setSleepTimer: (value: number | 'track' | null) => void;
}

export type SleepTimer = { kind: 'minutes'; endsAt: number } | { kind: 'track' } | null;

interface Progress {
  time: number;
  duration: number;
}

const PlayerContext = createContext<(PlayerState & PlayerActions) | null>(null);
const ProgressContext = createContext<Progress>({ time: 0, duration: 0 });

/** Kaydırıcı → gerçek ses: insan kulağı logaritmik duyar, doğrusal kaydırıcı hep "çok yüksek" gelir. */
const perceptual = (v: number) => Math.pow(Math.min(Math.max(v, 0), 1), 2);

function shuffled<T>(items: T[], keepFirst?: T): T[] {
  const rest = keepFirst === undefined ? [...items] : items.filter((i) => i !== keepFirst);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return keepFirst === undefined ? rest : [keepFirst, ...rest];
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolumeSetting] = useVolumeSetting();
  const [muted, setMuted] = useState(false);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  /** Karıştırma kapatılınca dönülecek asıl sıra */
  const [original, setOriginal] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [progress, setProgress] = useState<Progress>({ time: 0, duration: 0 });
  /** Aynı parça yeniden seçilince de baştan çalınsın diye */
  const [playNonce, setPlayNonce] = useState(0);
  const [sleepTimer, setSleepTimerState] = useState<SleepTimer>(null);
  const sleepRef = useRef<SleepTimer>(null);
  sleepRef.current = sleepTimer;

  const current = index >= 0 ? queue[index] ?? null : null;

  // Tek ses öğesi; uygulama boyunca yaşar
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
    audioRef.current.preload = 'auto';
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = perceptual(volume);
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
  }, [muted]);

  // Parça değişince kaynağı yükle ve çal
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (audio.src !== new URL(current.src, window.location.href).href) {
      audio.src = current.src;
      setProgress({ time: 0, duration: 0 });
    } else {
      audio.currentTime = 0;
    }
    setError(false);
    setLoading(true);
    void audio.play().catch((err: Error) => {
      if (err.name !== 'AbortError') {
        setLoading(false);
        setPlaying(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, playNonce]);

  const advance = useCallback(
    (direction: 1 | -1, auto: boolean) => {
      if (queue.length === 0) return;
      const go = (i: number) => {
        setIndex(i);
        setPlayNonce((n) => n + 1);
      };
      if (auto && repeat === 'one') {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          void audio.play().catch(() => undefined);
        }
        return;
      }
      const nextIndex = index + direction;
      if (nextIndex >= queue.length) {
        if (repeat === 'all') go(0);
        else if (auto) {
          // Liste bitti: başa sar ama çalma
          setPlaying(false);
          audioRef.current?.pause();
        } else go(0);
        return;
      }
      if (nextIndex < 0) {
        go(repeat === 'all' ? queue.length - 1 : 0);
        if (repeat !== 'all' && audioRef.current) audioRef.current.currentTime = 0;
        return;
      }
      go(nextIndex);
    },
    [index, queue.length, repeat],
  );

  // Ses olayları
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let lastTick = 0;
    const onTime = () => {
      const now = performance.now();
      if (now - lastTick < 200) return;
      lastTick = now;
      setProgress({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    };
    const onMeta = () => setProgress({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onPlaying = () => setLoading(false);
    const onWaiting = () => setLoading(true);
    const onEnded = () => {
      if (sleepRef.current?.kind === 'track') {
        setSleepTimerState(null);
        setPlaying(false);
        return;
      }
      advanceRef.current(1, true);
    };
    const onError = () => {
      if (!audio.getAttribute('src')) return;
      setError(true);
      setLoading(false);
      setPlaying(false);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      if (audio.ended || (error && audio.currentTime === 0)) audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } else audio.pause();
  }, [current, error]);

  const playList = useCallback<PlayerActions['playList']>((tracks, start = 0, options) => {
    if (tracks.length === 0) return;
    const first = tracks[Math.min(Math.max(start, 0), tracks.length - 1)]!;
    const doShuffle = options?.shuffle ?? false;
    setOriginal(tracks);
    setShuffle(doShuffle);
    if (doShuffle) {
      // Karışık başlatmada ilk parça da rastgele seçilir (start verilmediyse)
      const list = start > 0 ? shuffled(tracks, first) : shuffled(tracks);
      setQueue(list);
    } else {
      setQueue(tracks);
    }
    setIndex(doShuffle ? 0 : tracks.indexOf(first));
    setPlayNonce((n) => n + 1);
  }, []);

  const toggleTrack = useCallback<PlayerActions['toggleTrack']>(
    (track) => {
      if (current?.id === track.id) toggle();
      else playList([track]);
    },
    [current?.id, toggle, playList],
  );

  const toggleShuffle = useCallback(() => {
    const on = !shuffle;
    setShuffle(on);
    if (!current) return;
    // Çalan parça yerinde kalır; yalnızca sıradakiler karışır / eski sırasına döner
    if (on) {
      setOriginal(queue);
      setQueue(shuffled(queue, current));
      setIndex(0);
    } else {
      const base = original.length ? original : queue;
      setQueue(base);
      setIndex(Math.max(0, base.findIndex((t) => t.id === current.id)));
    }
  }, [shuffle, current, queue, original]);

  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), []);

  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(seconds)) {
      audio.currentTime = Math.max(0, seconds);
      setProgress((p) => ({ ...p, time: audio.currentTime }));
    }
  }, []);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    // Spotify gibi: 3 sn'den sonra "önceki" parçanın başına sarar
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    advance(-1, false);
  }, [advance]);

  const next = useCallback(() => advance(1, false), [advance]);

  const setVolume = useCallback(
    (v: number) => {
      setVolumeSetting(Math.round(Math.min(Math.max(v, 0), 1) * 100) / 100);
      if (v > 0) setMuted(false);
    },
    [setVolumeSetting],
  );

  // --- Uyku zamanlayıcı: süre dolunca 8 sn'de sesi kısıp durdurur --------------------------------
  const fadeAndStop = useCallback(() => {
    const audio = audioRef.current;
    setSleepTimerState(null);
    if (!audio || audio.paused) return;
    const start = audio.volume;
    const steps = 32;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      audio.volume = Math.max(0, start * (1 - i / steps));
      if (i >= steps) {
        clearInterval(timer);
        audio.pause();
        audio.volume = start;
      }
    }, 250);
  }, []);

  useEffect(() => {
    if (sleepTimer?.kind !== 'minutes') return;
    const ms = sleepTimer.endsAt - Date.now();
    const timer = setTimeout(fadeAndStop, Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [sleepTimer, fadeAndStop]);

  const setSleepTimer = useCallback((value: number | 'track' | null) => {
    if (value === null) setSleepTimerState(null);
    else if (value === 'track') setSleepTimerState({ kind: 'track' });
    else setSleepTimerState({ kind: 'minutes', endsAt: Date.now() + value * 60_000 });
  }, []);

  // --- Dinlenme sayısı: kütüphane şarkısı 30 sn çalınınca bir kez bildirilir -----------------------
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    reportedRef.current = null;
  }, [current, playNonce]);
  useEffect(() => {
    const id = current?.libraryId;
    if (!id || reportedRef.current === current?.id || progress.time < 30) return;
    reportedRef.current = current.id;
    void api.markPlayed(id).catch(() => undefined);
  }, [current, progress.time]);

  const close = useCallback(() => {
    setQueue([]);
    setOriginal([]);
    setIndex(-1);
    setPlaying(false);
  }, []);

  // Klavye: boşluk = çal / duraklat, ←/→ = 5 sn, Shift+←/→ = önceki / sonraki
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const audio = audioRef.current;
      if (e.code === 'Space') {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight' && audio) {
        if (e.shiftKey) next();
        else audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || audio.currentTime + 5);
      } else if (e.key === 'ArrowLeft' && audio) {
        if (e.shiftKey) prev();
        else audio.currentTime = Math.max(0, audio.currentTime - 5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, toggle, next, prev]);

  // Klavyedeki medya tuşları ve Windows medya kontrolleri
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    if (current) {
      ms.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album ?? undefined,
        artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: '600x600' }] : [],
      });
    } else ms.metadata = null;
    ms.setActionHandler('play', () => toggle());
    ms.setActionHandler('pause', () => toggle());
    ms.setActionHandler('nexttrack', () => next());
    ms.setActionHandler('previoustrack', () => prev());
  }, [current, toggle, next, prev]);

  const value = useMemo(
    () => ({
      queue,
      index,
      current,
      playing,
      loading,
      shuffle,
      repeat,
      volume,
      muted,
      error,
      playList,
      toggleTrack,
      toggle,
      next,
      prev,
      seek,
      getTime,
      setVolume,
      toggleMute: () => setMuted((m) => !m),
      toggleShuffle,
      cycleRepeat,
      jumpTo: (i: number) => {
        setIndex(i);
        setPlayNonce((n) => n + 1);
      },
      close,
      sleepTimer,
      setSleepTimer,
    }),
    [queue, index, current, playing, loading, shuffle, repeat, volume, muted, error, playList, toggleTrack, toggle, next, prev, seek, getTime, setVolume, toggleShuffle, cycleRepeat, close, sleepTimer, setSleepTimer],
  );

  return (
    <PlayerContext.Provider value={value}>
      <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer, PlayerProvider içinde kullanılmalı');
  return ctx;
}

/** Çalma süresi ayrı bağlamda: saniyede birkaç kez değişir, tüm uygulamayı yeniden çizmesin */
export const usePlayerProgress = () => useContext(ProgressContext);

/** Bu parça şu an çalıyor mu? (liste satırlarındaki çal / duraklat düğmeleri için) */
export function useIsPlaying(id: string | undefined): { active: boolean; playing: boolean } {
  const { current, playing } = usePlayer();
  const active = Boolean(id) && current?.id === id;
  return { active, playing: active && playing };
}
