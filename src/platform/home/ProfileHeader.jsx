import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, AVATAR_PRESETS } from '@/components/art/index.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { errorMessage } from '@/lib/api.js';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { fmtNum, radioKeyNav } from '@/components/shell/ui.jsx';
import { useToast } from '@/components/shell/Toast.jsx';
import { useAccount, useDaily } from '@/components/shell/hooks.js';
import { useProfile } from '@/components/shell/stores.js';
import { cleanEquipped } from '@shared/cosmetics.js';
import Ava, { Title } from './Ava.jsx';
import { useCountUp } from './useApi.js';
import { useAccountProgress } from './accountProgress.js';

const MAX_NAME = 20;
const RING = 2 * Math.PI * 47; // circumference of the r=47 level ring (viewBox 100)

/** Avatar inside a ring that fills with the XP progress of the current level, with the level on a tab below. */
function LevelRing({ pct, level, children }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span className="xp-ring" style={{ '--off': `${RING * (1 - p / 100)}` }} data-level={level}>
      <svg className="xp-ring__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r="47" className="xp-ring__track" />
        <circle cx="50" cy="50" r="47" className="xp-ring__fill" strokeDasharray={RING} />
      </svg>
      <span className="xp-ring__ava">{children}</span>
      <span className="xp-ring__lv" aria-hidden="true">
        Lv {level}
      </span>
    </span>
  );
}

/** Today's reward at a glance. The claim button itself lives on Home; this says whether it is waiting. */
function DailyStatus({ daily, signedIn }) {
  const reward = Number(daily.nextReward) || 0;
  const ready = !!daily.canClaim;
  return (
    <div className={`sa-daily ${ready ? 'is-ready' : ''}`.trim()}>
      <span className="sa-daily__icon" aria-hidden="true">
        <HubIcon name="gift" size={20} />
      </span>
      <span className="sa-daily__text">
        <b>{ready ? 'Daily reward is ready' : 'Daily reward claimed'}</b>
        <small>
          {ready
            ? `Claim +${fmtNum(reward)} coins${daily.streak ? ` and keep your ${daily.streak}-day streak` : ''}.`
            : `Come back tomorrow for +${fmtNum(reward)} coins${signedIn ? '' : ' (this device)'}.`}
        </small>
      </span>
      {ready && (
        <Link to={paths.hub()} className="hub-btn hub-btn--primary hub-btn--sm">
          Claim on Home
        </Link>
      )}
    </div>
  );
}

/** Visitors and guests: why signing in matters, one clear action. */
function SaveProgress({ guest }) {
  return (
    <div className="sa-save" role="note">
      <span className="sa-save__icon" aria-hidden="true">
        <HubIcon name="lock" size={20} />
      </span>
      <span className="sa-save__text">
        <b>Save your progress: sign in</b>
        <small>
          {guest
            ? 'A guest keeps level, coins and badges in this browser only. Sign in with Google to keep them on every device, add friends and join the leaderboard.'
            : 'Sign in with Google to keep your level, coins and badges on every device, add friends and join the leaderboard.'}
        </small>
      </span>
      <Link to={paths.login(paths.profile())} className="hub-btn hub-btn--primary hub-btn--sm">
        Sign in
      </Link>
    </div>
  );
}

