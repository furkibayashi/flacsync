import { describe, expect, it } from 'vitest';
import {
  normalizeText,
  scoreTrackMatch,
  stripTitleNoise,
  titleSimilarity,
} from '../src/services/matcher/similarity.js';

const opts = { durationToleranceSec: 3 };

describe('stripTitleNoise', () => {
  it.each([
    ['Never Gonna Give You Up (Official Video) (4K Remaster)', 'Never Gonna Give You Up'],
    ['Song [Official Music Video]', 'Song'],
    ['Song (feat. Someone)', 'Song'],
    ['Song - Remastered 2011', 'Song'],
    ['Song (Original Mix)', 'Song'],
    ['Song (Live)', 'Song (Live)'],
  ])('%s → %s', (input, expected) => {
    expect(stripTitleNoise(input)).toBe(expected);
  });
});

describe('normalizeText', () => {
  it('Türkçe karakter ve aksanları sadeleştirir', () => {
    expect(normalizeText('Gülümse Kaderine')).toBe('gulumse kaderine');
    expect(normalizeText('IŞIK ışık')).toBe('isik isik');
  });
});

describe('titleSimilarity', () => {
  it('aynı şarkı, farklı gürültü → 1', () => {
    expect(titleSimilarity('Song (Official Audio)', 'Song - Remastered 2009')).toBe(1);
  });

  it('versiyon eki farklıysa eşleşmez', () => {
    expect(titleSimilarity('Never Gonna Give You Up', 'Never Gonna Give You Up (Pianoforte)')).toBeLessThan(0.6);
    expect(titleSimilarity('Song', 'Song (Live)')).toBeLessThan(0.6);
    expect(titleSimilarity('Song', 'Song - Radio Edit')).toBeLessThan(0.6);
  });
});

describe('scoreTrackMatch', () => {
  const target = { title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 214 };

  it('birebir kayıt yüksek skor alır', () => {
    expect(scoreTrackMatch(target, { ...target, duration: 213 }, opts)).toBeGreaterThan(0.95);
  });

  it('süre toleransı aşılırsa 0', () => {
    expect(scoreTrackMatch(target, { ...target, duration: 347 }, opts)).toBe(0);
  });

  it('farklı sanatçı 0', () => {
    expect(scoreTrackMatch(target, { ...target, artist: 'Oxyy' }, opts)).toBe(0);
  });

  it('farklı versiyon eşik altında kalır', () => {
    const score = scoreTrackMatch(target, { ...target, title: 'Never Gonna Give You Up (Pianoforte)' }, opts);
    expect(score).toBeLessThan(0.75);
  });

  it('çok sanatçılı kayıtlarda ana sanatçı yeterli', () => {
    const score = scoreTrackMatch(
      { title: 'Song', artist: 'A, B', duration: 200 },
      { title: 'Song (feat. B)', artist: 'A', duration: 200 },
      opts,
    );
    expect(score).toBeGreaterThan(0.95);
  });
});
