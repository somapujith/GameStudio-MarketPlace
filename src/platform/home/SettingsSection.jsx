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
import { requestMotionPermission, shakeSupported } from '@/lib/shake.js';
import { PLAYBACK_SPEEDS, THEMES } from '@/lib/storage.js';
import { paths } from '@/platform/paths.js';
import * as PUSH from '@/lib/push.js';

const THEME_OPTS = THEMES.map((t) => ({ value: t, label: t === 'system' ? 'System' : t === 'dark' ? 'Dark' : 'Light' }));
const SPEED_OPTS = PLAYBACK_SPEEDS.map((v) => ({ value: v, label: `${v}x` }));
const CAMERA_OPTS = [
  { value: 'auto', label: 'Auto' },
  { value: 'manual', label: 'Pinch only' },
  { value: 'off', label: 'Off' },
];

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
  const [state, setState] = useState(() => (!pushIsSupported() ? 'unsupported' : permission() === 'denied' ? 'denied' : 'off'));

  useEffect(() => {
    let alive = true;
    if (!pushIsSupported()) return undefined;
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
  const { signedIn } = useAccount();
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
    <section id="settings" className="hub-section sa-anchor" aria-labelledby="hh2-settings-h">
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
              <span>Master volume</span>
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
          <div className="hh2-range">
            <label htmlFor="hh2-sfxvolume" className="hh2-range__label">
              <span>Effects</span>
              <b>{Math.round((settings.sfxVolume ?? 1) * 100)}%</b>
            </label>
            <input
              id="hh2-sfxvolume"
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round((settings.sfxVolume ?? 1) * 100)}
              style={{ '--v': `${Math.round((settings.sfxVolume ?? 1) * 100)}%` }}
              onChange={(e) => update({ sfxVolume: Number(e.target.value) / 100 })}
              onPointerUp={() => playSfx('coin')}
              onKeyUp={(e) => (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') && playSfx('coin')}
              data-nosfx
            />
          </div>
          <Toggle
            icon={<Icon name="sparkle" size={20} />}
            label="Night-market ambience"
            hint="A very quiet festival bed under the game board. Off by default."
            checked={!!settings.ambient}
            onChange={(v) => {
              update({ ambient: v });
              playSfx('toggle', { on: v });
            }}
          />
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
          <Toggle
            icon={<Icon name="dice" size={20} />}
            label="Shake to roll"
            hint={shakeSupported() ? 'Shake your phone to roll the die on your turn. Off by default; iPhones ask for motion access.' : 'Needs a phone or tablet with motion sensors.'}
            checked={settings.shakeToRoll === true}
            disabled={!shakeSupported()}
            onChange={async (v) => {
              if (!v) return update({ shakeToRoll: false });
              // iOS only grants motion access from a tap, so ask right here
              const r = await requestMotionPermission();
              if (r === 'granted') return update({ shakeToRoll: true });
              toast(r === 'denied' ? 'Motion access was blocked. Allow it in the browser settings to shake to roll.' : 'This device has no motion sensors.', { tone: 'bad' });
              return undefined;
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
          <div className="xp-set">
            <span className="xp-set__label">
              <b>Board camera on phones</b>
              <small>Auto follows the pawn and zooms in on the tile you land on. Pinch only never moves by itself. Off turns zoom off.</small>
            </span>
            <Segmented
              label="Board camera on phones"
              value={settings.boardCamera || 'auto'}
              onChange={(v) => update({ boardCamera: v })}
              options={CAMERA_OPTS}
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

        <section className="hub-panel" aria-labelledby="xp-push-h">
          <h3 id="xp-push-h" className="hub-section__title">
            <HubIcon name="bell" size={18} /> Notifications
          </h3>
          <PushToggle />
        </section>
      </div>

      {!signedIn && (
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
      )}

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