/** Avatar, name, level / XP bar and coins, with an inline editor for the name and avatar. */
export default function ProfileHeader() {
  const [profile, update] = useProfile();
  const { user, signedIn, guest, account, auth } = useAccount();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const inputId = useId();

  const name = (signedIn && user?.name) || profile.name;
  const avatar = signedIn && user?.avatar != null ? Number(user.avatar) : profile.avatar;
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  // One level for the whole app: the server's when signed in (same number as the top bar), derived only for visitors.
  const li = useAccountProgress();
  const { coins, pct } = li;
  const shownCoins = useCountUp(coins);
  const equipped = cleanEquipped(signedIn ? user?.equipped : null);
  const daily = useDaily();
  const streak = Number(signedIn ? user?.daily?.streak : profile.dailyStreak) || 0;

  // The local profile is the source of truth offline; signed-in players also get it saved on the server.
  const sync = async (patch) => {
    if (!signedIn || typeof auth.updateProfile !== 'function') return;
    try {
      await auth.updateProfile(patch);
    } catch (e) {
      toast(`Saved on this device. ${errorMessage(e, 'Could not sync your profile.')}`, { tone: 'info' });
    }
  };

  const commitName = () => {
    const n = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Guest';
    setDraft(n);
    if (n !== name) {
      update({ name: n });
      sync({ name: n });
    }
  };

  const pick = (id) => {
    if (id === avatar) return;
    update({ avatar: id });
    sync({ avatar: id });
  };

  const current = (AVATAR_PRESETS || []).find((a) => a.id === avatar);
  const status = account ? { text: 'Signed in with Google', tone: 'good', icon: 'check' } : guest ? { text: 'Guest', tone: 'warn', icon: 'user' } : { text: 'Not signed in', tone: '', icon: 'lock' };

  return (
    <section className="hub-panel hh2-pro" aria-labelledby="hh2-pro-h">
      <div className="hh2-pro__top xp-pro__top">
        <LevelRing pct={pct} level={li.level}>
          <Ava preset={avatar} size={80} ring="var(--hub-surface-3)" frame={equipped.frame} dot={account ? 'on' : undefined} />
        </LevelRing>
        <div className="hh2-pro__id">
          <h2 id="hh2-pro-h" className="hh2-pro__name" title={name}>
            {name}
          </h2>
          {equipped.title && <Title title={equipped.title} size="md" className="xp-pro__title" />}
          <p className="xp-pro__xp">
            {li.into >= li.need ? (
              <>
                Ready for <b>level {li.level + 1}</b>
              </>
            ) : (
              <>
                <b>{fmtNum(li.into)}</b> / {fmtNum(li.need)} XP to level {li.level + 1}
              </>
            )}
          </p>
          <div className="sa-xpbar" aria-hidden="true">
            <i style={{ '--k': Math.max(0.02, pct / 100) }} />
          </div>
          <div className="hh2-pro__pills">
            <span className={`hub-pill sa-status sa-status--${status.tone || 'none'}${status.tone === 'good' ? ' hub-pill--good' : ''}`}>
              <HubIcon name={status.icon} size={13} strokeWidth={2.6} />
              {status.text}
            </span>
          </div>
        </div>
        <button
          type="button"
          className={`hub-btn hub-btn--soft hub-btn--sm hh2-pro__edit ${open ? 'is-on' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${inputId}-edit`}
        >
          <HubIcon name={open ? 'check' : 'pencil'} size={16} /> <span className="xp-pro__editlbl">{open ? 'Done' : 'Edit profile'}</span>
        </button>
      </div>
      <div
        className="sr-only"
        role="progressbar"
        aria-label={`Level ${li.level}: experience to the next level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      />

      <div className="xp-pro__stats">
        <div className="hh2-pro__coins xp-pro__coins" aria-label={`${fmtNum(coins)} coins`}>
          <CoinIcon size={26} />
          <span aria-hidden="true">
            <b>{fmtNum(shownCoins)}</b>
            <small>Coins</small>
          </span>
        </div>
        <div className="xp-pro__streak" aria-label={`Daily streak: ${streak} ${streak === 1 ? 'day' : 'days'}`}>
          <HubIcon name="flame" size={22} />
          <span aria-hidden="true">
            <b>{fmtNum(streak)}</b>
            <small>Day streak</small>
          </span>
        </div>
        <Link to={paths.shop()} className="hub-btn hub-btn--primary xp-pro__shop">
          <HubIcon name="gift" size={18} /> Shop
        </Link>
      </div>

      <DailyStatus daily={daily} signedIn={signedIn} />
      {!account && <SaveProgress guest={guest} />}

      <div id={`${inputId}-edit`} className={`hh2-collapse ${open ? 'is-open' : ''}`}>
        <div className="hh2-collapse__inner" inert={!open}>
          <div className="hh2-pro__editor">
            <label className="hh2-field" htmlFor={inputId}>
              <span className="hh2-field__label">Display name</span>
              <input
                id={inputId}
                className="hh2-input"
                value={draft}
                maxLength={MAX_NAME}
                autoComplete="nickname"
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitName();
                    e.currentTarget.blur();
                  }
                }}
              />
            </label>
            <div className="hh2-field">
              <span className="hh2-field__label" id={`${inputId}-av`}>
                Avatar{current ? <b> {'·'} {current.label}</b> : null}
              </span>
              <div className="hh2-avgrid" role="radiogroup" aria-labelledby={`${inputId}-av`} onKeyDown={radioKeyNav}>
                {(AVATAR_PRESETS || []).map((a) => {
                  const on = a.id === avatar;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={a.label}
                      title={a.label}
                      tabIndex={on ? 0 : -1}
                      className={`hh2-avgrid__item ${on ? 'is-on' : ''}`}
                      onClick={() => pick(a.id)}
                    >
                      <Avatar preset={a.id} size={56} />
                      {on && (
                        <span className="hh2-avgrid__tick" aria-hidden="true">
                          <HubIcon name="check" size={12} strokeWidth={3.4} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {!signedIn && <p className="hub-muted">Your name and character are saved on this device.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
