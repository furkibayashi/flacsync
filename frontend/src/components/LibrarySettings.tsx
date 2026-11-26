import { FolderOpen, FolderPlus, Loader2, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { api, toUiError } from '../services/api';
import type { LibraryPrefs, ScanStatus } from '../types/api';

type RowComp = (p: { label: string; hint?: string; children: ReactNode }) => ReactNode;
type ToggleComp = (p: { checked: boolean; onChange: (v: boolean) => void; label: string }) => ReactNode;

const btn =
  'inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-paper ring-1 ring-rule-strong transition hover:ring-dust disabled:opacity-50';

/**
 * Ayarlar → Kütüphane: indirme klasörü, eklenen müzik klasörleri (tarama ilerlemesiyle),
 * .lrc söz dosyaları ve ReplayGain etiketleri.
 */
export function LibrarySettings({ Row, Toggle, saveDir }: { Row: RowComp; Toggle: ToggleComp; saveDir: string | null }) {
  const { t, tError } = useI18n();
  const desktop = window.flacsync;
  const [prefs, setPrefs] = useState<LibraryPrefs | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  /** Kaldırmak için ikinci tıklama bekleyen klasör */
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  useEffect(() => {
    void api.prefs().then(setPrefs).catch(() => undefined);
    void api.libraryScan().then(setScan).catch(() => undefined);
  }, []);

  // Tarama sürerken ilerleme saniyede bir okunur
  useEffect(() => {
    if (!scan?.running) return;
    const timer = setInterval(() => void api.libraryScan().then(setScan).catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [scan?.running]);

  const fail = useCallback(
    (err: unknown) => {
      const e = toUiError(err);
      setError(tError(e.code, e.message));
    },
    [tError],
  );

  const toggle = async (key: 'lrcSidecar' | 'replayGain', value: boolean) => {
    setError(null);
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    try {
      setPrefs(await api.setPrefs({ [key]: value }));
    } catch (err) {
      setPrefs((p) => (p ? { ...p, [key]: !value } : p));
      fail(err);
    }
  };

  const addFolder = async () => {
    const folder = await desktop?.pickFolder?.();
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.addLibraryFolder(folder);
      setPrefs((p) => (p ? { ...p, folders: r.folders } : p));
      setScan({ ...r.scan, running: true });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (folder: string) => {
    setError(null);
    try {
      const r = await api.removeLibraryFolder(folder);
      setPrefs((p) => (p ? { ...p, folders: r.folders } : p));
    } catch (err) {
      fail(err);
    }
  };

  const changeSaveDir = async () => {
    const r = await desktop?.chooseSaveDir?.();
    if (!r) return;
    if ('error' in r) return setError(r.error);
    setPendingDir(r.path);
  };

  return (
    <>
      {desktop && saveDir && (
        <Row label={t('settings.saveDir')} hint={pendingDir ? t('libset.saveDirPending', { path: pendingDir }) : saveDir}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void desktop.openLocation('library')} className={btn}>
              <FolderOpen className="size-4" />
              {t('settings.open')}
            </button>
            {desktop.chooseSaveDir && (
              <button type="button" onClick={() => void changeSaveDir()} className={btn}>
                {t('libset.change')}
              </button>
            )}
            {pendingDir && (
              <button type="button" onClick={() => void desktop.relaunch()} className={btn}>
                <RotateCw className="size-4" />
                {t('settings.relaunch')}
              </button>
            )}
          </div>
        </Row>
      )}

      {desktop?.pickFolder && prefs && (
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="font-semibold text-paper">{t('libset.folders')}</p>
              <p className="mt-0.5 text-sm text-dust">{t('libset.foldersHint')}</p>
            </div>
            <button type="button" onClick={() => void addFolder()} disabled={busy} className={`${btn} shrink-0`}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
              {t('libset.addFolder')}
            </button>
          </div>
          {prefs.folders.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {prefs.folders.map((f) => (
                <li key={f} className="flex items-center gap-3 rounded-xl bg-night/60 px-3 py-2 ring-1 ring-rule">
                  <FolderOpen aria-hidden className="size-4 shrink-0 text-dust" />
                  <span className="min-w-0 flex-1 truncate text-sm text-paper" title={f}>
                    {f}
                  </span>
                  {armed === f ? (
                    <button
                      type="button"
                      onClick={() => {
                        setArmed(null);
                        void removeFolder(f);
                      }}
                      className="h-9 shrink-0 rounded-lg bg-danger px-3 text-xs font-bold text-on-danger"
                    >
                      {t('libset.removeConfirm')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setArmed(f)}
                      title={t('libset.removeFolder')}
                      aria-label={`${t('libset.removeFolder')}: ${f}`}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-dust transition hover:bg-raised hover:text-danger"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {scan?.running && (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm text-dust">
              <Loader2 className="size-4 animate-spin" />
              {t('libset.scanning', { done: scan.done, total: scan.total, added: scan.added })}
            </p>
          )}
        </div>
      )}

      {prefs && (
        <>
          <Row label={t('libset.lrc')} hint={t('libset.lrcHint')}>
            <Toggle checked={prefs.lrcSidecar} onChange={(v) => void toggle('lrcSidecar', v)} label={t('libset.lrc')} />
          </Row>
          <Row label={t('libset.replayGain')} hint={t('libset.replayGainHint')}>
            <Toggle checked={prefs.replayGain} onChange={(v) => void toggle('replayGain', v)} label={t('libset.replayGain')} />
          </Row>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-paper ring-1 ring-danger/30">
          {error}
        </p>
      )}
    </>
  );
}
