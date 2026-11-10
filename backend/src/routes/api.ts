import { Router, type Response } from 'express';
import yazl from 'yazl';
import { z } from 'zod';
import { MAX_COLLECTION_TRACKS } from '../services/metadata/normalize.js';
import { jobsService, toPublicSource, type PublicJob } from '../services/jobs.service.js';
import { MetadataError, metadataService } from '../services/metadata.service.js';
import { finalizeMetadata } from '../services/metadata/normalize.js';
import { historyService } from '../services/history.service.js';
import { resolverService } from '../services/resolver.service.js';
import { searchService } from '../services/search.service.js';
import { COUNTRIES, discoverService, GENRES } from '../services/discover.service.js';
import { artistService } from '../services/artist.service.js';
import { freshDeezerPreview } from '../services/metadata/deezer-preview.js';
import { followService } from '../services/follow.service.js';
import { DEFAULT_TEMPLATE, libraryToolsService } from '../services/library-tools.service.js';
import { libraryService } from '../services/library.service.js';
import { SyncError, syncService } from '../services/sync.service.js';
import { PlaylistError, playlistService } from '../services/playlist.service.js';
import { lyricsService } from '../services/lyrics/lyrics.service.js';
import { HttpError } from '../utils/http-error.js';

// ---------------------------------------------------------------------------
// Doğrulama şemaları
// ---------------------------------------------------------------------------

const urlField = z.string().trim().min(1, 'url zorunlu').max(2048);
const formatField = z.enum(['mp3', 'flac']).default('mp3');

const metadataSchema = z.object({
  title: z.string().trim().min(1).max(500),
  artist: z.string().trim().min(1).max(500),
  album: z.string().max(500).nullable().default(null),
  releaseDate: z.string().max(10).nullable().default(null),
  coverUrl: z.string().url().max(2048).nullable().default(null),
  isrc: z.string().max(20).nullable().default(null),
  duration: z.number().int().positive().max(4 * 60 * 60).nullable().default(null),
  genre: z.string().max(100).nullable().default(null),
});

const parseBody = z.object({ url: urlField });
const resolveBody = z.union([z.object({ url: urlField }), z.object({ metadata: metadataSchema })]);
const downloadBody = z.object({ url: urlField, format: formatField });
const jobParams = z.object({ id: z.string().uuid('Geçersiz iş kimliği') });
const overridesSchema = z
  .object({
    album: z.string().trim().max(500).optional(),
    releaseDate: z.string().trim().max(10).optional(),
    coverUrl: z.string().url().max(2048).optional(),
  })
  .strict();
const extrasSchema = z
  .object({
    trackNumber: z.number().int().min(1).max(999).optional(),
    trackTotal: z.number().int().min(1).max(999).optional(),
    discNumber: z.number().int().min(1).max(99).optional(),
    albumArtist: z.string().trim().max(500).optional(),
  })
  .strict();
