import { ImagePlus, Loader2, Save, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { api, toUiError } from '../services/api';
import type { LibraryTrack, TagEdit } from '../types/api';
import { LibraryCover } from './LibrarySongRow';

const MAX_COVER_BYTES = 10 * 1024 * 1024;

/** Etiket düzenleyici: alanlar ve kapak elle değiştirilip dosyaya yazılır (MP3: ID3, FLAC: Vorbis) */
export function TagEditor({ track, onClose, onSaved }: { track: LibraryTrack; onClose: () => void; onSaved: (t: LibraryTrack) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    albumArtist: '',
    year: track.year ?? '',
    genre: track.genre ?? '',
    trackNumber: track.trackNumber ? String(track.trackNumber) : '',
  });
  const [coverData, setCoverData] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) return setError(t('tags.coverTooBig'));
    const reader = new FileReader();
    reader.onload = () => setCoverData(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const edit: TagEdit = {};
    if (form.title.trim() && form.title !== track.title) edit.title = form.title.trim();
    if (form.artist.trim() && form.artist !== track.artist) edit.artist = form.artist.trim();
    if (form.album.trim() && form.album !== (track.album ?? '')) edit.album = form.album.trim();
    if (form.albumArtist.trim()) edit.albumArtist = form.albumArtist.trim();
    if (/^\d{4}$/.test(form.year) && form.year !== track.year) edit.year = form.year;
    if (form.genre.trim() && form.genre !== (track.genre ?? '')) edit.genre = form.genre.trim();
    if (form.trackNumber && Number(form.trackNumber) !== track.trackNumber) edit.trackNumber = Number(form.trackNumber);
    if (coverData) edit.coverData = coverData;
    else if (coverUrl.trim().startsWith('https://')) edit.coverUrl = coverUrl.trim();
    try {
      const r = await api.editTags(track.id, edit);
      onSaved(r.track);
      onClose();
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, extra?: { inputMode?: 'numeric'; maxLength?: number }) => (
    <label className="block">
      <span className="text-xs font-semibold text-dust">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        inputMode={extra?.inputMode}
        maxLength={extra?.maxLength ?? 300}
        className="mt-1 h-10 w-full rounded-lg bg-night px-3 text-sm text-paper ring-1 ring-rule outline-none focus:ring-amber"
      />
    </label>
  );

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={(e) => void save(e)}
        role="dialog"
        aria-modal="true"
        aria-label={t('tags.title')}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-panel p-6 shadow-2xl shadow-black/60 ring-1 ring-rule"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-paper">{t('tags.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('lyrics.close')} className="grid size-8 place-items-center rounded-full text-dust hover:bg-raised hover:text-paper">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-5 sm:grid-cols-[160px_minmax(0,1fr)]">
          <div className="space-y-2">
            <span className="relative block aspect-square overflow-hidden rounded-xl ring-1 ring-rule">
              {coverData ? <img src={coverData} alt="" className="size-full object-cover" /> : <LibraryCover id={track.id} className="size-full" />}
            </span>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-raised py-2 text-xs font-semibold text-paper ring-1 ring-rule hover:ring-dust">
              <ImagePlus className="size-4" />
              {t('tags.pickCover')}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder={t('tags.coverUrl')}
              className="h-8 w-full rounded-lg bg-night px-2 text-xs text-paper ring-1 ring-rule outline-none focus:ring-amber"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{field('title', t('tags.field.title'))}</div>
            {field('artist', t('tags.field.artist'))}
            {field('albumArtist', t('tags.field.albumArtist'))}
            <div className="sm:col-span-2">{field('album', t('tags.field.album'))}</div>
            {field('year', t('tags.field.year'), { inputMode: 'numeric', maxLength: 4 })}
            {field('trackNumber', t('tags.field.track'), { inputMode: 'numeric', maxLength: 3 })}
            <div className="sm:col-span-2">{field('genre', t('tags.field.genre'))}</div>
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-fade">{t('tags.note')}</p>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('tags.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
