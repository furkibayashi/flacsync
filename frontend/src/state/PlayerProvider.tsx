import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import { AudioEngine, EQ_PRESETS } from './audioEngine';
import { useCrossfadeSetting, useEqCustomSetting, useEqPresetSetting, useNormalizeSetting, useVolumeSetting } from './settings';

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
  /** Ölçülen yükseklik (LUFS) — ses eşitleme için */
  loudness?: number | null;
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
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current && typeof Audio !== 'undefined') engineRef.current = new AudioEngine();
  /** Her zaman o an çalan öğeyi verir (önizleme ya da deck) */
  const audioRef = useMemo(() => ({ get current() { return engineRef.current?.active ?? null; } }), []);
  const [volume, setVolumeSetting] = useVolumeSetting();
  const [normalize] = useNormalizeSetting();
  const [crossfadeSec] = useCrossfadeSetting();
  const [eqPreset] = useEqPresetSetting();
  const [eqCustom] = useEqCustomSetting();
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

  useEffect(() => engineRef.current?.setVolume(perceptual(volume)), [volume]);
  useEffect(() => engineRef.current?.setMuted(muted), [muted]);
  useEffect(() => engineRef.current?.setNormalize(normalize), [normalize]);
  useEffect(() => {
    engineRef.current?.setEq(eqPreset === 'custom' ? eqCustom : EQ_PRESETS[eqPreset] ?? EQ_PRESETS.flat!);
  }, [eqPreset, eqCustom]);

  // Parça değişince kaynağı yükle ve çal
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    crossfadingRef.current = false;
    if (!current) {
      engine.stopAll();
      return;
    }
    const { el: audio, reused, started } = engine.load(current.src, current.kind, current.loudness);
    setError(false);
    if (started) {
      // Crossfade ile zaten başladı
      setProgress({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
      setPlaying(true);
      return;
    }
    if (!reused) setProgress({ time: 0, duration: 0 });
    else audio.currentTime = 0;
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
    (direction: 1 | -1, auto: boolean, crossfaded = false) => {
      if (queue.length === 0) return;
      const go = (i: number) => {
        setIndex(i);
        if (!crossfaded) setPlayNonce((n) => n + 1);
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
  const crossfadingRef = useRef(false);
  const crossfadeRef = useRef(crossfadeSec);
  crossfadeRef.current = crossfadeSec;
  /** Boşluksuz / crossfade için sıradaki tam şarkı (tekrar-tek modunda yok) */
  const nextFullRef = useRef<PlayerTrack | null>(null);
  {
    const nextIdx = index + 1 < queue.length ? index + 1 : repeat === 'all' ? 0 : -1;
    const candidate = repeat === 'one' || nextIdx < 0 ? null : queue[nextIdx] ?? null;
    nextFullRef.current = candidate && candidate.kind === 'full' && current?.kind === 'full' ? candidate : null;
  }
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let lastTick = 0;
    const onTimeRaw = (audio: HTMLAudioElement) => {
      const remaining = audio.duration - audio.currentTime;
      const nextTrack = nextFullRef.current;
      // Sıradaki tam şarkı: son 10 sn'de önceden yüklenir; crossfade açıksa süresi gelince geçilir
      if (nextTrack && Number.isFinite(remaining) && audio !== engine.preview) {
        if (remaining < 10) engine.preload(nextTrack.src);
        const cf = crossfadeRef.current;
        if (cf > 0 && remaining <= cf && !crossfadingRef.current && audio.duration > cf * 3) {
          crossfadingRef.current = true;
          engine.crossfade(nextTrack.src, cf, nextTrack.loudness);
          advanceRef.current(1, true, true);
        }
      }
      const now = performance.now();
      if (now - lastTick < 200) return;
      lastTick = now;
      setProgress({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    };
    const guard = (fn: (audio: HTMLAudioElement) => void) => (e: Event) => {
      if (e.currentTarget === engine.active) fn(e.currentTarget as HTMLAudioElement);
    };
    const onTime = guard(onTimeRaw);
    const onMeta = guard((audio) =>
      setProgress({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }),
    );
    const onPlay = guard(() => setPlaying(true));
    const onPause = guard(() => setPlaying(false));
    const onPlaying = guard(() => setLoading(false));
    const onWaiting = guard(() => setLoading(true));
    const onEnded = guard(() => {
      if (sleepRef.current?.kind === 'track') {
        setSleepTimerState(null);
        setPlaying(false);
        return;
      }
      if (crossfadingRef.current) return;
      advanceRef.current(1, true);
    });
    const onError = guard((audio) => {
      if (!audio.getAttribute('src')) return;
      setError(true);
      setLoading(false);
      setPlaying(false);
    });
    const events: Array<[string, (e: Event) => void]> = [
      ['timeupdate', onTime],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['play', onPlay],
      ['pause', onPause],
      ['playing', onPlaying],
      ['waiting', onWaiting],
      ['ended', onEnded],
      ['error', onError],
    ];
    for (const el of engine.elements) for (const [name, fn] of events) el.addEventListener(name, fn);
    return () => {
      for (const el of engine.elements) for (const [name, fn] of events) el.removeEventListener(name, fn);
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
    setSleepTimerState(null);
    engineRef.current?.fadeOutAndPause(8);
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