const batchBody = z.object({
  name: z.string().trim().min(1).max(200),
  format: formatField,
  /** false: seçilmiş tek tek şarkılar — masaüstünde alt klasör açılmaz */
  useFolder: z.boolean().default(true),
  items: z
    .array(z.object({ url: urlField, overrides: overridesSchema.optional(), extras: extrasSchema.optional() }))
    .min(1, 'En az bir parça seçin')
    .max(MAX_COLLECTION_TRACKS),
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const historyParams = z.object({ id: z.string().min(1).max(64) });
const albumOfBody = z.object({
  artist: z.string().trim().min(1).max(500),
  album: z.string().trim().min(1).max(500),
});
const searchBody = z.object({
  query: z.string().trim().min(2, 'En az 2 karakter girin').max(200),
  limit: z.number().int().min(1).max(30).default(8),
});

function assertSupported(url: string): void {
  if (!metadataService.isSupportedUrl(url)) {
    throw new MetadataError(
      'UNSUPPORTED_PLATFORM',
      'Desteklenmeyen link. Spotify, Apple Music, Deezer, YouTube Music veya Amazon Music linki girin.',
    );
  }
}

function requireJob(id: string): PublicJob {
  const job = jobsService.get(id);
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'İndirme işi bulunamadı veya süresi doldu');
  return job;
}

function sendFile(res: Response, jobId: string): void {
  const file = jobsService.getFile(jobId);
  if (!file) throw new HttpError(409, 'FILE_NOT_READY', 'Dosya henüz hazır değil');
  res.type(file.mimeType);
  // Content-Disposition: UTF-8 dosya adı (RFC 5987) Express tarafından eklenir
  res.download(file.path, file.name);
}

// ---------------------------------------------------------------------------

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

/** Şarkı adı → tüm platformlarda arama, birleştirilmiş ve sıralanmış sonuçlar */
apiRouter.post('/search', async (req, res) => {
  const { query, limit } = searchBody.parse(req.body);
  res.json(await searchService.search(query, limit));
});

/** Şarkının albümü (şarkı ekranındaki "Albümü aç" için); bulunamazsa { album: null } */
apiRouter.post('/album-of', async (req, res) => {
  const { artist, album } = albumOfBody.parse(req.body);
  res.json({ album: await searchService.findAlbum(artist, album) });
});

/** Link → tek şarkıysa metadata, albüm / çalma listesiyse parça listesi */
apiRouter.post('/lookup', async (req, res) => {
  const { url } = parseBody.parse(req.body);
  assertSupported(url);
  res.json(await metadataService.lookup(url));
});

// --- Toplu indirme (albüm / çalma listesi / seçili parçalar) ----------------

apiRouter.post('/batch', (req, res) => {
  const body = batchBody.parse(req.body);
  body.items.forEach((item) => assertSupported(item.url));
  const batch = jobsService.createBatch(body);
  res.status(202).location(`${req.baseUrl}/batch/${batch.id}`).json(batch);
});

apiRouter.get('/batch/:id', (req, res) => {
  const { id } = jobParams.parse(req.params);
  const data = jobsService.getBatch(id);
  if (!data) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Toplu indirme bulunamadı veya süresi doldu');
  res.json(data);
});

/** Toplu indirme ilerleme akışı: önce tam durum ("snapshot"), sonra parça güncellemeleri ("job") */
apiRouter.get('/batch/:id/events', (req, res) => {
  const { id } = jobParams.parse(req.params);
  const initial = jobsService.getBatch(id);
  if (!initial) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Toplu indirme bulunamadı veya süresi doldu');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  const unsubscribe = jobsService.subscribeBatch(id, (job, batch) => {
    write('job', { job, batch });
    if (jobsService.isBatchTerminal(batch)) close();
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', close);

  write('snapshot', initial);
  if (jobsService.isBatchTerminal(initial.batch)) close();
});

/** Tamamlanan parçaları tek ZIP olarak indir (ses dosyaları zaten sıkıştırılmış → "store") */
apiRouter.get('/batch/:id/zip', (req, res) => {
  const { id } = jobParams.parse(req.params);
  const data = jobsService.getBatch(id);
  if (!data) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Toplu indirme bulunamadı veya süresi doldu');
  const files = jobsService.batchFiles(id);
  if (files.length === 0) throw new HttpError(409, 'FILE_NOT_READY', 'Henüz tamamlanan parça yok');

  const zip = new yazl.ZipFile();
  for (const file of files) zip.addFile(file.path, `${data.batch.folder}/${file.name}`, { compress: false });
  zip.end();

  res.attachment(`${data.batch.folder}.zip`);
  res.type('application/zip');
  zip.outputStream.pipe(res);
});

/** URL → standart metadata */
apiRouter.post('/parse', async (req, res) => {
  const { url } = parseBody.parse(req.body);
  assertSupported(url);
  res.json(await metadataService.extractDetailed(url));
});

/** URL veya metadata → eşleşen ses kaynağı */
apiRouter.post('/resolve', async (req, res) => {
  const body = resolveBody.parse(req.body);
  let metadata;
  if ('url' in body) {
    assertSupported(body.url);
    metadata = await metadataService.extract(body.url);
  } else {
    metadata = finalizeMetadata(body.metadata);
  }
  const source = await resolverService.resolve(metadata);
  res.json({ metadata, source: toPublicSource(source) });
});

/** Arka planda indirme işi başlatır → 202 + iş kimliği (ilerleme SSE ile izlenir) */
apiRouter.post('/download', (req, res) => {
  const { url, format } = downloadBody.parse(req.body);
  assertSupported(url);
  const job = jobsService.create(url, format);
  res.status(202).location(`${req.baseUrl}/download/${job.id}`).json(job);
});

/**
 * Tek istekte indir: GET /api/download?url=...&format=mp3
 * İş bitene kadar bekler ve etiketlenmiş dosyayı doğrudan gönderir (curl / tarayıcı linki için).
 */
apiRouter.get('/download', async (req, res) => {
  const { url, format } = downloadBody.parse(req.query);
  assertSupported(url);
  const { id } = jobsService.create(url, format);
  const job = await jobsService.waitFor(id);
  if (!job) throw new HttpError(500, 'JOB_LOST', 'İndirme işi kayboldu');
  if (job.status !== 'completed') {
    throw new HttpError(job.error?.status ?? 502, job.error?.code ?? 'DOWNLOAD_FAILED', job.error?.message ?? 'İndirme tamamlanamadı');
  }
  sendFile(res, id);
});

// --- Sıra (tüm indirmeler) ---------------------------------------------------

apiRouter.get('/queue', (_req, res) => {
  res.json(jobsService.snapshot());
});

/** Sıra akışı: önce tam durum ("snapshot"), sonra her iş güncellemesi ("job") ve kaldırılanlar ("removed") */
apiRouter.get('/queue/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const offJobs = jobsService.subscribeAll((job, batch) => write('job', { job, batch }));
  const offRemoved = jobsService.onRemoved((id) => write('removed', { id }));
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    offJobs();
    offRemoved();
  });
  write('snapshot', jobsService.snapshot());
});

