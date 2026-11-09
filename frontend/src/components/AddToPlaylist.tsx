import clsx from 'clsx';
import { Check, ListPlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { usePlaylists } from '../state/playlists';
import { MenuItem, Popover } from './Popover';

/** "Listeye ekle" menüsü: mevcut listeler + yeni liste oluştur. Yalnızca kütüphane şarkıları eklenebilir. */
export function AddToPlaylist({
  trackIds,
  className,
  side = 'top',
  variant = 'icon',
}: {
  trackIds: string[];
  className?: string;
  side?: 'top' | 'bottom';
  variant?: 'icon' | 'button';
}) {
  const { t } = useI18n();
  const { playlists, reload } = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [doneId, setDoneId] = useState<string | null>(null);

  const add = async (id: string, close: () => void) => {
    await api.addToPlaylist(id, trackIds).catch(() => undefined);
    setDoneId(id);
    reload();
    setTimeout(() => {
      setDoneId(null);
      close();
    }, 700);
  };

  const create = async (close: () => void) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await api.createPlaylist(trimmed, trackIds).catch(() => undefined);
    setName('');
    setCreating(false);
    reload();
    close();
  };

  return (
    <Popover
      side={side}
      trigger={({ toggle, open }) =>
        variant === 'icon' ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            aria-expanded={open}
            title={t('playlist.addTo')}
            aria-label={t('playlist.addTo')}
            className={clsx(
              'grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-raised',
              open ? 'text-amber' : 'text-dust hover:text-paper',
              className,
            )}
          >
            <ListPlus className="size-[18px]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust',
              className,
            )}
          >
            <ListPlus className="size-4" />
            {t('playlist.addTo')}
          </button>
        )
      }
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          <p className="px-4 pt-1.5 pb-2 text-xs font-bold tracking-wide text-fade uppercase">{t('playlist.addTo')}</p>
          {creating ? (
            <form
              className="flex gap-2 px-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create(close);
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('playlist.namePlaceholder')}
                maxLength={100}
                className="h-9 min-w-0 flex-1 rounded-lg bg-night px-3 text-sm text-paper ring-1 ring-rule outline-none focus:ring-amber"
              />
              <button type="submit" disabled={!name.trim()} className="rounded-lg bg-amber px-3 text-sm font-bold text-on-accent disabled:opacity-40">
                {t('playlist.create')}
              </button>
            </form>
          ) : (
            <MenuItem icon={<Plus className="size-4 text-amber" />} onClick={() => setCreating(true)}>
              {t('playlist.new')}
            </MenuItem>
          )}
          {playlists.map((p) => (
            <MenuItem
              key={p.id}
              icon={doneId === p.id ? <Check className="size-4 text-ok" /> : <span className="size-4" />}
              onClick={() => void add(p.id, close)}
            >
              {p.name}
              <span className="ml-1.5 text-xs text-fade">{p.available}</span>
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}
