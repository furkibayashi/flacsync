import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/json-store.js';

/** Sunucu tarafında uygulanan kütüphane tercihleri (Ayarlar → Kütüphane) */
export interface LibraryPrefs {
  /** Her şarkının yanına aynı adla .lrc söz dosyası yaz (araba teyp, telefon oynatıcıları okur) */
  lrcSidecar: boolean;
  /** Ölçülen yüksekliği ReplayGain etiketi olarak dosyaya yaz (her oynatıcıda eşit ses) */
  replayGain: boolean;
  /** Kütüphaneye eklenen başka müzik klasörleri (mutlak yollar) */
  folders: string[];
}

const DEFAULTS: LibraryPrefs = { lrcSidecar: false, replayGain: false, folders: [] };

function validate(raw: unknown): LibraryPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LibraryPrefs>;
  return {
    lrcSidecar: r.lrcSidecar === true,
    replayGain: r.replayGain === true,
    folders: Array.isArray(r.folders) ? r.folders.filter((f): f is string => typeof f === 'string' && f.length > 0) : [],
  };
}

export class PrefsService {
  private readonly store: JsonStore<LibraryPrefs>;
  private readonly listeners = new Set<(next: LibraryPrefs, prev: LibraryPrefs) => void>();

  constructor(dataDir = resolve(env.DATA_DIR)) {
    this.store = new JsonStore<LibraryPrefs>(join(dataDir, 'prefs.json'), { ...DEFAULTS }, validate);
  }

  get(): LibraryPrefs {
    return { ...this.store.data, folders: [...this.store.data.folders] };
  }

  update(patch: Partial<LibraryPrefs>): LibraryPrefs {
    const prev = this.get();
    const next: LibraryPrefs = { ...prev, ...patch, folders: patch.folders ? [...patch.folders] : prev.folders };
    this.store.set(next);
    for (const l of this.listeners) l(next, prev);
    return this.get();
  }

  onChange(listener: (next: LibraryPrefs, prev: LibraryPrefs) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}

export const prefsService = new PrefsService();