apiRouter.delete('/queue/finished', async (_req, res) => {
  res.json({ removed: await jobsService.clearFinished() });
});

apiRouter.post('/download/:id/cancel', (req, res) => {
  const { id } = jobParams.parse(req.params);
  requireJob(id);
  res.json({ cancelled: jobsService.cancel(id) });
});

apiRouter.post('/download/:id/retry', (req, res) => {
  const { id } = jobParams.parse(req.params);
  requireJob(id);
  const job = jobsService.retry(id);
  if (!job) throw new HttpError(409, 'NOT_RETRYABLE', 'Yalnızca başarısız ya da iptal edilmiş indirmeler yeniden denenebilir');
  res.status(202).json(job);
});

// --- Keşfet ----------------------------------------------------------------

const discoverQuery = z.object({
  genre: z.coerce.number().int().refine((id) => GENRES.some((g) => g.id === id), 'Bilinmeyen tür').default(0),
  country: z.enum(COUNTRIES).default('tr'),
});

apiRouter.get('/discover/genres', (_req, res) => {
  res.json({ genres: GENRES, countries: COUNTRIES });
});

apiRouter.get('/discover', async (req, res) => {
  const { genre, country } = discoverQuery.parse(req.query);
  res.set('Cache-Control', 'private, max-age=600');
  res.json(await discoverService.genre(genre, country));
});

const artistParams = z.object({ id: z.string().regex(/^[0-9]{1,15}$/) });

// --- Önizleme (Deezer imzalı linkleri ~15 dk'da geçersiz olur) -------------

apiRouter.get('/preview/deezer/:id', async (req, res) => {
  const { id } = artistParams.parse(req.params);
  const url = await freshDeezerPreview(id);
  if (!url) throw new HttpError(404, 'NOT_FOUND', 'Önizleme yok');
  res.set('Cache-Control', 'private, max-age=300');
  res.redirect(302, url);
});

// --- Sanatçı profili --------------------------------------------------------

const artistFind = z.object({ name: z.string().trim().min(1).max(200) });

/** Ada göre sanatçı (tıklanan sanatçı adından profile) */
apiRouter.get('/artist/find', async (req, res) => {
  const { name } = artistFind.parse(req.query);
  res.json({ artist: await artistService.find(name) });
});

apiRouter.get('/artist/:id', async (req, res) => {
  const { id } = artistParams.parse(req.params);
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await artistService.profile(id));
});

// --- Kütüphane ---------------------------------------------------------------

const libraryParams = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) });

apiRouter.get('/library', (_req, res) => {
  res.json(libraryService.list());
});

apiRouter.post('/library/rescan', async (_req, res) => {
  res.json(await libraryService.rescan());
});

