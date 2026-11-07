import clsx from 'clsx';
import type { LinkPlatform } from '../lib/format';
import { ClipboardPaste, Link2, Loader2, Search, X } from 'lucide-react';
import { forwardRef, type FormEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { PlatformTag } from './PlatformTag';

export type InputMode = 'search' | 'link' | 'invalid-link';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPaste: () => void;
  mode: InputMode;
  platform: LinkPlatform | null;
  busy: boolean;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { value, onChange, onSubmit, onPaste, mode, platform, busy },
  ref,
) {
  const { t } = useI18n();
  const invalid = mode === 'invalid-link';
  const Icon = mode === 'search' ? Search : Link2;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={submit} role="search" className="space-y-2">
      <label htmlFor="query" className="sr-only">
        {t('input.label')}
      </label>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-2xl bg-panel py-2 pr-2 pl-5 ring-1 transition',
          invalid ? 'ring-danger/70' : 'ring-rule focus-within:ring-2 focus-within:ring-amber',
        )}
      >
        <Icon className="size-5 shrink-0 text-fade" aria-hidden />
        <input
          ref={ref}
          id="query"
          type="text"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('input.placeholder')}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'query-hint' : undefined}
          className="min-w-0 flex-1 bg-transparent py-3 text-lg text-paper placeholder:text-fade focus:outline-none sm:text-xl"
        />
        {mode === 'link' && platform && <PlatformTag platform={platform} className="hidden pr-1 sm:inline-flex" />}
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('input.clear')}
            className="grid size-10 shrink-0 place-items-center rounded-xl text-fade transition hover:bg-raised hover:text-paper"
          >
            <X className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onPaste}
            className="hidden h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm text-dust transition hover:bg-raised hover:text-paper sm:inline-flex"
          >
            <ClipboardPaste className="size-4" />
            {t('input.paste')}
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !value.trim() || invalid}
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-paper px-5 font-display text-base font-bold text-night transition hover:bg-paper/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === 'link' ? t('action.open') : t('action.search')}
        </button>
      </div>
      {invalid && (
        <p id="query-hint" className="pl-5 text-sm text-danger">
          {t('input.unsupportedLink')}
        </p>
      )}
    </form>
  );
});
