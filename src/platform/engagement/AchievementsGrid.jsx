import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAchievements } from '@/lib/api.js';
import { useUserEvents } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useApi, useApiReady } from '@/platform/home/useApi.js';
import { useAccount } from '@/components/shell/hooks.js';
import RewardChips from './RewardChips.jsx';
import { achievementProgress, achievementSummary, dateLabel, groupAchievements } from './engagementModel.js';
import '@/styles/cine/profile.css';

/** One badge: the catalogue icon on a medal (unlocked) or a locked medal with a progress bar, plus its reward. */
export function AchievementCard({ a, avatar, i = 0 }) {
  const prog = achievementProgress(a);
  const barId = `jg-ach-${a.id}-p`;
  return (
    <li className={`cj-pro-ach ${a.unlocked ? 'is-unlocked' : 'is-locked'}`} style={{ '--i': Math.min(i, 10) }}>
      <span className="cj-pro-ach__medal" aria-hidden="true">
        <HubIcon name={a.icon} size={28} strokeWidth={2.2} />
        {!a.unlocked && (
          <span className="cj-pro-ach__lock">
            <HubIcon name="lock" size={12} strokeWidth={2.6} />
          </span>
        )}
      </span>
      <div className="cj-pro-ach__body">
        <h4 className="cj-pro-ach__name">{a.name}</h4>
        <p className="cj-pro-ach__desc">{a.description}</p>
        {a.unlocked ? (
          <p className="cj-pro-ach__date">
            <HubIcon name="check" size={13} strokeWidth={3} />
            <span>
              Unlocked{a.unlockedAt ? <> <time dateTime={a.unlockedAt}>{dateLabel(a.unlockedAt)}</time></> : null}
            </span>
          </p>
        ) : prog ? (
          <div className="cj-pro-ach__prog">
            <span
              className="cj-pro-ach__bar"
              role="progressbar"
              aria-labelledby={barId}
              aria-valuemin={0}
              aria-valuemax={prog.goal}
              aria-valuenow={prog.value}
              aria-valuetext={prog.spoken}
            >
              <i style={{ width: `${prog.pct}%` }} />
            </span>
            <span className="cj-pro-ach__count" id={barId}>
              <span className="sr-only">{a.name} progress: </span>
              {prog.text}
            </span>
          </div>
        ) : null}
        <RewardChips reward={a.reward} avatar={avatar} label={a.unlocked ? `${a.name} reward, collected` : `${a.name} reward`} className={a.unlocked ? 'is-earned' : ''} />
      </div>
    </li>
  );
}

/** Presentational (renders on the server): the summary, then one titled grid per category. */
export function AchievementsView({ data, status = 'ok', signedIn = true, avatar, onRetry }) {
  const groups = useMemo(() => groupAchievements(data?.achievements), [data]);
  const sum = achievementSummary(data);
  const pct = sum.total ? Math.round((sum.unlocked / sum.total) * 100) : 0;
  return (
    <section id="achievements" className="cj-pro-sec cj-pro-achs" aria-labelledby="jg-achs-h">
      <div className="cj-pro-sec__head cj-pro-achs__head">
        <h2 id="jg-achs-h" className="cj-pro-sec__title">
          Achievements
        </h2>
        {status === 'ok' && signedIn && (
          <p className="cj-pro-achs__sum">
            <b>{sum.text}</b>
            <span className="cj-pro-achs__meter" role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={sum.total} aria-valuenow={sum.unlocked} aria-valuetext={sum.text}>
              <i style={{ width: `${pct}%` }} />
            </span>
          </p>
        )}
      </div>
      {!signedIn && (
        <div className="cj-pro-note cj-pro-note--gate cj-pro-achs__gate" role="note">
          <HubIcon name="lock" size={20} />
          <p>Sign in to track your progress, unlock badges and collect their coins and items.</p>
          <Link to={paths.login(paths.profile())} className="cj-btn cj-btn--primary cj-btn--sm">
            Sign in
          </Link>
        </div>
      )}
      {status === 'loading' ? (
        <ul className="cj-pro-ach-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((k) => (
            <li key={k} className="cj-pro-ach cj-pro-ach--skel">
              <span className="cj-pro-skel cj-pro-ach__medal" />
              <span className="cj-pro-skel" style={{ height: 14, width: '60%' }} />
            </li>
          ))}
        </ul>
      ) : status !== 'ok' ? (
        <div className="cj-pro-empty cj-pro-achs__err">
          <p className="cj-pro-empty__title">{status === 'offline' ? 'You are offline' : 'Could not load achievements'}</p>
          <p className="cj-pro-empty__text">Your badges are safe. Try again in a moment.</p>
          {onRetry && (
            <div className="cj-pro-empty__actions">
              <button type="button" className="cj-btn cj-btn--sm" onClick={onRetry}>
                <HubIcon name="refresh" size={16} /> Try again
              </button>
            </div>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.category} className="cj-pro-achs__group">
            <h3 className="cj-pro-achs__cat">
              {g.label}
              {signedIn && (
                <span className="cj-pro-achs__catn" aria-label={`${g.unlocked} of ${g.items.length} unlocked`}>
                  {g.unlocked}/{g.items.length}
                </span>
              )}
            </h3>
            <ul className="cj-pro-ach-grid">
              {g.items.map((a, i) => (
                <AchievementCard key={a.id} a={a} avatar={avatar} i={i} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** Profile section: GET /api/achievements (progress when signed in); reloads when an unlock arrives live. */
export default function AchievementsGrid() {
  const ready = useApiReady();
  const { user, signedIn } = useAccount();
  const res = useApi('/api/achievements', { enabled: ready, fetcher: getAchievements });
  useUserEvents((msg) => {
    // an unlock notification, or an `items` push (a reward item landed): the numbers moved
    if (!msg?.notification || msg.notification.kind === 'achievement') res.reload();
  }, ['notification', 'items']);
  const status = !ready ? 'loading' : res.status === 'idle' ? 'loading' : res.status;
  return <AchievementsView data={res.data} status={status} signedIn={signedIn} avatar={user?.avatar} onRetry={res.reload} />;
}
