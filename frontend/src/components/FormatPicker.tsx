import clsx from 'clsx';
import { useI18n } from '../i18n/I18nProvider';
import type { OutputFormat } from '../types/api';

const FORMATS: OutputFormat[] = ['mp3', 'flac'];

interface Props {
  value: OutputFormat;
  onChange: (format: OutputFormat) => void;
  disabled?: boolean;
}

export function FormatPicker({ value, onChange, disabled = false }: Props) {
  const { t } = useI18n();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm text-fade">{t('format.legend')}</legend>
      <div className="flex rounded-xl bg-panel p-1 ring-1 ring-rule">
        {FORMATS.map((f) => (
          <label
            key={f}
            className={clsx(
              'cursor-pointer rounded-lg px-4 py-2 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber',
              value === f ? 'bg-raised text-paper' : 'text-dust hover:text-paper',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name="format"
              value={f}
              checked={value === f}
              onChange={() => onChange(f)}
              className="sr-only"
            />
            <span className="block font-display text-base font-bold">{f.toUpperCase()}</span>
            <span className="block text-xs text-fade">{t(`format.${f}` as const)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
