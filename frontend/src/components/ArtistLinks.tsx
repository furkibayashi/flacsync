import clsx from 'clsx';
import { Fragment, useState, type MouseEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { openArtist } from '../state/router';

/**
 * "A, B feat. C" → A | B | C (ayraçlar korunarak gösterilir). "&", "ve", "and" bölünmez:
 * "Simon & Garfunkel", "mor ve ötesi" tek sanatçıdır. Uygulama birden çok sanatçıyı ", " ile birleştirir.
 */
const SPLIT = /(\s*,\s*|\s+(?:feat\.?|ft\.?|featuring)\s+)/i;

/** Ad → Deezer kimliği; aynı oturumda tekrar aranmaz */
const resolved = new Map<string, string | null>();

async function openByName(name: string): Promise<boolean> {
  const key = name.toLowerCase();
  let id = resolved.get(key);
  if (id === undefined) {
    id = (await api.findArtist(name).catch(() => ({ artist: null }))).artist?.id ?? null;
    resolved.set(key, id);
  }
  if (id) openArtist(id);
  return Boolean(id);
}

/**
 * Sanatçı adlarını tıklanabilir yapar: tıklayınca profil açılır (Deezer'da bulunursa).
 * Birden fazla sanatçı varsa her ad ayrı bağlantıdır.
 */
export function ArtistLinks({ names, className }: { names: string; className?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  if (!names) return null;
  const parts = names.split(SPLIT);

  const onClick = async (e: MouseEvent, name: string) => {
    e.stopPropagation();
    e.preventDefault();
    setBusy(name);
    const ok = await openByName(name);
    setBusy(null);
    if (!ok) {
      setMissing(name);
      setTimeout(() => setMissing(null), 2500);
    }
  };

  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 || !part.trim() ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <button
            key={i}
            type="button"
            onClick={(e) => void onClick(e, part.trim())}
            title={missing === part.trim() ? t('artist.notFound') : t('artist.open', { name: part.trim() })}
            className={clsx(
              'cursor-pointer underline-offset-4 transition hover:text-paper hover:underline',
              busy === part.trim() && 'animate-pulse',
              missing === part.trim() && 'text-danger no-underline',
            )}
          >
            {part}
          </button>
        ),
      )}
    </span>
  );
}
