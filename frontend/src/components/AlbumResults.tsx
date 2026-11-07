import { Disc3 } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import type { AlbumResult } from '../types/api';

interface Props {
  albums: AlbumResult[];
  onOpen: (album: AlbumResult) => void;
}

/** Aramadaki albümler: tıklayınca parça listesi açılır, oradan tümü / seçilenler indirilir. */
export function AlbumResults({ albums, onOpen }: Props) {
  const { t } = useI18n();

  return (
    <section aria-labelledby="album-results" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="album-results" className="font-display text-xl font-bold tracking-tight">
          {t('results.albums')}
        </h2>
        <p className="text-sm text-fade">{t('results.albumsHint')}</p>
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {albums.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onOpen(a)}
              aria-label={t('album.openAria', { title: a.title, artist: a.artist })}
              className="group w-full rounded-xl p-2 text-left transition hover:bg-panel"
            >
              <span className="relative block aspect-square overflow-hidden rounded-md bg-raised shadow-lg shadow-black/40">
                {a.coverUrl ? (
                  <img src={a.coverUrl} alt="" loading="lazy" className="size-full object-cover transition group-hover:scale-[1.03]" />
                ) : (
                  <Disc3 className="m-auto size-1/3 h-full text-fade" strokeWidth={1.25} />
                )}
              </span>
              <span className="mt-2.5 block truncate font-medium text-paper group-hover:text-amber">{a.title}</span>
              <span className="block truncate text-sm text-dust">{a.artist}</span>
              <span className="block text-sm text-fade tabular-nums">
                {[a.releaseYear, a.trackCount ? t('album.tracks', { count: a.trackCount }) : null].filter(Boolean).join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
