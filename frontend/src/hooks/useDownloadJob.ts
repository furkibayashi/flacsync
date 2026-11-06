import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toUiError, type UiError } from '../services/api';
import type { DownloadJob, OutputFormat } from '../types/api';

const POLL_INTERVAL_MS = 1000;

export const isTerminal = (job: DownloadJob | null) => job?.status === 'completed' || job?.status === 'failed';

/**
 * İndirme işini başlatır ve ilerlemesini Server-Sent Events ile izler.
 * SSE bağlantısı koparsa (proxy, ağ) otomatik olarak polling'e geçer.
 */
export function useDownloadJob() {
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [starting, setStarting] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    stopRef.current();
    stopRef.current = () => {};
  }, []);

  const poll = useCallback((id: string) => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await api.getJob(id);
        if (cancelled) return;
        setJob(next);
        if (!isTerminal(next)) timer = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) setError(toUiError(err));
      }
    };
    void tick();
    stopRef.current = () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const subscribe = useCallback(
    (id: string) => {
      const source = new EventSource(api.eventsUrl(id));
      let finished = false;

      source.addEventListener('progress', (event) => {
        const next = JSON.parse((event as MessageEvent<string>).data) as DownloadJob;
        setJob(next);
        if (isTerminal(next)) {
          finished = true;
          source.close();
        }
      });

      source.onerror = () => {
        source.close();
        if (!finished) poll(id);
      };

      stopRef.current = () => source.close();
    },
    [poll],
  );

  const start = useCallback(
    async (url: string, format: OutputFormat) => {
      stop();
      setError(null);
      setJob(null);
      setStarting(true);
      try {
        const created = await api.startDownload(url, format);
        setJob(created);
        subscribe(created.id);
      } catch (err) {
        setError(toUiError(err));
      } finally {
        setStarting(false);
      }
    },
    [stop, subscribe],
  );

  const reset = useCallback(() => {
    stop();
    setJob(null);
    setError(null);
    setStarting(false);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
    job,
    error,
    start,
    reset,
    isRunning: starting || (job !== null && !isTerminal(job)),
  };
}
