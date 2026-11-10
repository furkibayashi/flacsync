import clsx from 'clsx';
import type { ComponentType, ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { EQ_BANDS, EQ_PRESETS, type EqGains } from '../state/audioEngine';
import { useCrossfadeSetting, useEqCustomSetting, useEqPresetSetting, useNormalizeSetting } from '../state/settings';
import { RangeSlider } from './PlayerBar';

const PRESET_KEYS = ['flat', 'bass', 'vocal', 'rock', 'electronic', 'acoustic', 'night', 'custom'] as const;
const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** Ayarlar → Ses: ses eşitleme, şarkılar arası geçiş ve 5 bantlı ekolayzer */
type RowProps = { label: string; hint?: string; children: ReactNode };
type ToggleProps = { checked: boolean; onChange: (v: boolean) => void; label: string };

/** Row / Toggle Ayarlar sayfasından gelir (aynı görünüm, döngüsel içe aktarma olmadan) */
export function AudioSettings({ Row, Toggle }: { Row: ComponentType<RowProps>; Toggle: ComponentType<ToggleProps> }) {
  const { t } = useI18n();
  const [normalize, setNormalize] = useNormalizeSetting();
  const [crossfade, setCrossfade] = useCrossfadeSetting();
  const [preset, setPreset] = useEqPresetSetting();
  const [custom, setCustom] = useEqCustomSetting();
  const gains: EqGains = preset === 'custom' ? custom : EQ_PRESETS[preset] ?? EQ_PRESETS.flat!;

  const setBand = (i: number, v: number) => {
    const next = [...gains] as EqGains;
    next[i] = Math.round(v);
    setCustom(next);
    setPreset('custom');
  };

  return (
    <>
      <Row label={t('audio.normalize')} hint={t('audio.normalizeHint')}>
        <Toggle checked={normalize} onChange={setNormalize} label={t('audio.normalize')} />
      </Row>
      <Row label={t('audio.crossfade')} hint={crossfade === 0 ? t('audio.gaplessHint') : t('audio.crossfadeHint')}>
        <div className="flex w-56 items-center gap-3">
          <RangeSlider value={crossfade} max={12} step={1} onChange={(v) => setCrossfade(Math.round(v))} label={t('audio.crossfade')} className="flex-1" />
          <span className="w-14 text-right text-sm text-dust tabular-nums">
            {crossfade === 0 ? t('audio.gapless') : `${crossfade} sn`}
          </span>
        </div>
      </Row>
      <div>
        <p className="font-semibold text-paper">{t('audio.eq')}</p>
        <p className="mt-0.5 mb-3 text-sm text-dust">{t('audio.eqHint')}</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {PRESET_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={preset === k}
              onClick={() => setPreset(k)}
              className={clsx(
                'rounded-full px-3.5 py-1.5 text-sm font-semibold transition',
                preset === k ? 'bg-amber text-on-accent' : 'bg-night/60 text-dust ring-1 ring-rule hover:text-paper',
              )}
            >
              {t(`audio.preset.${k}` as 'audio.preset.flat')}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-3 rounded-xl bg-night/50 p-4 ring-1 ring-rule">
          {EQ_BANDS.map((hz, i) => (
            <div key={hz} className="flex flex-col items-center gap-2">
              <span className="text-xs text-paper tabular-nums">
                {gains[i]! > 0 ? '+' : ''}
                {gains[i]} dB
              </span>
              {/* Dikey kaydırıcı: döndürülmüş yatay */}
              <div className="flex h-32 w-8 items-center justify-center">
                <RangeSlider
                  value={gains[i]! + 12}
                  max={24}
                  step={1}
                  onChange={(v) => setBand(i, v - 12)}
                  label={`${bandLabel(hz)} Hz`}
                  className="w-32 -rotate-90"
                />
              </div>
              <span className="text-xs text-fade tabular-nums">{bandLabel(hz)} Hz</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

