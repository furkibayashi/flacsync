import { ClipboardCheck, Download, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { useI18n } from '../i18n/I18nProvider';
import { detectPlatform, PLATFORM_LABEL } from '../lib/format';
import { usePlayer, usePlayerProgress } from '../state/PlayerProvider';
import { useQueue } from '../state/QueueProvider';
import { useClipboardWatchSetting, useCloseToTraySetting } from '../state/settings';

/**
 * Masaüstü köprüsü (yalnızca uygulamada):
 *  - çalan şarkıyı tepsiye ve mini oynatıcıya bildirir, oradan gelen komutları uygular
 *  - tepsi / pano tercihlerini ana sürece iletir
 *  - panoya kopyalanan müzik linki için "İndirilsin mi?" kartı gösterir
 */
export function DesktopBridge({ onOpen }: { onOpen: (url: string) => void }) {
  const desktop = window.flacsync;
  const { t } = useI18n();
  const player = usePlayer();
  const { time, duration } = usePlayerProgress();
  const queue = useQueue();
  const [format] = usePreferredFormat();
  const [closeToTray] = useCloseToTraySetting();
  const [clipboardWatch] = useClipboardWatchSetting();
  const [link, setLink] = useState<string | null>(null);
  const lastSent = useRef(0);

  // Tercihler
  useEffect(() => desktop?.setDesktopPrefs?.({ closeToTray, clipboardWatch }), [desktop, closeToTray, clipboardWatch]);

  // Çalan şarkı: parça / durum değişince hemen, süre saniyede bir
  const track = player.current;
  useEffect(() => {
    if (!desktop?.sendNowPlaying) return;
    desktop.sendNowPlaying(
      track
        ? { title: track.title, artist: track.artist, coverUrl: track.coverUrl ?? null, playing: player.playing, time, duration }
        : null,
    );
    lastSent.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, track?.id, player.playing]);
  useEffect(() => {
    if (!desktop?.sendNowPlaying || !track || Date.now() - lastSent.current < 1000) return;
    lastSent.current = Date.now();
    desktop.sendNowPlaying({ title: track.title, artist: track.artist, coverUrl: track.coverUrl ?? null, playing: player.playing, time, duration });
  }, [desktop, track, player.playing, time, duration]);

  // Tepsi / mini oynatıcı komutları
  const playerRef = useRef(player);
  playerRef.current = player;
  useEffect(
    () =>
      desktop?.onPlayerCommand?.((cmd) => {
        const p = playerRef.current;
        if (cmd === 'toggle') p.toggle();
        else if (cmd === 'next') p.next();
        else if (cmd === 'prev') p.prev();
      }),
    [desktop],
  );

  // Panodaki link
  useEffect(() => desktop?.onClipboardLink?.((url) => setLink(url)), [desktop]);

  if (!link) return null;
  const platform = detectPlatform(link);

  return (
    <div
      role="alertdialog"
      aria-label={t('clipboard.title')}
      className="fixed top-4 right-4 z-[70] w-[min(380px,calc(100vw-32px))] animate-rise rounded-2xl bg-panel p-4 shadow-2xl shadow-black/50 ring-1 ring-amber/40"
    >
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-amber" />
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-paper">{t('clipboard.title')}</p>
          <p className="mt-0.5 truncate text-sm text-dust" title={link}>
            {platform ? `${PLATFORM_LABEL[platform]} · ` : ''}
            {link.replace(/^https?:\/\//, '')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void queue.enqueue(link, format);
                setLink(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber px-3 py-1.5 text-sm font-bold text-on-accent hover:bg-amber-hi"
            >
              <Download className="size-4" />
              {t('clipboard.download')}
            </button>
            <button
              type="button"
              onClick={() => {
                onOpen(link);
                setLink(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold text-paper ring-1 ring-rule hover:ring-dust"
            >
              <ExternalLink className="size-4" />
              {t('clipboard.open')}
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setLink(null)} aria-label={t('lyrics.close')} className="text-fade hover:text-paper">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
