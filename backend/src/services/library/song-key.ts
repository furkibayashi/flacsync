import { splitArtists, stripTitleNoise } from '../matcher/similarity.js';

const norm = (s: string) =>
  s
    .toLocaleLowerCase('en')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Aynı şarkıyı farklı platformlarda tanımak için anahtar: ilk sanatçı + gürültüsü atılmış başlık.
 * "Sevda Çiçeği (Remastered)" ile "sevda ciceği" ve "mor ve ötesi, X" ile "mor ve ötesi" eşleşir.
 */
export const songKey = (artist: string, title: string): string =>
  `${norm(splitArtists(artist)[0] ?? artist)}|${norm(stripTitleNoise(title))}`;
