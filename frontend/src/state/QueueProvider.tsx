import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isDesktopApp, toUiError, type UiError } from '../services/api';
import type { Batch, BatchItem, DownloadJob, OutputFormat, QueueSnapshot, QueueState } from '../types/api';

const RECONNECT_MS = 3000;

export const isTerminal = (job: DownloadJob | null | undefined) =>
  job?.status === 'completed' || job?.status === 'failed' || job?.status === 'cancelled';

interface QueueValue {
  jobs: Record<string, DownloadJob>;
  batches: Record<string, Batch>;
  /** En yeni önce */
  order: string[];
  connected: boolean;
  error: UiError | null;
  stats: { active: number; queued: number; completed: number; failed: number; cancelled: number };
  /** Tek şarkıyı sıraya ekler; iş kimliğini döndürür */
  enqueue: (url: string, format: OutputFormat) => Promise<DownloadJob | null>;
  /** Birden fazla parçayı tek toplu iş olarak sıraya ekler */
  enqueueBatch: (name: string, format: OutputFormat, items: BatchItem[], useFolder: boolean) => Promise<Batch | null>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  clearError: () => void;
  /** Art arda hatalarda kuyruk duraklar */
  state: QueueState;
  resume: (retryFailed: boolean) => Promise<void>;
}

const RUNNING: QueueState = { paused: false, reason: null, pausedAt: null };

const QueueContext = createContext<QueueValue | null>(null);

