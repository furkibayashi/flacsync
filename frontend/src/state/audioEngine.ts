/**
 * Ses motoru.
 *
 * - Önizlemeler (30 sn, başka sitelerden) düz bir <audio> ile çalar: tarayıcı, başka kökenden gelen
 *   sese Web Audio işlemesi uygulamaya izin vermez.
 * - Kütüphanedeki tam şarkılar iki "deck" üzerinden çalar (DJ mikseri gibi). Her deck:
 *     <audio> → kazanç (ses eşitleme + geçiş) → ekolayzer → ana ses → hoparlör
 *   İki deck sayesinde bir sonraki şarkı önceden yüklenir (boşluksuz çalma) ya da biri kısılırken
 *   diğeri açılır (crossfade).
 */

export const EQ_BANDS = [60, 230, 910, 3600, 14000] as const;
export type EqGains = [number, number, number, number, number];

export const EQ_PRESETS: Record<string, EqGains> = {
  flat: [0, 0, 0, 0, 0],
  bass: [6, 3, 0, 0, 0],
  vocal: [-2, -1, 3, 4, 1],
  rock: [4, 1, -2, 2, 4],
  electronic: [5, 2, 0, 2, 4],
  acoustic: [2, 1, 1, 2, 2],
  night: [-3, -1, 1, 1, -3],
};

/** Hedef yükseklik (LUFS); yayın servisleri -14 civarı kullanır */
const TARGET_LUFS = -14;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  /** Ses eşitleme kazancı (doğrusal) */
  norm: number;
}

const toLinear = (db: number) => Math.pow(10, db / 20);

export class AudioEngine {
  readonly preview: HTMLAudioElement;
  private readonly decks: [Deck, Deck];
  private activeDeck = 0;
  /** Şu an kullanılan öğe: önizleme ya da deck'lerden biri */
  active: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private eq: BiquadFilterNode[] = [];
  private master: GainNode | null = null;
  private volume = 0.25;
  private muted = false;
  private eqGains: EqGains = [0, 0, 0, 0, 0];
  normalize = true;

  constructor() {
    const make = () => {
      const el = new Audio();
      el.preload = 'auto';
      return el;
    };
    this.preview = make();
    this.decks = [
      { el: make(), gain: null, norm: 1 },
      { el: make(), gain: null, norm: 1 },
    ];
    this.active = this.preview;
  }

  /** Olay dinleyicileri için tüm öğeler */
  get elements(): HTMLAudioElement[] {
    return [this.preview, this.decks[0].el, this.decks[1].el];
  }