/** Dosyayı oynatıcıya akıtır (Range desteğiyle ileri / geri sarılabilir) */
apiRouter.get('/library/tracks/:id/stream', (req, res, next) => {
  const { id } = libraryParams.parse(req.params);
  const file = libraryService.filePath(id);
  if (!file) throw new HttpError(404, 'NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
  // ?download=1: tarayıcı (ör. telefon) dosyayı kaydetsin
  if (req.query.download === '1') res.attachment(file.split(/[\\/]/).pop() ?? 'track');
  res.sendFile(file, { dotfiles: 'allow', headers: { 'Cache-Control': 'no-cache' } }, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

apiRouter.get('/library/tracks/:id/cover', async (req, res, next) => {
  const { id } = libraryParams.parse(req.params);
  const cover = await libraryService.coverPath(id);
  if (cover) {
    res.sendFile(cover, { dotfiles: 'allow', maxAge: '7d' }, (err) => {
      if (err && !res.headersSent) next(err);
    });
    return;
  }
  const remote = libraryService.coverUrl(id);
  if (remote?.startsWith('https://')) return res.redirect(302, remote);
  throw new HttpError(404, 'NOT_FOUND', 'Kapak yok');
});

/** Oynatıcı: dosyadaki sözler, yoksa LRCLib */
apiRouter.get('/library/tracks/:id/lyrics', async (req, res) => {
  const { id } = libraryParams.parse(req.params);
  const file = libraryService.filePath(id);
  const track = libraryService.track(id);
  if (!file || !track) throw new HttpError(404, 'NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
  const lyrics = await lyricsService.forFile(file, {
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  });
  res.json({ lyrics });
});

/** Sözleri bulup dosyaya gömer (eski indirmeler için) */
apiRouter.post('/library/tracks/:id/lyrics', async (req, res) => {
  const { id } = libraryParams.parse(req.params);
  const file = libraryService.filePath(id);
  const track = libraryService.track(id);
  if (!file || !track) throw new HttpError(404, 'NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
  const result = await lyricsService.fetchAndEmbed(
    file,
    { title: track.title, artist: track.artist, album: track.album, duration: track.duration },
    { force: true },
  );
  if (result.status === 'embedded') await libraryService.touch(id);
  res.json(result);
});

const lyricsQuery = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(300),
  album: z.string().trim().max(300).optional(),
  duration: z.coerce.number().positive().max(7200).optional(),
});

/** Herhangi bir şarkının sözleri (LRCLib); bulunamazsa { lyrics: null } */
apiRouter.get('/lyrics', async (req, res) => {
  const q = lyricsQuery.parse(req.query);
  res.set('Cache-Control', 'private, max-age=3600');
  res.json({ lyrics: await lyricsService.find(q) });
});

const genreBody = z.object({ genre: z.string().trim().max(60).nullable() });

/** Türü elle düzelt (dosyanın etiketine de yazılır) */
apiRouter.patch('/library/tracks/:id', async (req, res) => {
  const { id } = libraryParams.parse(req.params);
  const { genre } = genreBody.parse(req.body);
  const result = await libraryService.setGenre(id, genre);
  if (!result.ok) throw new HttpError(404, 'NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
  res.json({ track: libraryService.track(id), tagWritten: result.tagWritten });
});

/** Tüm türleri yeniden belirle (arka planda); durum GET ile izlenir */
apiRouter.post('/library/genres/fix', (_req, res) => {
  res.status(202).json(libraryService.startGenreFix());
});

apiRouter.get('/library/genres/fix', (_req, res) => {
  res.json(libraryService.genreFix);
});

/** Kütüphaneden kaldırır ve dosyayı da siler (masaüstünde Geri Dönüşüm Kutusu'na gider) */
apiRouter.delete('/library/tracks/:id', async (req, res) => {
  const { id } = libraryParams.parse(req.params);
  if (!libraryService.track(id)) return res.json({ removed: false });
  await libraryService.deleteFile(id);
  res.json({ removed: true });
});

// --- Kütüphane araçları --------------------------------------------------------

const idList = z.array(z.string().regex(/^[0-9a-f]{16}$/)).max(20000);

/** Sağlık taraması: eksik kapak / söz / tür / yıl / albüm / albüm sanatçısı */
apiRouter.post('/library/health/scan', (_req, res) => {
  res.status(202).json(libraryToolsService.startHealthScan());
});

apiRouter.post('/library/health/fix', (req, res) => {
  const { ids } = z.object({ ids: idList.optional() }).parse(req.body ?? {});
  res.status(202).json(libraryToolsService.startHealthFix(ids));
});

apiRouter.get('/library/health', (_req, res) => {
  res.json(libraryToolsService.healthReport);
});

/** Kopya bulucu */
apiRouter.get('/library/duplicates', async (_req, res) => {
  res.json({ groups: await libraryToolsService.duplicates() });
});

/** Dosyayı sil (masaüstünde Geri Dönüşüm Kutusu'na) */
apiRouter.delete('/library/tracks/:id/file', async (req, res) => {
  const { id } = libraryParams.parse(req.params);
  if (!libraryService.track(id)) throw new HttpError(404, 'NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
  res.json(await libraryService.deleteFile(id));
});

/** Klasör düzeni: önizleme ve uygulama */
const organizeBody = z.object({ template: z.string().trim().min(3).max(200).default(DEFAULT_TEMPLATE) });

apiRouter.post('/library/organize/preview', async (req, res) => {
  const { template } = organizeBody.parse(req.body ?? {});
  const moves = await libraryToolsService.organizePreview(template);
  res.json({ template, moves: moves.slice(0, 500), total: moves.length });
});

apiRouter.post('/library/organize/apply', async (req, res) => {
  const { template } = organizeBody.parse(req.body ?? {});
  res.json(await libraryToolsService.organizeApply(template));
});

/** Etiket düzenleyici (kapak: https adresi ya da data:image/... base64) */
const tagsBody = z.object({
  title: z.string().trim().max(300).optional(),
  artist: z.string().trim().max(300).optional(),
  album: z.string().trim().max(300).optional(),
  albumArtist: z.string().trim().max(300).optional(),
  year: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal('')),
  genre: z.string().trim().max(60).optional(),
  trackNumber: z.coerce.number().int().min(0).max(999).optional(),
  coverUrl: z.string().url().startsWith('https://').max(1000).optional(),
  coverData: z.string().max(15_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/).optional(),
});

apiRouter.patch('/library/tracks/:id/tags', async (req, res) => {
  const { id } = libraryParams.parse(req.params);
  const { coverUrl, coverData, ...fields } = tagsBody.parse(req.body);
  const data = coverData ? Buffer.from(coverData.slice(coverData.indexOf(',') + 1), 'base64') : null;
  const track = await libraryToolsService.editTags(id, fields, coverUrl, data);
  if (!track) throw new HttpError(404, 'NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
  res.json({ track });
});

// --- Liste senkronu --------------------------------------------------------------

const syncParams = z.object({ id: z.string().uuid() });
const syncCreate = z.object({ url: urlField, format: formatField, downloadExisting: z.boolean().default(true) });
const syncPatch = z.object({ enabled: z.boolean().optional(), format: formatField.optional() });

async function syncCall<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SyncError) throw new HttpError(err.code === 'NOT_FOUND' ? 404 : err.code === 'LIMIT' ? 409 : 422, err.code, err.message);
    throw err;
  }
}

apiRouter.get('/sync', (_req, res) => {
  res.json({ playlists: syncService.list() });
});

apiRouter.post('/sync', async (req, res) => {
  const { url, format, downloadExisting } = syncCreate.parse(req.body);
  assertSupported(url);
  res.status(201).json(await syncCall(() => syncService.add(url, format, downloadExisting)));
});

apiRouter.post('/sync/:id/check', async (req, res) => {
  const { id } = syncParams.parse(req.params);
  res.json(await syncCall(() => syncService.check(id)));
});

apiRouter.patch('/sync/:id', async (req, res) => {
  const { id } = syncParams.parse(req.params);
  res.json(await syncCall(() => syncService.update(id, syncPatch.parse(req.body))));
});

apiRouter.delete('/sync/:id', (req, res) => {
  const { id } = syncParams.parse(req.params);
  res.json({ removed: syncService.remove(id) });
});

// --- Çalma listeleri ----------------------------------------------------------

const playlistParams = z.object({ id: z.string().uuid() });
const trackIdList = z.array(z.string().regex(/^[0-9a-f]{16}$/)).max(5000);
const playlistCreate = z.object({ name: z.string().trim().min(1).max(100), trackIds: trackIdList.default([]) });
const playlistPatch = z.object({ name: z.string().trim().min(1).max(100).optional(), trackIds: trackIdList.optional() });

function playlistCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PlaylistError) throw new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message);
    throw err;
  }
}

