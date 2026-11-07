import clsx from 'clsx';
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Palette,
  RefreshCw,
  RotateCw,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { RangeSlider } from '../components/PlayerBar';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { useI18n } from '../i18n/I18nProvider';
import { LANG_LOCALE, LANG_NAMES, LANGS } from '../i18n/translations';
import { formatBytes } from '../lib/format';
import { updateActions, useAppUpdate } from '../state/appUpdate';
import { THEMES, THEME_SWATCH, useAutoUpdateSetting, useTheme, useVolumeSetting, type Theme } from '../state/settings';

const REPO_URL = 'https://github.com/furkibayashi/flacsync';

function Section({ icon: Icon, title, children, id }: { icon: LucideIcon; title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl bg-panel/70 p-5 ring-1 ring-rule sm:p-6">
      <h2 className="mb-5 flex items-center gap-2.5 font-display text-lg font-bold text-paper">
        <Icon className="size-5 text-amber" />
        {title}
      </h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="font-semibold text-paper">{label}</p>
        {hint && <p className="mt-0.5 text-sm text-dust">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-night p-1 ring-1 ring-rule">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-lg px-4 py-1.5 text-sm font-semibold transition',
            value === o.value ? 'bg-paper text-night' : 'text-dust hover:text-paper',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-7 w-12 rounded-full transition', checked ? 'bg-amber' : 'bg-rule')}
    >
      <span
        className={clsx(
          'absolute top-1 left-1 size-5 rounded-full shadow transition-transform',
          checked ? 'translate-x-5 bg-on-accent' : 'bg-paper',
        )}
      />
    </button>
  );
}

function ThemeCard({ theme, active, onSelect }: { theme: Theme; active: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const [bg, panel, text, accent] = THEME_SWATCH[theme];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={clsx(
        'group relative overflow-hidden rounded-xl text-left ring-2 transition',
        active ? 'ring-amber' : 'ring-rule hover:ring-dust',
      )}
    >
      <span className="block p-3" style={{ backgroundColor: bg }}>
        <span className="flex gap-2">
          <span className="h-14 w-6 rounded-md" style={{ backgroundColor: panel }} />
          <span className="flex-1 space-y-1.5 pt-1">
            <span className="block h-2 w-3/4 rounded-full" style={{ backgroundColor: text }} />
            <span className="block h-2 w-1/2 rounded-full opacity-50" style={{ backgroundColor: text }} />
            <span className="mt-2.5 block h-4 w-14 rounded-md" style={{ backgroundColor: accent }} />
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between bg-panel px-3 py-2 text-sm font-semibold text-paper">
        {t(`theme.${theme}` as const)}
        {active && <Check className="size-4 text-amber" />}
      </span>
    </button>
  );
}

function UpdatePanel() {
  const { t, lang } = useI18n();
  const update = useAppUpdate();
  const [autoCheck, setAutoCheck] = useAutoUpdateSetting();
  const [ytdlp, setYtdlp] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const [showNotes, setShowNotes] = useState(false);

  if (!update) return null;

  const busy = update.status === 'checking' || update.status === 'downloading';
  const checkedAt = update.checkedAt
    ? new Date(update.checkedAt).toLocaleTimeString(LANG_LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
    : null;

  let statusText: string;
  switch (update.status) {
    case 'checking':
      statusText = t('update.checking');
      break;
    case 'available':
      statusText = t('update.available', { version: update.version ?? '' });
      break;
    case 'not-available':
      statusText = t('update.latest');
      break;
    case 'downloading':
      statusText = t('update.downloading', { progress: update.progress ?? 0 });
      break;
    case 'downloaded':
      statusText = t('update.ready', { version: update.version ?? '' });
      break;
    case 'error':
      statusText = t('update.error', { message: update.error ?? '' });
      break;
    case 'unsupported':
      statusText = t('update.unsupported');
      break;
    default:
      statusText = t('update.idle');
  }

  const runYtdlp = async () => {
    setYtdlp({ busy: true, message: null });
    const result = await window.flacsync?.updateYtDlp();
    if (!result) return setYtdlp({ busy: false, message: null });
    setYtdlp({
      busy: false,
      message:
        'error' in result
          ? t('update.ytdlpError', { message: result.error })
          : result.updated
            ? t('update.ytdlpUpdated', { from: result.from, to: result.to })
            : t('update.ytdlpLatest', { version: result.to }),
    });
  };

  return (
    <Section icon={Sparkles} title={t('settings.updates')} id="updates">
      <div
        className={clsx(
          'rounded-xl p-4 ring-1',
          update.status === 'available' || update.status === 'downloaded' ? 'bg-amber/10 ring-amber/40' : 'bg-night/60 ring-rule',
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-dust">
              {t('update.current', { version: update.currentVersion })}
              {update.mode === 'portable' && <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[11px] font-bold text-fade">PORTABLE</span>}
            </p>
            <p className={clsx('mt-1 font-semibold', update.status === 'error' ? 'text-danger' : 'text-paper')}>{statusText}</p>
            {checkedAt && update.status === 'not-available' && (
              <p className="mt-0.5 text-xs text-fade">{t('update.checkedAt', { time: checkedAt })}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(update.status === 'available' || (update.status === 'error' && update.version)) && (
              <button
                type="button"
                onClick={() => void updateActions.download()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber px-4 py-2 font-display font-bold text-on-accent transition hover:bg-amber-hi"
              >
                <Download className="size-4" />
                {t('update.download')}
              </button>
            )}
            {update.status === 'downloaded' && (
              <button
                type="button"
                onClick={() => void updateActions.install()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber px-4 py-2 font-display font-bold text-on-accent transition hover:bg-amber-hi"
              >
                <RotateCw className="size-4" />
                {t('update.install')}
              </button>
            )}
            {update.status !== 'downloaded' && update.status !== 'unsupported' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void updateActions.check()}
                className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-50"
              >
                {update.status === 'checking' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {t('update.check')}
              </button>
            )}
          </div>
        </div>
        {update.status === 'downloading' && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-rule">
              <div className="h-full bg-amber transition-[width] duration-300" style={{ width: `${update.progress ?? 0}%` }} />
            </div>
            {update.bytesPerSecond ? (
              <p className="mt-1.5 text-xs text-fade tabular-nums">{formatBytes(update.bytesPerSecond)}/s</p>
            ) : null}
          </div>
        )}
        {update.notes && (update.status === 'available' || update.status === 'downloading' || update.status === 'downloaded') && (
          <div className="mt-4">
            <button type="button" onClick={() => setShowNotes((v) => !v)} className="text-sm font-semibold text-amber hover:text-amber-hi">
              {showNotes ? t('update.hideNotes') : t('update.showNotes')}
            </button>
            {showNotes && (
              <pre className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-night p-3 font-sans text-sm whitespace-pre-wrap text-dust ring-1 ring-rule">
                {update.notes}
              </pre>
            )}
          </div>
        )}
      </div>
      {update.mode === 'portable' && <p className="text-sm text-dust">{t('update.portableHint')}</p>}

      <Row label={t('update.auto')} hint={t('update.autoHint')}>
        <Toggle checked={autoCheck} onChange={setAutoCheck} label={t('update.auto')} />
      </Row>

      <Row label={t('update.ytdlp')} hint={ytdlp.message ?? t('update.ytdlpHint')}>
        <button
          type="button"
          disabled={ytdlp.busy}
          onClick={() => void runYtdlp()}
          className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-50"
        >
          {ytdlp.busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {t('update.ytdlpButton')}
        </button>
      </Row>
    </Section>
  );
}

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  const [volume, setVolume] = useVolumeSetting();
  const [format, setFormat] = usePreferredFormat();
  const [info, setInfo] = useState<{ version: string; saveDir: string } | null>(null);
  const desktop = window.flacsync;

  useEffect(() => {
    void desktop?.appInfo().then(setInfo);
  }, [desktop]);

  // Menüden "Güncellemeleri denetle" ile gelindiyse güncelleme bölümüne kaydır
  useEffect(() => {
    if (window.location.hash.includes('updates')) document.getElementById('updates')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const linkBtn =
    'inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-paper ring-1 ring-rule transition hover:ring-dust';

  return (
    <div className="animate-rise space-y-6 pb-8">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-paper sm:text-4xl">{t('settings.title')}</h1>
        <p className="mt-2 text-dust">{t('settings.subtitle')}</p>
      </header>

      <Section icon={Palette} title={t('settings.appearance')}>
        <div>
          <p className="mb-3 font-semibold text-paper">{t('settings.theme')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {THEMES.map((th) => (
              <ThemeCard key={th} theme={th} active={theme === th} onSelect={() => setTheme(th)} />
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold text-paper">{t('settings.language')}</p>
          <p className="mt-0.5 mb-3 text-sm text-dust">{t('settings.languageHint')}</p>
          <div role="radiogroup" aria-label={t('settings.language')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                lang={l}
                aria-checked={lang === l}
                onClick={() => setLang(l)}
                className={clsx(
                  'flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold ring-1 transition',
                  lang === l ? 'bg-amber/10 text-paper ring-amber' : 'bg-night/50 text-dust ring-rule hover:text-paper hover:ring-dust',
                )}
              >
                <span>
                  {LANG_NAMES[l]}
                  <span className="ml-1.5 text-[11px] font-bold tracking-wide text-fade uppercase">{l}</span>
                </span>
                {lang === l && <Check className="size-4 shrink-0 text-amber" />}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section icon={Volume2} title={t('settings.player')}>
        <Row label={t('settings.volume')} hint={t('settings.volumeHint')}>
          <div className="flex w-56 items-center gap-3">
            <RangeSlider value={volume} max={1} step={0.01} onChange={(v) => setVolume(Math.round(v * 100) / 100)} label={t('settings.volume')} className="flex-1" />
            <span className="w-10 text-right text-sm text-dust tabular-nums">{Math.round(volume * 100)}%</span>
          </div>
        </Row>
        <p className="flex items-start gap-2 rounded-lg bg-night/60 p-3 text-sm text-dust ring-1 ring-rule">
          <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-fade" />
          {t('settings.shortcuts')}
        </p>
      </Section>

      <Section icon={Settings2} title={t('settings.downloads')}>
        <Row label={t('settings.format')} hint={t('settings.formatHint')}>
          <Segmented
            value={format}
            options={[
              { value: 'mp3', label: 'MP3 320' },
              { value: 'flac', label: 'FLAC' },
            ]}
            onChange={setFormat}
            label={t('settings.format')}
          />
        </Row>
        {desktop && info && (
          <Row label={t('settings.saveDir')} hint={info.saveDir}>
            <button type="button" onClick={() => void desktop.openLocation('library')} className={linkBtn}>
              <FolderOpen className="size-4" />
              {t('settings.open')}
            </button>
          </Row>
        )}
        {desktop && (
          <Row label={t('settings.advanced')} hint={t('settings.advancedHint')}>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void desktop.openLocation('settings')} className={linkBtn}>
                <FileText className="size-4" />
                {t('settings.editFile')}
              </button>
              <button type="button" onClick={() => void desktop.relaunch()} className={linkBtn}>
                <RotateCw className="size-4" />
                {t('settings.relaunch')}
              </button>
            </div>
          </Row>
        )}
      </Section>

      <UpdatePanel />

      <Section icon={ScrollText} title={t('settings.about')}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-xl font-extrabold text-paper">
              FlacSync <span className="text-amber">{info?.version ?? ''}</span>
            </p>
            <p className="mt-1 text-sm text-dust">{t('settings.aboutText')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={linkBtn}>
              <ExternalLink className="size-4" />
              GitHub
            </a>
            {desktop && (
              <>
                <button type="button" onClick={() => void desktop.openLocation('licenses')} className={linkBtn}>
                  {t('settings.licenses')}
                </button>
                <button type="button" onClick={() => void desktop.openLocation('logs')} className={linkBtn}>
                  {t('settings.logs')}
                </button>
              </>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

