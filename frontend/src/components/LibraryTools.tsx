import clsx from 'clsx';
import { ArrowRight, Check, Copy, FolderTree, HeartPulse, Loader2, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { formatBytes, formatDuration } from '../lib/format';
import { api } from '../services/api';
import type { DuplicateGroup, HealthIssue, HealthReport, OrganizeMove } from '../types/api';
import { LibraryCover } from './LibrarySongRow';

const ISSUES: HealthIssue[] = ['cover', 'lyrics', 'genre', 'year', 'album', 'albumArtist'];

const card = 'rounded-2xl bg-panel/70 p-5 ring-1 ring-rule';
const primary =
  'inline-flex items-center gap-2 rounded-xl bg-amber px-4 py-2 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40';
const secondary =
  'inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-40';

function Heading({ icon: Icon, title, hint }: { icon: typeof HeartPulse; title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold text-paper">
        <Icon className="size-5 text-amber" />
        {title}
      </h3>
      <p className="mt-1 text-sm text-dust">{hint}</p>
    </div>
  );
}

/** Sağlık taraması: eksik etiketleri bul, tek tıkla tamamla */
function HealthPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [report, setReport] = useState<HealthReport | null>(null);

  useEffect(() => {
    void api.health().then((r) => (r.finishedAt || r.running ? setReport(r) : null)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!report?.running) return;
    const timer = setInterval(() => {
      void api.health().then((r) => {
        setReport(r);
        if (!r.running && r.phase === null) onChanged();
      });
    }, 700);
    return () => clearInterval(timer);
  }, [report?.running, onChanged]);

  const busy = report?.running;
  const total = report ? ISSUES.reduce((s, k) => s + report.counts[k], 0) : 0;

  return (
    <section className={card}>
      <Heading icon={HeartPulse} title={t('tools.health')} hint={t('tools.healthHint')} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondary} disabled={busy} onClick={() => void api.healthScan().then(setReport)}>
          {busy && report?.phase === 'scan' ? <Loader2 className="size-4 animate-spin" /> : <HeartPulse className="size-4" />}
          {busy && report?.phase === 'scan' ? t('tools.scanning', { done: report.done, total: report.total }) : t('tools.scan')}
        </button>
        {report && report.items.length > 0 && (
          <button type="button" className={primary} disabled={busy} onClick={() => void api.healthFix().then(setReport)}>
            {busy && report.phase === 'fix' ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {busy && report.phase === 'fix' ? t('tools.fixing', { done: report.done, total: report.total }) : t('tools.fixAll', { count: report.items.length })}
          </button>
        )}
      </div>

      {report?.finishedAt && !busy && (
        <div className="mt-4 space-y-3">
          {report.items.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ok">
              <Check className="size-4" />
              {t('tools.healthy')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {ISSUES.filter((k) => report.counts[k] > 0).map((k) => (
                  <span key={k} className="rounded-full bg-night/60 px-3 py-1 text-xs text-dust ring-1 ring-rule">
                    {t(`tools.issue.${k}` as 'tools.issue.cover')}: <b className="text-paper">{report.counts[k]}</b>
                  </span>
                ))}
              </div>
              {report.fixed + report.failed > 0 && (
                <p className="text-sm text-dust">{t('tools.fixedSummary', { fixed: report.fixed, left: report.items.length })}</p>
              )}
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {report.items.slice(0, 200).map((i) => (
                  <li key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raised/60">
                    <LibraryCover id={i.id} className="size-9 rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-paper">{i.title}</span>
                      <span className="block truncate text-xs text-dust">{i.artist}</span>
                    </span>
                    <span className="hidden flex-wrap justify-end gap-1 sm:flex">
                      {i.issues.map((k) => (
                        <span key={k} className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">
                          {t(`tools.issue.${k}` as 'tools.issue.cover')}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {total > 0 && <p className="text-xs text-fade">{t('tools.healthNote')}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Kopya bulucu: aynı şarkının birden fazla dosyası */
function DuplicatesPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const find = async () => {
    setLoading(true);
    setGroups((await api.duplicates().catch(() => ({ groups: [] }))).groups);
    setLoading(false);
  };

  const remove = async (groupKey: string, id: string) => {
    await api.deleteFile(id).catch(() => undefined);
    setConfirm(null);
    setGroups((gs) =>
      (gs ?? [])
        .map((g) => (g.key === groupKey ? { ...g, tracks: g.tracks.filter((x) => x.id !== id) } : g))
        .filter((g) => g.tracks.length > 1),
    );
    onChanged();
  };

  return (
    <section className={card}>
      <Heading icon={Copy} title={t('tools.duplicates')} hint={t('tools.duplicatesHint')} />
      <button type="button" className={secondary} disabled={loading} onClick={() => void find()}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
        {t('tools.findDuplicates')}
      </button>
      {groups && groups.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-ok">
          <Check className="size-4" />
          {t('tools.noDuplicates')}
        </p>
      )}
      {groups && groups.length > 0 && (
        <ul className="mt-4 space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="rounded-xl bg-night/50 p-3 ring-1 ring-rule">
              <p className="mb-2 font-semibold text-paper">
                {g.artist} — {g.title}
              </p>
              <ul className="space-y-1">
                {g.tracks.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={clsx(
                        'w-11 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase',
                        x.format === 'flac' ? 'bg-flac/20 text-flac' : 'bg-amber/15 text-amber',
                      )}
                    >
                      {x.format}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-dust" title={x.relativePath}>
                      {x.relativePath}
                    </span>
                    <span className="hidden text-xs text-fade tabular-nums sm:block">
                      {x.bitrate ? `${x.bitrate} kbps · ` : ''}
                      {formatBytes(x.size)} · {formatDuration(x.duration)}
                    </span>
                    {x.recommended ? (
                      <span className="shrink-0 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-bold text-ok">{t('tools.keep')}</span>
                    ) : confirm === x.id ? (
                      <button type="button" onClick={() => void remove(g.key, x.id)} className="shrink-0 rounded-full bg-danger/15 px-2.5 py-0.5 text-[11px] font-bold text-danger">
                        {t('tools.confirmDelete')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirm(x.id)}
                        title={t('tools.deleteHint')}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-dust ring-1 ring-rule hover:text-danger"
                      >
                        <Trash2 className="size-3" />
                        {t('tools.delete')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TEMPLATES = [
  '{albumartist}/{year} - {album}/{track} - {title}',
  '{albumartist}/{album}/{track} - {title}',
  '{artist} - {title}',
  '{genre}/{artist} - {title}',
];

/** Klasör düzeni: şablona göre yeniden adlandır / taşı (önizlemeli) */
function OrganizePanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [template, setTemplate] = useState(TEMPLATES[0]!);
  const [preview, setPreview] = useState<{ moves: OrganizeMove[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null);

  const runPreview = async () => {
    setBusy(true);
    setResult(null);
    setPreview(await api.organizePreview(template).catch(() => null));
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true);
    const r = await api.organizeApply(template).catch(() => null);
    setResult(r);
    setPreview(null);
    setBusy(false);
    onChanged();
  };

  return (
    <section className={card}>
      <Heading icon={FolderTree} title={t('tools.organize')} hint={t('tools.organizeHint')} />
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl}
              type="button"
              onClick={() => {
                setTemplate(tpl);
                setPreview(null);
              }}
              className={clsx(
                'rounded-full px-3 py-1 font-mono text-xs transition',
                template === tpl ? 'bg-amber text-on-accent' : 'bg-night/60 text-dust ring-1 ring-rule hover:text-paper',
              )}
            >
              {tpl}
            </button>
          ))}
        </div>
        <input
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            setPreview(null);
          }}
          aria-label={t('tools.template')}
          className="h-10 w-full rounded-xl bg-night px-3 font-mono text-sm text-paper ring-1 ring-rule outline-none focus:ring-amber"
        />
        <p className="text-xs text-fade">{t('tools.tokens')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondary} disabled={busy || template.trim().length < 3} onClick={() => void runPreview()}>
            {busy && !preview ? <Loader2 className="size-4 animate-spin" /> : <FolderTree className="size-4" />}
            {t('tools.preview')}
          </button>
          {preview && preview.total > 0 && (
            <button type="button" className={primary} disabled={busy} onClick={() => void apply()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {t('tools.apply', { count: preview.total })}
            </button>
          )}
        </div>
        {preview && preview.total === 0 && <p className="text-sm text-ok">{t('tools.alreadyOrganized')}</p>}
        {preview && preview.total > 0 && (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-night/50 p-3 font-mono text-xs ring-1 ring-rule">
            {preview.moves.map((m) => (
              <li key={m.id}>
                <span className="text-fade line-through">{m.from}</span>
                <br />
                <span className="text-paper">→ {m.to}</span>
              </li>
            ))}
          </ul>
        )}
        {result && (
          <p className={clsx('text-sm', result.failed ? 'text-danger' : 'text-ok')}>
            {t('tools.organized', { moved: result.moved, failed: result.failed })}
          </p>
        )}
      </div>
    </section>
  );
}

/** Kütüphane → Araçlar */
export function LibraryTools({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-5">
      <HealthPanel onChanged={onChanged} />
      <DuplicatesPanel onChanged={onChanged} />
      <OrganizePanel onChanged={onChanged} />
    </div>
  );
}