apiRouter.get('/playlists', (_req, res) => {
  res.json({ playlists: playlistService.list() });
});

apiRouter.post('/playlists', (req, res) => {
  const { name, trackIds } = playlistCreate.parse(req.body);
  res.status(201).json(playlistCall(() => playlistService.create(name, trackIds)));
});

apiRouter.get('/playlists/:id', (req, res) => {
  const { id } = playlistParams.parse(req.params);
  const playlist = playlistService.get(id);
  if (!playlist) throw new HttpError(404, 'NOT_FOUND', 'Çalma listesi bulunamadı');
  res.json(playlist);
});

apiRouter.patch('/playlists/:id', (req, res) => {
  const { id } = playlistParams.parse(req.params);
  res.json(playlistCall(() => playlistService.update(id, playlistPatch.parse(req.body))));
});

apiRouter.post('/playlists/:id/tracks', (req, res) => {
  const { id } = playlistParams.parse(req.params);
  const { trackIds } = z.object({ trackIds: trackIdList.min(1) }).parse(req.body);
  res.json(playlistCall(() => playlistService.add(id, trackIds)));
});

apiRouter.delete('/playlists/:id', (req, res) => {
  const { id } = playlistParams.parse(req.params);
  res.json({ removed: playlistService.remove(id) });
});

