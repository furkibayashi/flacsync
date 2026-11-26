import clsx from 'clsx';
import { Check, ExternalLink, Link2, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { formatDuration } from '../lib/format';
import { api, isAbort, toUiError, type UiError } from '../services/api';
import type { LibraryTrack, RematchCandidate } from '../types/api';

/**
 * "Yanlış kayıt mı?" penceresi: YouTube Music'teki aday kayıtlar puanlarıyla listelenir, kullanıcı
 * birini seçer ya da bağlantı yapıştırır. Dosyanın sesi yeniden oluşturulur; etiketler, kapak, sözler,
 * çalma listeleri ve dinlenme sayısı korunur.
 *
 * Yerel <dialog>: odak pencerede kalır, Esc kapatır, kapanınca odak açan düğmeye döner.
 */
export function RematchDialog({
  track,
  onClose,
  onReplaced,
}: {
  track: LibraryTrack;
  onClose: () => void;
  onReplaced: (track: LibraryTrack) => void;
}) {
  const { t, tError } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const [current, setCurrent] = useState<string | null>(track.source?.videoId ?? null);
  const [candidates, setCandidates] = useState<RematchCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<UiError | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    // Geliştirmede StrictMode etkiyi iki kez çalıştırır: açık pencere yeniden açılmaz
    if (dialog && !dialog.open) dialog.showModal();
    const back = opener.current;
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .rematchCandidates(track.id, controller.signal)
      .then((r) => {
        setCandidates(r.candidates);
        setCurrent(r.current ?? track.source?.videoId ?? null);
      })
      .catch((err) => !isAbort(err) && setLoadError(toUiError(err)));
    return () => controller.abort();
  }, [track.id]);

  const apply = async (video: string) => {
    setWorking(video);
    setError(null);
    try {
      const { track: updated } = await api.rematch(track.id, video);
      onReplaced(updated);
      onClose();
    } catch (err) {
      const e = toUiError(err);
      setError(tError(e.code, e.message));
    } finally {
      setWorking(null);
    }
  };

  const busy = working !== null;

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="rematch-title"
      // Portal olsa da React olayları satıra (li) kabarcıklanır: seçim / çift tıkla çalma tetiklenmesin
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(640px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] overflow-hidden rounded-3xl bg-panel p-0 text-paper shadow-2xl ring-1 ring-rule backdrop:bg-black/60"
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-start gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="rematch-title" className="font-display text-xl font-bold">
              {t('rematch.title')}
            </h2>
            <p className="mt-1 text-sm text-dust">{t('rematch.subtitle', { artist: track.artist, title: track.title })}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('action.close')}
            className="grid size-10 shrink-0 place-items-center rounded-full text-dust transition hover:bg-raised hover:text-paper disabled:opacity-40"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-busy={!candidates && !loadError}>
          {!candidates && !loadError && (
            <p role="status" className="flex items-center justify-center gap-3 py-12 text-dust">
              <Loader2 className="size-5 animate-spin" />
              {t('rematch.searching')}
            </p>
          )}
          {loadError && <p className="rounded-xl bg-danger/10 p-4 text-sm text-paper ring-1 ring-danger/30">{tError(loadError.code, loadError.message)}</p>}
          {candidates && candidates.length === 0 && <p className="py-10 text-center text-dust">{t('rematch.none')}</p>}
          {candidates && candidates.length > 0 && (
            <ul className="space-y-1.5">
              {candidates.map((c) => {
                const isCurrent = c.videoId === current;
                const pct = Math.round(c.score * 100);
                return (
                  <li
                    key={c.videoId}
                    className={clsx('flex flex-wrap items-center gap-3 rounded-2xl px-3 py-3 ring-1 sm:flex-nowrap', isCurrent ? 'bg-amber/10 ring-amber/40' : 'ring-rule')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-semibold">
                        <span className="truncate">{c.title}</span>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-amber/20 px-2 py-0.5 text-[11px] font-bold text-amber uppercase">{t('rematch.current')}</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-dust">
                        {c.artist}
                        {c.album ? ` · ${c.album}` : ''}
                        {c.channel && c.channel !== c.artist ? ` · ${c.channel}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-dust tabular-nums">
                        {formatDuration(c.duration)}
                        {c.durationDiff !== null && c.durationDiff > 0 ? ` · ${t('rematch.diff', { diff: Math.round(c.durationDiff) })}` : ''}
                        {' · '}
                        <span className={pct >= 90 ? 'text-ok' : pct >= 75 ? 'text-amber' : 'text-danger'}>{t('rematch.score', { score: pct })}</span>
                      </p>
                    </div>
                    <a
                      href={c.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-dust ring-1 ring-rule transition hover:text-paper"
                    >
                      <ExternalLink className="size-4" />
                      {t('rematch.listen')}
                    </a>
                    <button
                      type="button"
                      disabled={busy || isCurrent}
                      onClick={() => void apply(c.videoId)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber px-4 text-sm font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40"
                    >
                      {working === c.videoId ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      {t('rematch.use')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="space-y-2 border-t border-rule px-5 py-4">
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm text-dust">
              <Loader2 className="size-4 animate-spin" />
              {t('rematch.working')}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-paper ring-1 ring-danger/30">
              {error}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void apply(link.trim());
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t('rematch.paste')}</span>
              <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dust" />
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={t('rematch.pastePlaceholder')}
                disabled={busy}
                className="h-11 w-full rounded-xl bg-night pr-3 pl-9 text-sm text-paper ring-1 ring-rule-strong outline-none placeholder:text-dust focus:ring-amber"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !link.trim()}
              className="h-11 shrink-0 rounded-xl bg-raised px-4 text-sm font-semibold text-paper ring-1 ring-rule-strong transition hover:ring-dust disabled:opacity-40"
            >
              {t('rematch.apply')}
            </button>
          </form>
          <p className="text-xs text-dust">{t('rematch.paste')}</p>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