function triggerDownload(href: string, fileName?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Uygulamanın tek indirme durumu: sunucunun /queue/events akışına bağlanır.
 * Sayfa değişse de indirmeler izlenir ve biten dosyalar kaydedilir:
 *  - Masaüstü: her parça bitince (albümse kendi klasörüne)
 *  - Web: tek parça doğrudan, birden fazla parçalı toplu iş bitince ZIP
 */
export function QueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});
  const [batches, setBatches] = useState<Record<string, Batch>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [state, setState] = useState<QueueState>(RUNNING);

  /** Bu oturumda kaydedilenler; ilk anlık görüntüdeki bitmiş işler önceden kaydedilmiş sayılır */
  const saved = useRef(new Set<string>());
  const zipped = useRef(new Set<string>());
  /** Web / telefon: yalnızca bu sayfadan başlatılan indirmeler kaydedilir (masaüstünün bitirdikleri değil) */
  const mineJobs = useRef(new Set<string>());
  const mineBatches = useRef(new Set<string>());
  const isMine = (job: DownloadJob) => mineJobs.current.has(job.id) || (job.batchId !== null && mineBatches.current.has(job.batchId));

  const applySnapshot = useCallback((snap: QueueSnapshot) => {
    setState(snap.state ?? RUNNING);
    const finished = snap.jobs.filter((j) => isTerminal(j));
    for (const j of finished) saved.current.add(j.id);
    // Masaüstü: bağlantı kopukken / pencere yenilenirken biten dosyalar kaydedilmemiş olabilir
    const completed = finished.filter((j) => j.status === 'completed').map((j) => j.id);
    if (isDesktopApp && completed.length && window.flacsync?.unsavedJobs) {
      void window.flacsync.unsavedJobs(completed).then((ids) => {
        if (!ids.length) return;
        for (const id of ids) saved.current.delete(id);
        // kaydetme etkisi yeniden çalışsın
        setJobs((prev) => ({ ...prev }));
      });
    }
    for (const b of snap.batches) if (b.status !== 'running') zipped.current.add(b.id);
    setJobs(Object.fromEntries(snap.jobs.map((j) => [j.id, j])));
    setBatches(Object.fromEntries(snap.batches.map((b) => [b.id, b])));
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      source = new EventSource(api.queueEventsUrl());
      source.onopen = () => setConnected(true);
      source.addEventListener('snapshot', (e) => applySnapshot(JSON.parse((e as MessageEvent<string>).data)));
      source.addEventListener('job', (e) => {
        const { job, batch } = JSON.parse((e as MessageEvent<string>).data) as { job: DownloadJob; batch: Batch | null };
        setJobs((prev) => ({ ...prev, [job.id]: job }));
        if (batch) setBatches((prev) => ({ ...prev, [batch.id]: batch }));
      });
      source.addEventListener('state', (e) => setState(JSON.parse((e as MessageEvent<string>).data) as QueueState));
      source.addEventListener('removed', (e) => {
        const { id } = JSON.parse((e as MessageEvent<string>).data) as { id: string };
        setJobs((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      });
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!stopped) retryTimer = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [applySnapshot]);

  // Biten dosyaları kaydet
  useEffect(() => {
    for (const job of Object.values(jobs)) {
      if (job.status !== 'completed' || !job.file || saved.current.has(job.id)) continue;
      const batch = job.batchId ? batches[job.batchId] : undefined;
      if (job.batchId && !batch) continue; // toplu iş bilgisi henüz gelmedi
      if (!isDesktopApp && !isMine(job)) continue;
      if (!isDesktopApp && batch && batch.total > 1) continue; // web: ZIP ile
      saved.current.add(job.id);
      triggerDownload(api.fileUrl(job.id, isDesktopApp ? batch?.folder ?? undefined : undefined), job.file.name);
    }
    if (!isDesktopApp) {
      for (const batch of Object.values(batches)) {
        if (!mineBatches.current.has(batch.id)) continue;
        if (batch.total < 2 || batch.status === 'running' || batch.completed === 0 || zipped.current.has(batch.id)) continue;
        zipped.current.add(batch.id);
        triggerDownload(api.batchZipUrl(batch.id));
      }
    }
  }, [jobs, batches]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      setError(null);
      return await fn();
    } catch (err) {
      setError(toUiError(err));
      return null;
    }
  }, []);

  const enqueue = useCallback(
    async (url: string, format: OutputFormat) => {
      const job = await run(() => api.startDownload(url, format));
      if (job) mineJobs.current.add(job.id);
      if (job) setJobs((prev) => ({ ...prev, [job.id]: prev[job.id] ?? job }));
      return job;
    },
    [run],
  );

  const enqueueBatch = useCallback(
    async (name: string, format: OutputFormat, items: BatchItem[], useFolder: boolean) => {
      const batch = await run(() => api.startBatch(name, format, items, useFolder));
      if (batch) mineBatches.current.add(batch.id);
      if (batch) setBatches((prev) => ({ ...prev, [batch.id]: prev[batch.id] ?? batch }));
      return batch;
    },
    [run],
  );

  const cancel = useCallback(async (id: string) => void (await run(() => api.cancelJob(id))), [run]);
  const retry = useCallback(
    async (id: string) => {
      const job = await run(() => api.retryJob(id));
      // Yeniden denenen iş yeni kimlik alır; bu sayfanınsa yine bu sayfanın sayılır
      if (job && mineJobs.current.has(id)) mineJobs.current.add(job.id);
    },
    [run],
  );
  const clearFinished = useCallback(async () => void (await run(() => api.clearFinished())), [run]);
  const resume = useCallback(
    async (retryFailed: boolean) => {
      const r = await run(() => api.resumeQueue(retryFailed));
      if (r) setState(r.state);
    },
    [run],
  );

  const value = useMemo<QueueValue>(() => {
    const order = Object.values(jobs)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => j.id);
    const stats = { active: 0, queued: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const j of Object.values(jobs)) {
      if (j.status === 'queued') stats.queued++;
      else if (j.status === 'completed') stats.completed++;
      else if (j.status === 'failed') stats.failed++;
      else if (j.status === 'cancelled') stats.cancelled++;
      else stats.active++;
    }
    return {
      jobs,
      batches,
      order,
      connected,
      error,
      stats,
      enqueue,
      enqueueBatch,
      cancel,
      retry,
      clearFinished,
      clearError: () => setError(null),
      state,
      resume,
    };
  }, [jobs, batches, connected, error, enqueue, enqueueBatch, cancel, retry, clearFinished, state, resume]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useQueue, QueueProvider içinde kullanılmalı');
  return ctx;
}
