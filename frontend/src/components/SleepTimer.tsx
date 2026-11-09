import clsx from 'clsx';
import { Moon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { usePlayer } from '../state/PlayerProvider';
import { MenuItem, Popover } from './Popover';

const OPTIONS = [15, 30, 45, 60, 90];

/** Kalan dakika (zamanlayıcı yoksa null); her 15 sn'de yenilenir */
function useRemaining(): number | null {
  const { sleepTimer } = usePlayer();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (sleepTimer?.kind !== 'minutes') return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sleepTimer]);
  if (sleepTimer?.kind !== 'minutes') return null;
  return Math.max(1, Math.ceil((sleepTimer.endsAt - now) / 60_000));
}

/** Uyku zamanlayıcı: süre dolunca ses yavaşça kısılıp müzik durur. */
export function SleepTimerButton({ className, side = 'top' }: { className?: string; side?: 'top' | 'bottom' }) {
  const { t } = useI18n();
  const { sleepTimer, setSleepTimer } = usePlayer();
  const remaining = useRemaining();
  const active = sleepTimer !== null;
  const label = !sleepTimer
    ? t('sleep.title')
    : sleepTimer.kind === 'track'
      ? t('sleep.endOfTrackActive')
      : t('sleep.remaining', { min: remaining ?? 0 });

  return (
    <Popover
      side={side}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={label}
          aria-label={label}
          className={clsx(
            'relative grid size-9 place-items-center rounded-full transition hover:bg-raised',
            active ? 'text-amber hover:text-amber-hi' : 'text-dust hover:text-paper',
            className,
          )}
        >
          <Moon className="size-[17px]" />
          {remaining !== null && (
            <span className="absolute -top-0.5 -right-1 rounded-full bg-amber px-1 text-[9px] leading-4 font-bold text-on-accent tabular-nums">
              {remaining}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="px-4 pt-1.5 pb-2 text-xs font-bold tracking-wide text-fade uppercase">{label}</p>
          {OPTIONS.map((min) => (
            <MenuItem
              key={min}
              onClick={() => {
                setSleepTimer(min);
                close();
              }}
            >
              {t('sleep.minutes', { min })}
            </MenuItem>
          ))}
          <MenuItem
            active={sleepTimer?.kind === 'track'}
            onClick={() => {
              setSleepTimer('track');
              close();
            }}
          >
            {t('sleep.endOfTrack')}
          </MenuItem>
          {active && (
            <MenuItem
              icon={<X className="size-4 text-danger" />}
              onClick={() => {
                setSleepTimer(null);
                close();
              }}
            >
              {t('sleep.cancel')}
            </MenuItem>
          )}
        </>
      )}
    </Popover>
  );
}
