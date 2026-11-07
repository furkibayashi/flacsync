import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SearchRequest } from '../App';
import { useCoverColor } from '../hooks/useCoverColor';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { isTerminal, useQueue } from '../state/QueueProvider';
import type { Route } from '../state/router';
import { useI18n } from '../i18n/I18nProvider';
import { detectPlatform, looksLikeUrl } from '../lib/format';
import { api, isAbort, toUiError, type UiError } from '../services/api';
import type { AlbumResult, Collection, ParseResponse, SearchResponse, SearchResult } from '../types/api';
import { AlbumResults } from './AlbumResults';
import { CollectionView } from './CollectionView';
import { DownloadControls } from './DownloadControls';
import { ResultsList } from './ResultsList';
import { SearchBar, type InputMode } from './SearchBar';
import { Sleeve } from './Sleeve';
import { SourceLine, type SourceState } from './SourceLine';
import { TrackDetails } from './TrackDetails';

const EXAMPLES = ['tarkan şımarık', 'queen bohemian rhapsody', 'daft punk discovery'];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Sorgu sanatçı + albüm adını içeriyor ve en iyi şarkının adını içermiyorsa kullanıcı albüm arıyordur. */
function targetsAlbum(query: string, album: AlbumResult, best: SearchResult | null): boolean {
  const q = ` ${norm(query)} `;
  const has = (s: string) => Boolean(norm(s)) && q.includes(` ${norm(s)} `);
  return has(album.title) && has(album.artist) && !(best && has(best.title) && norm(best.title) !== norm(album.title));
}

/** "Daha fazla göster" ile istenen sonuç sayısı */
const MORE_LIMIT = 25;

interface Props {
  /** Kapak rengini sayfa arka planına iletmek için */
  onArtColor: (rgb: string | null) => void;
  /** Ana sayfadan gelen arama */
  request: SearchRequest | null;
  onNavigate: (route: Route) => void;
}

/**
 * Şarkı adı → tüm platformlarda ara → en iyi sonucu otomatik seç
 * ya da link → doğrudan aç. Ardından kaynak eşleşmesi ve indirme.
 */
