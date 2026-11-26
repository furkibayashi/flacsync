import type { TrackSource } from '../types/api';

/** Bu güvenin altındaki eşleşmeler (ISRC ile bulunanlar hariç) kontrol için işaretlenir (sunucuyla aynı) */
export const REVIEW_SCORE = 0.9;

export function needsReview(source: TrackSource | null | undefined): boolean {
  return Boolean(source && !source.reviewed && source.strategy !== 'isrc' && source.score !== null && source.score < REVIEW_SCORE);
}