  /** Web Audio grafiği ilk tam şarkıda (kullanıcı etkileşiminden sonra) kurulur */
  private ensureGraph(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.eq = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1;
      f.gain.value = this.eqGains[i]!;
      return f;
    });
    // ekolayzer zinciri → ana ses → çıkış
    this.eq.reduce<AudioNode>((prev, node) => (prev.connect(node), node), this.eq[0]!);
    this.eq[this.eq.length - 1]!.connect(this.master);
    this.master.connect(ctx.destination);
    for (const deck of this.decks) {
      const src = ctx.createMediaElementSource(deck.el);
      deck.gain = ctx.createGain();
      src.connect(deck.gain);
      deck.gain.connect(this.eq[0]!);
    }
    this.applyVolume();
  }

  private applyVolume(): void {
    const v = this.muted ? 0 : this.volume;
    this.preview.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    for (const d of this.decks) d.el.volume = 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  setEq(gains: EqGains): void {
    this.eqGains = gains;
    if (!this.ctx) return;
    this.eq.forEach((f, i) => f.gain.setTargetAtTime(gains[i]!, this.ctx!.currentTime, 0.05));
  }

  setNormalize(on: boolean): void {
    this.normalize = on;
    for (const d of this.decks) this.setDeckGain(d, 1);
  }

  /** Şarkının ölçülen yüksekliğinden kazanç (−12…+6 dB arası) */
  private normFor(loudness: number | null | undefined): number {
    if (!this.normalize || loudness === null || loudness === undefined) return 1;
    return toLinear(Math.max(-12, Math.min(6, TARGET_LUFS - loudness)));
  }

  private setDeckGain(deck: Deck, fade: number, rampSec = 0): void {
    if (!deck.gain || !this.ctx) return;
    const target = deck.norm * fade;
    const t = this.ctx.currentTime;
    deck.gain.gain.cancelScheduledValues(t);
    if (rampSec > 0) {
      deck.gain.gain.setValueAtTime(deck.gain.gain.value, t);
      deck.gain.gain.linearRampToValueAtTime(target, t + rampSec);
    } else deck.gain.gain.setValueAtTime(target, t);
  }

  private sameSrc(el: HTMLAudioElement, src: string): boolean {
    return el.src === new URL(src, window.location.href).href;
  }

  /**
   * Parçayı çalmaya hazırlar ve kullanılacak öğeyi döndürür. `reused`: bu parça crossfade ile
   * zaten çalmaya başlamış ya da önceden yüklenmişti (yeniden yüklenmez).
   */
  load(src: string, kind: 'preview' | 'full', loudness?: number | null): { el: HTMLAudioElement; reused: boolean; started: boolean } {
    if (kind === 'preview') {
      for (const d of this.decks) d.el.pause();
      this.active = this.preview;
      const reused = this.sameSrc(this.preview, src);
      if (!reused) this.preview.src = src;
      return { el: this.preview, reused, started: false };
    }
    this.preview.pause();
    this.ensureGraph();
    const other = this.decks[1 - this.activeDeck]!;
    // Crossfade / boşluksuz için diğer deck'te zaten hazır
    if (this.sameSrc(other.el, src) && this.active !== other.el) {
      const started = !other.el.paused;
      const old = this.decks[this.activeDeck]!;
      if (!started) {
        old.el.pause();
      }
      this.activeDeck = 1 - this.activeDeck;
      this.active = other.el;
      other.norm = this.normFor(loudness);
      if (!started) this.setDeckGain(other, 1);
      return { el: other.el, reused: true, started };
    }
    const deck = this.decks[this.activeDeck]!;
    other.el.pause();
    deck.norm = this.normFor(loudness);
    this.setDeckGain(deck, 1);
    this.active = deck.el;
    const reused = this.sameSrc(deck.el, src);
    if (!reused) deck.el.src = src;
    return { el: deck.el, reused, started: false };
  }

  /** Sıradaki tam şarkıyı diğer deck'e önceden yükler (boşluksuz geçiş için) */
  preload(src: string): void {
    if (!this.ctx) return;
    const other = this.decks[1 - this.activeDeck]!;
    if (this.sameSrc(other.el, src) || !other.el.paused) return;
    other.el.src = src;
    other.el.currentTime = 0;
    other.el.load();
  }

  /** Sıradakini diğer deck'te başlatır; çalan kısılırken yenisi açılır */
  crossfade(src: string, seconds: number, loudness?: number | null): void {
    if (!this.ctx || this.active === this.preview) return;
    const cur = this.decks[this.activeDeck]!;
    const other = this.decks[1 - this.activeDeck]!;
    if (!this.sameSrc(other.el, src)) other.el.src = src;
    other.el.currentTime = 0;
    other.norm = this.normFor(loudness);
    this.setDeckGain(other, 0);
    void other.el.play().catch(() => undefined);
    this.setDeckGain(other, 1, seconds);
    this.setDeckGain(cur, 0, seconds);
    const old = cur.el;
    window.setTimeout(() => {
      if (this.active !== old) old.pause();
    }, seconds * 1000 + 200);
  }

  /** Uyku zamanlayıcı: sesi yavaşça kısıp durdurur */
  fadeOutAndPause(seconds: number): void {
    const el = this.active;
    if (el.paused) return;
    if (el === this.preview || !this.ctx) {
      const start = el.volume;
      const steps = Math.round(seconds * 4);
      let i = 0;
      const t = window.setInterval(() => {
        i++;
        el.volume = Math.max(0, start * (1 - i / steps));
        if (i >= steps) {
          window.clearInterval(t);
          el.pause();
          el.volume = start;
        }
      }, 250);
      return;
    }
    const deck = this.decks[this.activeDeck]!;
    this.setDeckGain(deck, 0, seconds);
    window.setTimeout(() => {
      el.pause();
      this.setDeckGain(deck, 1);
    }, seconds * 1000);
  }

  stopAll(): void {
    for (const el of this.elements) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }
}