export function Downloader({ onArtColor, request, onNavigate }: Props) {
  const { t, tError } = useI18n();
  const queue = useQueue();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'search' | 'track' | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [track, setTrack] = useState<ParseResponse | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [trackAlbum, setTrackAlbum] = useState<AlbumResult | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [source, setSource] = useState<SourceState>({ status: 'idle' });
  const [format, setFormat] = usePreferredFormat();
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Tek şarkı indirmesi global sıradan izlenir
  const [jobId, setJobId] = useState<string | null>(null);
  const job = jobId ? queue.jobs[jobId] ?? null : null;
  const isRunning = Boolean(job && !isTerminal(job));
  const resetJob = () => setJobId(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trackRef = useRef<HTMLElement | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const trackAbort = useRef<AbortController | null>(null);

  const platform = detectPlatform(input);
  const mode: InputMode = platform ? 'link' : looksLikeUrl(input) ? 'invalid-link' : 'search';

  const artColor = useCoverColor(track?.metadata.coverUrl ?? collection?.coverUrl);
  useEffect(() => onArtColor(artColor), [artColor, onArtColor]);

  // Ana sayfadaki aramadan gelen sorgu
  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!request || lastRequest.current === request.nonce) return;
    lastRequest.current = request.nonce;
    setInput(request.query);
    submit(request.query, true);
    // yalnızca yeni istekte çalışır
  }, [request]);

  useEffect(
    () => () => {
      searchAbort.current?.abort();
      trackAbort.current?.abort();
    },
    [],
  );

  async function loadTrack(url: string) {
    trackAbort.current?.abort();
    const controller = new AbortController();
    trackAbort.current = controller;

    resetJob();
    setBusy('track');
    setError(null);
    setTrack(null);
    setCollection(null);
    setTrackAlbum(null);
    setTrackUrl(url);
    setSource({ status: 'idle' });

    try {
      const res = await api.lookup(url, controller.signal);
      if (controller.signal.aborted) return;
      if (res.kind === 'collection') {
        // Albüm / çalma listesi: parça listesi görünümü (kaynaklar parça parça indirilirken eşleşir)
        setCollection(res.collection);
        setBusy(null);
        return;
      }
      const parsed: ParseResponse = res;
      setTrack(parsed);
      setBusy(null);
      setSource({ status: 'loading' });

      // Şarkının albümü: "Albümü aç" ile tüm parçaları listelemek için (bulunamazsa gösterilmez)
      if (parsed.metadata.album) {
        api
          .albumOf(parsed.metadata.artist, parsed.metadata.album, controller.signal)
          .then((r) => !controller.signal.aborted && setTrackAlbum(r.album))
          .catch(() => undefined);
      }

      // Kaynak eşleştirme arka planda; kart beklemeden görünür
      api
        .resolve(url, controller.signal)
        .then((res) => !controller.signal.aborted && setSource({ status: 'ready', data: res.source }))
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbort(err)) return;
          setSource({ status: 'error', error: toUiError(err) });
        });
    } catch (err) {
      if (controller.signal.aborted || isAbort(err)) return;
      setError(toUiError(err));
      setBusy(null);
    }
  }

  async function runSearch(query: string) {
    searchAbort.current?.abort();
    trackAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;

    resetJob();
    setBusy('search');
    setError(null);
    setSearch(null);
    setSelected(null);
    setTrack(null);
    setCollection(null);
    setSource({ status: 'idle' });
    setSearchQuery(query);
    setNotice(null);

    try {
      const res = await api.search(query, controller.signal);
      if (controller.signal.aborted) return;
      setSearch(res);
      const topAlbum = res.albums[0];
      if (topAlbum && targetsAlbum(query, topAlbum, res.best)) {
        // "daft punk discovery" gibi albüm aramaları doğrudan parça listesini açar
        void loadTrack(topAlbum.url);
      } else if (res.best) {
        setSelected(res.best);
        void loadTrack(res.best.url);
      } else {
        setBusy(null);
      }
    } catch (err) {
      if (controller.signal.aborted || isAbort(err)) return;
      setError(toUiError(err));
      setBusy(null);
    }
  }

  function submit(value = input, force = false) {
    const q = value.trim();
    if (!q || (busy && !force)) return;
    if (detectPlatform(q)) {
      searchAbort.current?.abort();
      setSearch(null);
      setSelected(null);
      void loadTrack(q);
    } else if (looksLikeUrl(q)) {
      setError({ code: 'UNSUPPORTED_PLATFORM', message: '' });
    } else if (q.length < 2) {
      setError({ code: 'VALIDATION_ERROR', message: t('input.tooShort') });
    } else {
      void runSearch(q);
    }
  }

  function choose(result: SearchResult) {
    if (result.id === selected?.id) return;
    setSelected(result);
    void loadTrack(result.url);
    trackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadMore() {
    if (!searchQuery || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.search(searchQuery, undefined, MORE_LIMIT);
      setSearch((prev) => (prev ? { ...prev, results: res.results, albums: prev.albums.length ? prev.albums : res.albums } : res));
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  /** Seçilen şarkıları sıraya ekler: tek şarkı tek iş, birden fazlası tek toplu iş. */
  async function addToQueue(results: SearchResult[]) {
    if (results.length === 0) return;
    if (results.length === 1) {
      const created = await queue.enqueue(results[0]!.url, format);
      if (created) setNotice(t('queue.addedOne', { title: results[0]!.title }));
    } else {
      const created = await queue.enqueueBatch(searchQuery || t('queue.selection'), format, results.map((r) => ({ url: r.url })), false);
      if (created) setNotice(t('queue.addedMany', { count: results.length }));
    }
  }

  function openAlbum(album: AlbumResult) {
    setSelected(null);
    void loadTrack(album.url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setInput(text);
      inputRef.current?.focus();
    } catch {
      setError({ code: 'CLIPBOARD', message: '' });
    }
  }

  function resetAll() {
    searchAbort.current?.abort();
    trackAbort.current?.abort();
    resetJob();
    setInput('');
    setBusy(null);
    setError(null);
    setSearch(null);
    setSelected(null);
    setTrack(null);
    setCollection(null);
    setTrackUrl(null);
    setSource({ status: 'idle' });
    inputRef.current?.focus();
  }

  const idle = !busy && !track && !collection && !search && !error;
  const others = search?.results ?? [];
  const albums = search?.albums ?? [];
  const foundOn = selected?.sources ?? (track ? [track.platform] : []);

  return (
    <div className="space-y-12">
      <div className="space-y-4">
        {idle && (
          <div className="animate-rise space-y-4 pb-4">
            <h1 className="max-w-[16ch] font-display text-5xl leading-[0.98] font-extrabold tracking-[-0.035em] text-balance sm:text-7xl">
              {t('hero.title')}
            </h1>
            <p className="max-w-[56ch] text-lg leading-relaxed text-dust">{t('hero.subtitle')}</p>
          </div>
        )}

        <SearchBar
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSubmit={() => submit()}
          onPaste={paste}
          mode={mode}
          platform={platform}
          busy={busy !== null}
        />

        {idle && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-5 text-sm text-fade">
            <span>{t('input.examples')}:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setInput(ex);
                  submit(ex);
                }}
                className="rounded-md text-dust underline decoration-rule underline-offset-4 transition hover:text-paper hover:decoration-amber"
              >
                {ex}
              </button>
            ))}
          </p>
        )}
      </div>

      {notice && (
        <div className="animate-rise flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-amber/10 px-4 py-3 text-[15px] ring-1 ring-amber/30" role="status">
          <CheckCircle2 className="size-5 shrink-0 text-amber" />
          <span className="flex-1 text-paper">{notice}</span>
          <button type="button" onClick={() => onNavigate('queue')} className="inline-flex items-center gap-1 text-sm font-semibold text-amber hover:underline">
            {t('home.openQueue')}
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}

      {(error || queue.error) && (
        <p className="flex items-start gap-2.5 text-[15px] text-danger" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error
            ? error.code === 'VALIDATION_ERROR' && error.message
              ? error.message
              : tError(error.code, error.message)
            : queue.error && tError(queue.error.code, queue.error.message)}
        </p>
      )}

      {collection && <CollectionView key={collection.url} collection={collection} onReset={resetAll} />}

      {busy && !track && (
        <p className="flex items-center gap-3 font-display text-2xl font-bold text-dust" aria-live="polite">
          <Loader2 className="size-6 animate-spin text-amber" />
          {busy === 'search' ? t('state.searching') : t('state.loadingTrack')}…
        </p>
      )}

      {track && (
        <section
          ref={trackRef}
          key={trackUrl}
          className="animate-rise grid scroll-mt-6 gap-10 md:grid-cols-[auto_minmax(0,1fr)] md:gap-12"
          style={{ '--cover': 'clamp(220px, 30vw, 330px)' } as CSSProperties}
        >
          <div className="flex justify-center md:block">
            <Sleeve
              coverUrl={track.metadata.coverUrl}
              alt={t('track.cover', { album: track.metadata.album ?? track.metadata.title })}
              spinning={isRunning}
              preview={
                source.status === 'ready' && source.data.previewUrl
                  ? {
                      id: `preview:${trackUrl ?? track.metadata.title}`,
                      title: track.metadata.title,
                      artist: track.metadata.artist,
                      album: track.metadata.album,
                      coverUrl: track.metadata.coverUrl,
                      src: source.data.previewUrl,
                      kind: 'preview',
                    }
                  : null
              }
            />
          </div>

          <div className="min-w-0 space-y-8">
            <TrackDetails
              track={track}
              foundOn={foundOn}
              isBestMatch={Boolean(selected && selected.id === search?.best?.id)}
              album={trackAlbum}
              onOpenAlbum={openAlbum}
            />
            <div className="space-y-6 border-t border-rule pt-6">
              <SourceLine source={source} />
              <DownloadControls
                format={format}
                onFormatChange={setFormat}
                onDownload={() => {
                  if (!trackUrl) return;
                  void queue.enqueue(trackUrl, format).then((created) => created && setJobId(created.id));
                }}
                onReset={resetAll}
                canDownload={Boolean(trackUrl) && source.status !== 'error' && !isRunning}
                isRunning={isRunning}
                job={job}
                jobError={null}
                fileUrl={job && isTerminal(job) ? api.fileUrl(job.id) : null}
              />
            </div>
          </div>
        </section>
      )}

      {albums.length > 0 && <AlbumResults albums={albums} onOpen={openAlbum} />}

      {others.length > 1 && (
        <ResultsList
          results={others}
          selectedId={selected?.id ?? null}
          onSelect={choose}
          onAddToQueue={(list) => void addToQueue(list)}
          format={format}
          onFormatChange={setFormat}
          canLoadMore={others.length < MORE_LIMIT && others.length >= 8}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
        />
      )}
    </div>
  );
}
