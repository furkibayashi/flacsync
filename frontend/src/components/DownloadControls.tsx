import clsx from 'clsx';
import { AlertCircle, Check, Download, FolderOpen, Loader2, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isDesktopApp, revealSavedFile, saveFileAs } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import { formatBytes } from '../lib/format';
import type { UiError } from '../services/api';
import type { DownloadJob, OutputFormat } from '../types/api';
import { FormatPicker } from './FormatPicker';

interface Props {
  format: OutputFormat;
  onFormatChange: (format: OutputFormat) => void;
  onDownload: () => void;
  onReset: () => void;
  canDownload: boolean;
  isRunning: boolean;
  job: DownloadJob | null;
  jobError: UiError | null;
  fileUrl: string | null;
}

export function DownloadControls({
  format,
  onFormatChange,
  onDownload,
  onReset,
  canDownload,
  isRunning,
  job,
  jobError,
  fileUrl,
}: Props) {
  const { t, tError } = useI18n();
  const [savedAs, setSavedAs] = useState<string | null>(null);
  // Yeni indirme başlayınca önceki "farklı kaydet" bilgisini temizle
  useEffect(() => setSavedAs(null), [job?.id]);
  const done = job?.status === 'completed';
  const failed = job?.status === 'failed';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <FormatPicker value={format} onChange={onFormatChange} disabled={isRunning} />

        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload}
          className="inline-flex h-[62px] items-center gap-2.5 rounded-xl bg-amber px-7 font-display text-lg font-bold text-night transition hover:bg-amber-hi disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" strokeWidth={2.5} />}
          {isRunning ? t('action.preparing') : done || failed ? t('action.downloadAgain') : t('action.download')}
        </button>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-[62px] items-center gap-2 rounded-xl px-4 text-[15px] text-dust transition hover:bg-panel hover:text-paper"
        >
          <RotateCcw className="size-4" />
          {t('action.newSong')}
        </button>
      </div>

      {job && (
        <div className="max-w-xl space-y-2" aria-live="polite">
          <div className="flex items-baseline justify-between gap-4 text-[15px]">
            <span className={clsx('font-medium', failed ? 'text-danger' : 'text-paper')}>
              {t(`status.${job.status}` as const)}
              {!done && !failed && '…'}
            </span>
            <span className="text-dust tabular-nums">{job.progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
            aria-label={t(`status.${job.status}` as const)}
            className="h-1.5 overflow-hidden rounded-full bg-rule"
          >
            <div
              className={clsx('h-full rounded-full transition-[width] duration-500 ease-out', failed ? 'bg-danger' : 'bg-amber')}
              style={{ width: `${Math.max(job.progress, 2)}%` }}
            />
          </div>

          {failed && job.error && (
            <p className="flex items-start gap-2 pt-1 text-sm text-danger" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {tError(job.error.code, job.error.message)}
            </p>
          )}

          {done && job.file && fileUrl && (
            <div className="space-y-1 pt-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="flex min-w-0 items-center gap-2 text-[15px] text-paper">
                  <Check className="size-4 shrink-0 text-amber" strokeWidth={3} />
                  <span className="truncate">
                    {isDesktopApp ? t('done.saved', { name: job.file.name }) : t('done.ready', { name: job.file.name })}
                  </span>
                </p>
                {isDesktopApp ? (
                  // Masaüstünde dosya zaten otomatik kaydedildi: yerini göster ya da başka yere kopyala
                  <>
                    <button
                      type="button"
                      onClick={() => revealSavedFile(job.id)}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber underline-offset-4 hover:underline"
                    >
                      <FolderOpen className="size-4" />
                      {t('action.showInFolder')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => setSavedAs(await saveFileAs(job.id))}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-dust underline-offset-4 hover:text-paper hover:underline"
                    >
                      <Save className="size-4" />
                      {t('action.saveAs')}
                    </button>
                  </>
                ) : (
                  <a
                    href={fileUrl}
                    download={job.file.name}
                    className="text-sm font-semibold text-amber underline-offset-4 hover:underline"
                  >
                    {t('action.saveFile')}
                  </a>
                )}
              </div>
              <p className="text-sm text-fade">
                {formatBytes(job.file.size)}, {job.file.hasCover ? t('done.cover') : t('done.noCover')}
                {isDesktopApp && `. ${t('done.location')}`}
              </p>
              {savedAs && <p className="text-sm text-amber">{t('done.savedAs', { path: savedAs })}</p>}
            </div>
          )}
        </div>
      )}

      {jobError && (
        <p className="flex items-start gap-2 text-sm text-danger" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {tError(jobError.code, jobError.message)}
        </p>
      )}
    </div>
  );
}
