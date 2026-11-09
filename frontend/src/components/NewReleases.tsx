import { BellRing, Disc3, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { LANG_LOCALE } from '../i18n/translations';
import { api } from '../services/api';
import { useFollows } from '../state/follows';
import { openArtist } from '../state/router';
import type { Release } from '../types/api';

/** Ana sayfa: takip edilen sanatçıların son 4 ayda çıkan albüm / single'ları */
export function NewReleases({ onOpen, onDiscover }: { onOpen: (url: string) => void; onDiscover: () => void }) {
  const { t, lang } = useI18n();
  const { artists, loaded } = useFollows();
  const [releases, setReleases] = useState<Release[] | null>(null);
  const key = artists.map((a) => a.id).join(',');

  useEffect(() => {
    if (!key) {
      setReleases([]);
      return;
    }
    const controller = new AbortController();
    api
      .releases(controller.signal)
      .then((r) => setReleases(r.releases))
      .catch(() => undefined);
    return () => controller.abort();
  }, [key]);

  if (!loaded) return null;

  const date = (iso: string) => new Date(iso).toLocaleDateString(LANG_LOCALE[lang], { day: 'numeric', month: 'short' });

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <BellRing className="size-5 text-amber" />
          {t('follow.releasesTitle')}
        </h2>
        {artists.length > 0 && <span className="text-sm text-fade">{t('follow.count', { count: artists.length })}</span>}
      </div>

      {artists.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-panel/70 p-5 ring-1 ring-rule sm:flex-row sm:items-center sm:justify-between">
          <p className="text-dust">{t('follow.emptyHint')}</p>
          <button
            type="button"
            onClick={onDiscover}
            className="shrink-0 rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-paper ring-1 ring-rule transition hover:ring-dust"
          >
            {t('nav.discover')}
          </button>
        </div>
      ) : (
        <>
          {/* Takip edilenler */}
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {artists.map((a) => (
              <button key={a.id} type="button" onClick={() => openArtist(a.id)} className="group w-20 shrink-0 text-center">
                <span className="mx-auto grid size-16 place-items-center overflow-hidden rounded-full bg-raised ring-2 ring-rule transition group-hover:ring-amber">
                  {a.pictureUrl ? (
                    <img src={a.pictureUrl} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <UserRound className="size-7 text-fade" />
                  )}
                </span>
                <span className="mt-1.5 block truncate text-xs font-semibold text-dust group-hover:text-paper">{a.name}</span>
              </button>
            ))}
          </div>

          {releases === null ? null : releases.length === 0 ? (
            <p className="text-sm text-dust">{t('follow.noReleases')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
              {releases.slice(0, 12).map((r) => (
                <button key={r.id} type="button" onClick={() => onOpen(r.url)} className="group text-left">
                  <span className="relative block aspect-square overflow-hidden rounded-xl bg-raised shadow-lg shadow-black/30 ring-1 ring-rule">
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                    ) : (
                      <Disc3 className="absolute inset-0 m-auto size-1/3 text-fade" />
                    )}
                    <span className="absolute top-2 left-2 rounded-full bg-night/80 px-2 py-0.5 text-[10px] font-bold tracking-wide text-paper uppercase backdrop-blur">
                      {date(r.releaseDate)}
                    </span>
                  </span>
                  <span className="mt-2.5 block truncate font-semibold text-paper group-hover:text-amber">{r.title}</span>
                  <span className="block truncate text-sm text-dust">
                    {r.artist} · {t(`artist.type.${r.type}` as 'artist.type.album')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
