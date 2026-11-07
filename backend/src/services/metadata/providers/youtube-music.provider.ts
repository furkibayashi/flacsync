import { splitArtistTitle, stripTitleNoise } from '../../matcher/similarity.js';
import { YtDlpError, ytDlpJson, type YtDlpFlatEntry, type YtDlpVideoInfo } from '../../../utils/ytdlp.js';
import { MetadataError } from '../errors.js';
import { cleanString, joinArtists, MAX_COLLECTION_TRACKS, toYear } from '../normalize.js';
import type { Collection, MetadataProvider, ParsedMusicUrl, TrackMetadata } from '../types.js';

/** Kare (albüm kapağı) thumbnail'ı tercih eder, yoksa en büyüğünü alır. */
function pickThumbnail(info: YtDlpVideoInfo): string | null {
  const thumbs = (info.thumbnails ?? []).filter((t) => t.width && t.height);
  const bySize = (a: { width?: number }, b: { width?: number }) => (b.width ?? 0) - (a.width ?? 0);
  const square = thumbs.filter((t) => t.width === t.height).sort(bySize)[0];
  return square?.url ?? [...thumbs].sort(bySize)[0]?.url ?? info.thumbnail ?? null;
}

/**
 * yt-dlp video bilgisini standart metadata'ya çevirir.
 * Resmî "Topic" yüklemelerinde track/artist/album alanları dolu gelir;
 * diğer videolarda "Sanatçı - Şarkı (Official Video)" başlığından ayrıştırılır.
 * Resolver da adayları bu fonksiyonla okur.
 */
export function youTubeInfoToMetadata(info: YtDlpVideoInfo): TrackMetadata {
  const fromTitle = !info.track && info.title ? splitArtistTitle(info.title) : null;
  const channelArtist = cleanString((info.channel ?? info.uploader)?.replace(/\s*-\s*Topic$/i, ''));

  const artist =
    (info.artists?.length ? joinArtists(info.artists) : null) ??
    cleanString(info.artist) ??
    cleanString(info.creator) ??
    fromTitle?.artist ??
    channelArtist ??
    'Unknown Artist';

  const rawTitle = info.track ?? fromTitle?.title ?? info.title ?? 'Unknown Title';

  return {
    // Resmî "track" alanı olduğu gibi kalır; video başlığından gelirse gürültü atılır
    title: info.track ? rawTitle : stripTitleNoise(rawTitle),
    artist,
    album: cleanString(info.album),
    releaseDate: toYear(info.release_year ?? info.release_date),
    coverUrl: pickThumbnail(info),
    isrc: null,
    duration: typeof info.duration === 'number' ? Math.round(info.duration) : null,
    genre: null,
  };
}

interface YtDlpPlaylist {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  playlist_count?: number;
  thumbnails?: { url: string; width?: number; height?: number }[];
  entries?: YtDlpFlatEntry[];
}

/** YouTube / YouTube Music — yt-dlp ile metadata (indirme yapmaz). ISRC yoktur → Deezer'dan tamamlanır. */
export class YouTubeMusicProvider implements MetadataProvider {
  readonly platform = 'youtube-music' as const;

  /** Albüm (OLAK5uy_ / MPREb) veya çalma listesi parçaları. */
  async getCollection(parsed: ParsedMusicUrl): Promise<Collection> {
    if (parsed.type !== 'album' && parsed.type !== 'playlist') {
      throw new MetadataError('UNSUPPORTED_RESOURCE', `YouTube ${parsed.type} desteklenmiyor`, { platform: 'youtube-music' });
    }
    const url = parsed.id.startsWith('MPREb')
      ? `https://music.youtube.com/browse/${parsed.id}`
      : `https://music.youtube.com/playlist?list=${parsed.id}`;

    let info: YtDlpPlaylist;
    try {
      info = await ytDlpJson<YtDlpPlaylist>(url, { flatPlaylist: true, playlistEnd: MAX_COLLECTION_TRACKS }, 90_000);
    } catch (err) {
      const notFound = err instanceof YtDlpError && err.isNotFound;
      throw new MetadataError(notFound ? 'NOT_FOUND' : 'PROVIDER_ERROR', (err as Error).message, {
        platform: 'youtube-music',
        cause: err,
      });
    }

    // YouTube Music albüm listeleri "Album - Başlık" olarak adlandırılır
    const title = (info.title ?? 'YouTube Music').replace(/^Album\s*-\s*/i, '');
    const owner = cleanString((info.channel ?? info.uploader)?.replace(/\s*-\s*Topic$/i, ''));
    const thumbs = [...(info.thumbnails ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    const entries = (info.entries ?? []).filter((e) => e.id && e.title);

    return {
      platform: 'youtube-music',
      type: parsed.type,
      id: parsed.id,
      url,
      title,
      artist: owner,
      coverUrl: thumbs[0]?.url ?? null,
      releaseYear: null,
      totalTracks: info.playlist_count ?? entries.length,
      tracks: entries.map((e, i) => ({
        position: i + 1,
        disc: null,
        title: e.title!,
        artist: cleanString(e.channel?.replace(/\s*-\s*Topic$/i, '')) ?? owner ?? '',
        duration: typeof e.duration === 'number' ? Math.round(e.duration) : null,
        isrc: null,
        previewUrl: null,
        url: `https://music.youtube.com/watch?v=${e.id}`,
      })),
    };
  }

  async getTrack(parsed: ParsedMusicUrl): Promise<TrackMetadata> {
    try {
      const info = await ytDlpJson<YtDlpVideoInfo>(`https://music.youtube.com/watch?v=${parsed.id}`, {
        skipDownload: true,
        noPlaylist: true,
      });
      return youTubeInfoToMetadata(info);
    } catch (err) {
      const notFound = err instanceof YtDlpError && err.isNotFound;
      throw new MetadataError(
        notFound ? 'NOT_FOUND' : 'PROVIDER_ERROR',
        notFound ? `YouTube videosu bulunamadı: ${parsed.id}` : (err as Error).message,
        { platform: 'youtube-music', cause: err },
      );
    }
  }
}
