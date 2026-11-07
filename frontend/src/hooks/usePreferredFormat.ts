import { useCallback, useEffect, useState } from 'react';
import type { OutputFormat } from '../types/api';

const KEY = 'flacsync.format';
const EVENT = 'flacsync:format';

function read(): OutputFormat {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'flac' ? 'flac' : 'mp3';
  } catch {
    return 'mp3';
  }
}

/** Son seçilen çıktı formatı; tüm ekranlarda ortak ve hatırlanır. */
export function usePreferredFormat(): [OutputFormat, (f: OutputFormat) => void] {
  const [format, setFormat] = useState<OutputFormat>(read);

  useEffect(() => {
    const sync = () => setFormat(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const update = useCallback((f: OutputFormat) => {
    try {
      localStorage.setItem(KEY, f);
    } catch {
      // depolama kapalı: yalnızca bu oturumda geçerli
    }
    setFormat(f);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [format, update];
}
