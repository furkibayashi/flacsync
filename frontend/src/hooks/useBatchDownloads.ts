import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isDesktopApp, toUiError, type UiError } from '../services/api';
import type { Batch, BatchItem, DownloadJob, OutputFormat } from '../types/api';

const POLL_INTERVAL_MS = 1500;

function triggerDownload(href: string, fileName?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface StartOptions {
  /** Toplu indirme mi (ZIP'i otomatik indir) yoksa tek parça mı */
  bulk: boolean;
}

/**
 * Albüm / çalma listesi indirmeleri. Aynı koleksiyonda birden fazla toplu iş
 * (ör. önce 1 parça, sonra tümü) olabilir; parça durumları URL'ye göre tutulur.
 *
 * Kaydetme:
 *  - Masaüstü: her parça bitince albüm klasörüne otomatik kaydedilir.
 *  - Web: toplu işte tüm parçalar bitince ZIP, tek parçada dosyanın kendisi indirilir.
 */
export function useBatchDownloads() {
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});
  const [jobIdByUrl, setJobIdByUrl] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<Record<string, Batch>>({});
  const [lastBulkId, setLastBulkId] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [starting, setStarting] = useState(false);

  const stops = useRef(new Map<string, () => void>());
  const bulkIds = useRef(new Set<string>());
  const savedJobs = useRef(new Set<string>());
  const savedZips = useRef(new Set<string>());

  const applyJob = useCallback((job: DownloadJob) => setJobs((prev) => ({ ...prev, [job.id]: job })), []);
  const applyBatch = useCallback((batch: Batch) => setBatches((prev) => ({ ...prev, [batch.id]: batch })), []);

  const stopOne = useCallback((id: string) => {
    stops.current.get(id)?.();
    stops.current.delete(id);
  }, []);

  const poll = useCallback(
    (id: string) => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout>;
      const tick = async () => {
        try {
          const { batch, jobs: list } = await api.getBatch(id);
          if (cancelled) return;
          list.forEach(applyJob);
          applyBatch(batch);
          if (batch.status === 'running') timer = setTimeout(tick, POLL_INTERVAL_MS);
        } catch (err) {
          if (!cancelled) setError(toUiError(err));
        }
      };
      void tick();
      stops.current.set(id, () => {
        cancelled = true;
        clearTimeout(timer);
      });
    },
    [applyBatch, applyJob],
  );

  const subscribe = useCallback(
    (id: string) => {
      const source = new EventSource(api.batchEventsUrl(id));
      let finished = false;
      const handle = (batch: Batch) => {
        applyBatch(batch);
        if (batch.status !== 'running') {
          finished = true;
          source.close();
        }
      };
      source.addEventListener('snapshot', (e) => {
        const data = JSON.parse((e as MessageEvent<string>).data) as { batch: Batch; jobs: DownloadJob[] };
        data.jobs.forEach(applyJob);
        handle(data.batch);
      });
      source.addEventListener('job', (e) => {
        const data = JSON.parse((e as MessageEvent<string>).data) as { job: DownloadJob; batch: Batch };
        applyJob(data.job);
        handle(data.batch);
      });
      source.onerror = () => {
        source.close();
        if (!finished) poll(id);
      };
      stops.current.set(id, () => source.close());
    },
    [applyBatch, applyJob, poll],
  );

  const start = useCallback(
    async (name: string, format: OutputFormat, items: BatchItem[], { bulk }: StartOptions) => {
      setError(null);
      setStarting(true);
      try {
        const batch = await api.startBatch(name, format, items);
        applyBatch(batch);
        setJobIdByUrl((prev) => {
          const next = { ...prev };
          items.forEach((item, i) => {
            const jobId = batch.jobIds[i];
            if (jobId) next[item.url] = jobId;
          });
          return next;
        });
        if (bulk) {
          bulkIds.current.add(batch.id);
          setLastBulkId(batch.id);
        }
        subscribe(batch.id);
      } catch (err) {
        setError(toUiError(err));
      } finally {
        setStarting(false);
      }
    },
    [applyBatch, subscribe],
  );

  // Dosyaları kaydet
  useEffect(() => {
    for (const job of Object.values(jobs)) {
      if (job.status !== 'completed' || !job.file || !job.batchId || savedJobs.current.has(job.id)) continue;
      const batch = batches[job.batchId];
      if (!batch) continue;
      // Web'de toplu işler ZIP olarak iner; tek parçalar doğrudan
      if (!isDesktopApp && bulkIds.current.has(job.batchId)) continue;
      savedJobs.current.add(job.id);
      triggerDownload(api.fileUrl(job.id, isDesktopApp ? batch.folder : undefined), job.file.name);
    }
    if (!isDesktopApp) {
      for (const batch of Object.values(batches)) {
        if (!bulkIds.current.has(batch.id) || batch.status === 'running' || batch.completed === 0) continue;
        if (savedZips.current.has(batch.id)) continue;
        savedZips.current.add(batch.id);
        triggerDownload(api.batchZipUrl(batch.id));
      }
    }
  }, [jobs, batches]);

  const reset = useCallback(() => {
    for (const id of [...stops.current.keys()]) stopOne(id);
    bulkIds.current.clear();
    setJobs({});
    setJobIdByUrl({});
    setBatches({});
    setLastBulkId(null);
    setError(null);
    setStarting(false);
  }, [stopOne]);

  useEffect(() => {
    const map = stops.current;
    return () => map.forEach((stop) => stop());
  }, []);

  const jobForUrl = useCallback((url: string) => jobs[jobIdByUrl[url] ?? ''] ?? null, [jobs, jobIdByUrl]);
  const running = Object.values(batches).some((b) => b.status === 'running');
  const lastBulk = lastBulkId ? batches[lastBulkId] ?? null : null;

  return {
    start,
    reset,
    jobForUrl,
    error,
    /** Herhangi bir indirme sürüyor (plak dönsün) */
    isRunning: starting || running,
    /** "Tümünü / seçilenleri indir" işi sürüyor */
    bulkRunning: starting || lastBulk?.status === 'running',
    lastBulk,
  };
}
