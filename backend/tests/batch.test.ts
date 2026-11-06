import { describe, expect, it } from 'vitest';
import { buildFileName, buildId3Tags, buildVorbisArgs } from '../src/services/downloader.service.js';
import { folderName } from '../src/services/jobs.service.js';
import type { TrackMetadata } from '../src/services/metadata/types.js';
import type { ResolvedSource } from '../src/services/resolver/types.js';

const meta: TrackMetadata = {
  title: 'Digital Love',
  artist: 'Daft Punk',
  album: 'Discovery',
  releaseDate: '2001',
  coverUrl: null,
  isrc: 'GBDUW0000058',
  duration: 301,
};

const source = {
  videoId: 'abc',
  format: { codec: 'opus', bitrateKbps: 130 },
} as unknown as ResolvedSource;

describe('buildFileName', () => {
  it('tek şarkıda numarasız', () => {
    expect(buildFileName(meta, 'mp3')).toBe('Daft Punk - Digital Love.mp3');
  });

  it('albümde iki haneli parça numarası', () => {
    expect(buildFileName(meta, 'flac', { trackNumber: 3, trackTotal: 14 })).toBe('03 - Daft Punk - Digital Love.flac');
  });

  it('100+ parçalı listede üç hane', () => {
    expect(buildFileName(meta, 'mp3', { trackNumber: 7, trackTotal: 120 })).toBe('007 - Daft Punk - Digital Love.mp3');
  });

  it('dosya sisteminde geçersiz karakterleri temizler', () => {
    expect(buildFileName({ ...meta, title: 'What? / Why: "Now"' }, 'mp3')).not.toMatch(/[?/:"]/);
  });
});

describe('albüm etiketleri', () => {
  const extras = { trackNumber: 3, trackTotal: 14, discNumber: 1, albumArtist: 'Daft Punk' };

  it('ID3: TRCK "3/14", TPOS, TPE2', () => {
    const tags = buildId3Tags(meta, source, null, extras);
    expect(tags.trackNumber).toBe('3/14');
    expect(tags.partOfSet).toBe('1');
    expect(tags.performerInfo).toBe('Daft Punk');
    expect(tags.ISRC).toBe('GBDUW0000058');
  });

  it('ID3: tek şarkıda parça numarası yazılmaz', () => {
    expect(buildId3Tags(meta, source, null).trackNumber).toBeUndefined();
  });

  it('Vorbis: track / TRACKTOTAL / disc / album_artist', () => {
    const args = buildVorbisArgs(meta, source, extras);
    expect(args).toEqual(expect.arrayContaining(['track=3', 'TRACKTOTAL=14', 'disc=1', 'album_artist=Daft Punk']));
  });
});

describe('folderName', () => {
  it('klasör adını dosya sistemi için temizler', () => {
    expect(folderName('AC/DC - Back in Black')).toBe('AC_DC - Back in Black');
    expect(folderName('  ..Gizli.  ')).toBe('Gizli');
    expect(folderName('???')).not.toMatch(/\?/);
  });
});