/** M3U8 olarak indir (mutlak yollar: bu bilgisayardaki oynatıcılar için) */
apiRouter.get('/playlists/:id/m3u', (req, res) => {
  const { id } = playlistParams.parse(req.params);
  const { name, content } = playlistCall(() => playlistService.toM3u(id));
  res.set('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.attachment(`${name.replace(/[\\/:*?"<>|]+/g, '_') || 'playlist'}.m3u8`);
  res.send(`﻿${content}`);
});

/** Müzik klasörüne kaydet (göreli yollar: klasörü telefona / başka bilgisayara kopyalayınca da çalışır) */
apiRouter.post('/playlists/:id/export', async (req, res) => {
  const { id } = playlistParams.parse(req.params);
  const file = await playlistCall(() => playlistService.exportToLibrary(id));
  res.json({ file });
});

/** Oynatıcı: şarkı ≥30 sn dinlendi (en çok dinlenenler listesi için) */
apiRouter.post('/library/tracks/:id/played', (req, res) => {
  const { id } = libraryParams.parse(req.params);
  res.json({ ok: libraryService.markPlayed(id) });
});

// --- Takip edilen sanatçılar -------------------------------------------------

const followBody = z.object({
  id: z.string().regex(/^[0-9]{1,15}$/),
  name: z.string().trim().min(1).max(200),
  pictureUrl: z.string().url().max(500).nullable().optional(),
});

apiRouter.get('/follows', (_req, res) => {
  res.json({ artists: followService.list() });
});

apiRouter.post('/follows', (req, res) => {
  res.status(201).json(followService.follow(followBody.parse(req.body)));
});

apiRouter.delete('/follows/:id', (req, res) => {
  const { id } = artistParams.parse(req.params);
  res.json({ removed: followService.unfollow(id) });
});

apiRouter.get('/follows/releases', async (_req, res) => {
  res.json({ releases: await followService.releases() });
});

// --- İndirme geçmişi (ana sayfa) --------------------------------------------

apiRouter.get('/history', (req, res) => {
  const { limit, offset } = historyQuery.parse(req.query);
  res.json({ items: historyService.list(limit, offset), total: historyService.size, stats: historyService.stats() });
});

apiRouter.delete('/history/:id', (req, res) => {
  const { id } = historyParams.parse(req.params);
  res.json({ removed: historyService.remove(id) });
});

apiRouter.delete('/history', (_req, res) => {
  historyService.clear();
  res.json({ cleared: true });
});

/** İşin anlık durumu */
apiRouter.get('/download/:id', (req, res) => {
  const { id } = jobParams.parse(req.params);
  res.json(requireJob(id));
});

/** İlerleme akışı (Server-Sent Events) */
apiRouter.get('/download/:id/events', (req, res) => {
  const { id } = jobParams.parse(req.params);
  const initial = requireJob(id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx arkasında tamponlamayı kapatır
  });

  const send = (job: PublicJob) => res.write(`event: progress\ndata: ${JSON.stringify(job)}\n\n`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  const unsubscribe = jobsService.subscribe(id, (job) => {
    send(job);
    if (jobsService.isTerminal(job)) close();
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', close);

  send(initial);
  if (jobsService.isTerminal(initial)) close();
});

/** Tamamlanan dosyayı indir */
apiRouter.get('/download/:id/file', (req, res) => {
  const { id } = jobParams.parse(req.params);
  requireJob(id);
  sendFile(res, id);
});
