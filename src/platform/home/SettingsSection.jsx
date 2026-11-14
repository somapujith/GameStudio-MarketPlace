import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Modal from '@/components/shell/Modal.jsx';
import { Icon } from '@/components/shell/icons.jsx';
import { Segmented, Toggle } from '@/components/shell/ui.jsx';
import { useToast } from '@/components/shell/Toast.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import { DEFAULT_PROFILE, useProfile, useSettings } from '@/components/shell/stores.js';
import { playSfx } from '@/components/shell/sound.js';
import { buzz } from '@/lib/haptics.js';
import { PLAYBACK_SPEEDS, THEMES } from '@/lib/storage.js';
import { paths } from '@/platform/paths.js';
import * as PUSH from '@/lib/push.js';

const THEME_OPTS = THEMES.map((t) => ({ value: t, label: t === 'system' ? 'System' : t === 'dark' ? 'Dark' : 'Light' }));
const SPEED_OPTS = PLAYBACK_SPEEDS.map((v) => ({ value: v, label: `${v}x` }));

function pushIsSupported() {
  try {
    return typeof PUSH.pushSupported === 'function' && !!PUSH.pushSupported();
  } catch {
    return false;
  }
}
const permission = () => {
  try {
    return typeof Notification !== 'undefined' ? Notification.permission : 'default';
  } catch {
    return 'default';
  }
};

const PUSH_HINT = {
  on: 'You get a notification when a friend invites you to a table.',
  off: 'Get a notification when a friend invites you, even with the app closed.',
  busy: 'Working on it...',
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then reload this page.',
  unconfigured: 'Notifications are not set up on this server yet.',
  unsupported: 'This browser cannot show notifications. On iPhone, add the app to your home screen first.',
  signedout: 'Sign in to get invite notifications.',
  dismissed: 'Your browser asked and nothing was chosen. Turn this on again to allow notifications.',
  offline: 'You are offline. Try again when you are back online.',
  error: 'Could not turn notifications on. Try again in a moment.',
};

/** Map `enablePush()`'s `{ ok:false, reason }` (unsupported|unconfigured|denied|dismissed|offline|failed) to a row state. */
function pushFailureState(reason, perm = 'default') {
  if (perm === 'denied' || reason === 'denied') return 'denied';
  if (reason === 'unconfigured' || reason === 'unsupported' || reason === 'dismissed' || reason === 'offline') return reason;
  return 'error';
}

/** Notifications row (push invites). Honest states: on, off, blocked by the browser, not configured, signed out. */
function PushToggle() {
  const toast = useToast();
  const { signedIn } = useAccount();
  const [state, setState] = useState(() => (permission() === 'denied' ? 'denied' : 'off'));

  useEffect(() => {
    let alive = true;
    try {
      Promise.resolve(typeof PUSH.pushEnabled === 'function' ? PUSH.pushEnabled() : false).then(
        (on) => alive && setState(on ? 'on' : permission() === 'denied' ? 'denied' : 'off'),
        () => {},
      );
    } catch {
      /* stays off */
    }
    return () => {
      alive = false;
    };
  }, []);

  const shown = !signedIn && state !== 'on' ? 'signedout' : state;
  const change = async (want) => {
    setState('busy');
    try {
      if (want) {
        const r = (await PUSH.enablePush?.()) || { ok: false };
        if (r.ok) {
          setState('on');
          toast('Notifications on', { tone: 'good' });
          return;
        }
        setState(pushFailureState(r.reason, permission()));
      } else {
        const r = (await PUSH.disablePush?.()) || { ok: true };
        if (r.ok === false && r.reason !== 'unsupported') {
          setState('on');
          toast(r.reason === 'offline' ? 'You are offline. Try again later.' : 'Could not turn notifications off. Try again.', { tone: 'bad' });
        } else setState('off');
      }
    } catch {
      setState(want ? 'error' : 'on');
    }
  };

  return (
    <>
      <Toggle
        icon={<HubIcon name="bell" size={20} />}
        label="Invite notifications"
        hint={PUSH_HINT[shown] || PUSH_HINT.off}
        checked={shown === 'on'}
        disabled={['busy', 'signedout', 'unconfigured', 'unsupported', 'denied'].includes(shown)}
        onChange={change}
      />
      {shown === 'signedout' && (
        <Link to={paths.login(paths.profile())} className="hh2-textlink xp-set__link">
          Sign in
        </Link>
      )}
      {(shown === 'error' || shown === 'offline') && (
        <button type="button" className="hub-btn hub-btn--soft hub-btn--sm xp-set__link" onClick={() => change(true)}>
          <HubIcon name="refresh" size={16} /> Try again
        </button>
      )}
    </>
  );
}

