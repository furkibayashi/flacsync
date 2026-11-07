import { ListMusic } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { formatDuration, PLATFORM_LABEL } from '../lib/format';
import type { AlbumResult, ParseResponse, Platform } from '../types/api';
import { PlatformTag } from './PlatformTag';

interface Props {
  track: ParseResponse;
  /** Arama sonucunda kaydın bulunduğu platformlar; link girişinde kaynak platform */
  foundOn: Platform[];
  isBestMatch: boolean;
  /** Şarkının albümü (varsa) — "Albümü aç" ile tüm parçalar listelenir */
  album: AlbumResult | null;
  onOpenAlbum: (album: AlbumResult) => void;
}

export function TrackDetails({ track, foundOn, isBestMatch, album, onOpenAlbum }: Props) {
  const { t } = useI18n();
  const { metadata, enrichedFrom } = track;

  const facts: Array<[string, string]> = [
    [t('track.album'), metadata.album ?? ''],
    [t('track.year'), metadata.releaseDate ?? ''],
    [t('track.duration'), metadata.duration ? formatDuration(metadata.duration) : ''],
    [t('track.isrc'), metadata.isrc ?? ''],
  ].filter((f): f is [string, string] => Boolean(f[1]));

  return (
    <div className="space-y-6">
      <div>
        {isBestMatch && <p className="mb-2 text-sm font-medium text-amber">{t('track.bestMatch')}</p>}
        <h2 className="font-display text-4xl leading-[1.02] font-extrabold tracking-[-0.03em] text-balance break-words sm:text-5xl lg:text-6xl">
          {metadata.title}
        </h2>
        <p className="mt-3 text-xl text-dust">{metadata.artist}</p>
      </div>

      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0 max-w-full">
              <dt className="text-sm text-fade">{label}</dt>
              <dd className="text-[15px] break-words text-paper tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-1">
        <p className="text-sm text-fade">{t('track.foundOn')}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {foundOn.map((p) => (
            <PlatformTag key={p} platform={p} />
          ))}
        </div>
        {enrichedFrom.length > 0 && (
          <p className="text-sm text-fade">
            {t('track.enriched', { platforms: enrichedFrom.map((p) => PLATFORM_LABEL[p]).join(', ') })}
          </p>
        )}
      </div>

      {album && (
        <button
          type="button"
          onClick={() => onOpenAlbum(album)}
          className="group flex w-full max-w-md items-center gap-3 rounded-xl bg-panel p-2 pr-4 text-left ring-1 ring-rule transition hover:ring-amber/60"
        >
          <span className="size-12 shrink-0 overflow-hidden rounded bg-raised">
            {album.coverUrl && <img src={album.coverUrl} alt="" className="size-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] text-paper">
              {t('track.inAlbum', { album: album.title })}
            </span>
            <span className="block text-sm text-fade">
              {album.trackCount ? t('album.tracks', { count: album.trackCount }) : album.artist}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-amber">
            <ListMusic className="size-4" />
            {t('album.open')}
          </span>
        </button>
      )}
    </div>
  );
}
