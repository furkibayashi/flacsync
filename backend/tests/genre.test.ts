import { describe, expect, it } from 'vitest';
import { canonicalGenre } from '../src/services/genre.service.js';

describe('canonicalGenre', () => {
  it('aynı türün farklı yazımlarını birleştirir', () => {
    expect(canonicalGenre('Rap/Hip Hop')).toBe('Hip-Hop/Rap');
    expect(canonicalGenre('hip hop')).toBe('Hip-Hop/Rap');
    expect(canonicalGenre('Hip-Hop/Rap')).toBe('Hip-Hop/Rap');
    expect(canonicalGenre('heavy metal')).toBe('Metal');
    expect(canonicalGenre('nwobhm')).toBe('Metal');
    expect(canonicalGenre('Elektronik')).toBe('Electronic');
    expect(canonicalGenre('alternative rock')).toBe('Alternative');
  });

  it('bölgesel iTunes türlerini korur, bilinmeyenleri düzgün büyük harfle yazar', () => {
    expect(canonicalGenre('Turkish Rock')).toBe('Turkish Rock');
    expect(canonicalGenre('turkish pop')).toBe('Turkish Pop');
    expect(canonicalGenre('k-pop')).toBe('K-Pop');
    expect(canonicalGenre('shoegaze')).toBe('Shoegaze');
  });

  it('boş değerlerde null döner', () => {
    expect(canonicalGenre(null)).toBeNull();
    expect(canonicalGenre('   ')).toBeNull();
  });
});