/** Profile > Settings: theme, sound + volume, motion, haptics, in-game speed, notifications, reset progress. */
export default function SettingsSection() {
  const toast = useToast();
  const [settings, update] = useSettings();
  const [, updateProfile] = useProfile();
  const [confirmReset, setConfirmReset] = useState(false);
  const volume = Math.round(settings.volume * 100);

  const doReset = () => {
    updateProfile({
      xp: 0,
      level: 1,
      coins: DEFAULT_PROFILE.coins,
      stats: { ...DEFAULT_PROFILE.stats },
      lastDailyClaim: null,
      dailyStreak: 0,
    });
    setConfirmReset(false);
    toast('Progress reset. Fresh start!', { tone: 'good' });
    // Some stores have no reset hook; a reload makes every screen re-read storage.
    setTimeout(() => window.location.assign('/'), 700);
  };

  return (
    <section id="settings" className="hub-section" aria-labelledby="hh2-settings-h">
      <div className="hub-section__head">
        <h2 id="hh2-settings-h" className="hub-section__title">
          Settings
        </h2>
      </div>

      <div className="hh2-setgrid">
        <section className="hub-panel" aria-labelledby="hh2-snd-h">
          <h3 id="hh2-snd-h" className="hub-section__title">
            <HubIcon name="bolt" size={18} /> Sound
          </h3>
          <Toggle
            icon={<Icon name={settings.sfx ? 'volume' : 'volumeOff'} size={20} />}
            label="Sound effects"
            hint="Dice, coins and taps"
            checked={settings.sfx}
            onChange={(v) => {
              update({ sfx: v });
              if (v) setTimeout(() => playSfx('coin'), 80);
            }}
          />
          <div className="hh2-range">
            <label htmlFor="hh2-volume" className="hh2-range__label">
              <span>Volume</span>
              <b>{volume}%</b>
            </label>
            <input
              id="hh2-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              value={volume}
              style={{ '--v': `${volume}%` }}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => playSfx('click')}
              onKeyUp={(e) => (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') && playSfx('click')}
              data-nosfx
            />
          </div>
        </section>

        <section className="hub-panel" aria-labelledby="hh2-motion-h">
          <h3 id="hh2-motion-h" className="hub-section__title">
            <HubIcon name="spark" size={18} /> Motion &amp; feel
          </h3>
          <Toggle
            icon={<Icon name="sparkle" size={20} />}
            label="Reduce motion"
            hint="Calmer animations: no auto-rotating banner, twinkling stars or coin bursts."
            checked={settings.reducedMotion}
            onChange={(v) => update({ reducedMotion: v })}
          />
          <Toggle
            icon={<Icon name="target" size={20} />}
            label="Haptics"
            hint="Short vibrations on your turn and when money moves (phones that support it)."
            checked={settings.haptics !== false}
            onChange={(v) => {
              update({ haptics: v });
              if (v) setTimeout(() => buzz('tap'), 40);
            }}
          />
          <div className="xp-set">
            <span className="xp-set__label">
              <b>In-game animation speed</b>
              <small>Dice, moves and coin flights. Faster keeps turns snappy.</small>
            </span>
            <Segmented
              label="In-game animation speed"
              value={Number(settings.playbackSpeed) || 1}
              onChange={(v) => update({ playbackSpeed: v })}
              options={SPEED_OPTS}
              size="sm"
              className="xp-seg"
            />
          </div>
        </section>

        <section className="hub-panel" aria-labelledby="xp-look-h">
          <h3 id="xp-look-h" className="hub-section__title">
            <HubIcon name="star" size={18} /> Appearance
          </h3>
          <div className="xp-set">
            <span className="xp-set__label">
              <b>Theme</b>
              <small>Game tables always stay dark.</small>
            </span>
            <Segmented label="Theme" value={settings.theme || 'system'} onChange={(v) => update({ theme: v })} options={THEME_OPTS} size="sm" className="xp-seg" />
          </div>
        </section>

        {pushIsSupported() && (
          <section className="hub-panel" aria-labelledby="xp-push-h">
            <h3 id="xp-push-h" className="hub-section__title">
              <HubIcon name="bell" size={18} /> Notifications
            </h3>
            <PushToggle />
          </section>
        )}
      </div>

      <section className="hub-panel hh2-danger" aria-labelledby="hh2-reset-h">
        <div>
          <h3 id="hh2-reset-h" className="hub-section__title">
            <HubIcon name="refresh" size={18} /> Reset progress
          </h3>
          <p className="hub-muted">Clears your XP, level, coins, local stats and daily streak on this device. Settings and your name stay.</p>
        </div>
        <button type="button" className="hub-btn hh2-danger-btn" onClick={() => setConfirmReset(true)}>
          <Icon name="trash" size={18} /> Reset progress
        </button>
      </section>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset all progress?"
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmReset(false)} data-autofocus>
              Cancel
            </button>
            <button type="button" className="btn btn--danger" onClick={doReset}>
              Yes, reset
            </button>
          </>
        }
      >
        <p>This cannot be undone. Your XP, coins, local stats and streak will be cleared on this device.</p>
      </Modal>
    </section>
  );
}
