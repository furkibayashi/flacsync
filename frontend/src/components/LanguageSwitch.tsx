import clsx from 'clsx';
import { useI18n } from '../i18n/I18nProvider';
import { LANGS } from '../i18n/translations';

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t('lang.switch')} className="flex rounded-full bg-panel p-1 ring-1 ring-rule">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          title={t(`lang.${l}` as const)}
          onClick={() => setLang(l)}
          className={clsx(
            'rounded-full px-3 py-1 text-sm font-semibold transition',
            lang === l ? 'bg-paper text-night' : 'text-dust hover:text-paper',
          )}
        >
          {t(`lang.${l}` as const)}
        </button>
      ))}
    </div>
  );
}
