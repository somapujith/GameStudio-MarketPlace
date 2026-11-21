import HubIcon from '@/platform/game/HubIcon.jsx';
import { Preview } from '@/platform/home/Ava.jsx';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { Countdown } from './useNow.jsx';
import { prizeTiers, seasonCountdown, seasonStatusAt, seasonStatusLabel, tierSpoken } from './engagementModel.js';

const compact = (n) => (n >= 100_000 ? `${Number((n / 100_000).toFixed(1))}L` : n >= 10_000 ? `${Number((n / 1000).toFixed(1))}K` : Number(n).toLocaleString('en-IN'));

/**
 * The season's paper card, in the leaderboard's "Your record" spot (same box, so the viewport-fit layout holds): status,
 * a once-a-minute countdown, the season name and its prize tiers (coins and item art; the row scrolls sideways when a
 * season has many tiers, it never grows the page). `season` null = no season at all.
 */
export default function SeasonCard({ season, now = Date.now(), avatar }) {
  if (!season) {
    return (
      <section className="leader-record leader-season leader-season--none" aria-labelledby="lb-season-h">
        <span className="leader-record__eyes" aria-hidden="true">
          <i />
          <i />
        </span>
        <h2 id="lb-season-h">Seasons</h2>
        <p className="leader-season__rules">Points races with prizes: 3 points a win, 1 a game. The next one shows up here.</p>
      </section>
    );
  }
  const status = seasonStatusAt(season, now);
  const cd = seasonCountdown({ ...season, status: season.status === 'paid' ? 'paid' : status }, now);
  const tiers = prizeTiers(season);
  return (
    <section className="leader-record leader-season" aria-labelledby="lb-season-h" data-status={status}>
      <span className="leader-record__eyes" aria-hidden="true">
        <i />
        <i />
      </span>
      <div className="leader-season__head">
        <p className="leader-season__kicker">
          <span className={`leader-season__status leader-season__status--${status}`}>{seasonStatusLabel(status)}</span>
          {cd && <Countdown className="leader-season__count" text={cd.text} spoken={cd.spoken} />}
        </p>
        <h2 id="lb-season-h" title={season.name}>
          {season.name}
        </h2>
      </div>
      {tiers.length > 0 ? (
        <ul className="leader-season__tiers" aria-label="Prizes" tabIndex={tiers.length > 3 ? 0 : undefined}>
          {tiers.map((t) => (
            <li key={t.ranks} className="leader-season__tier" title={tierSpoken(t)}>
              <span className="sr-only">{tierSpoken(t)}</span>
              <b aria-hidden="true">{t.ranks}</b>
              <span className="leader-season__prize" aria-hidden="true">
                {t.coins > 0 && (
                  <span className="leader-season__coins">
                    <CoinIcon size={15} />
                    {compact(t.coins)}
                  </span>
                )}
                {t.item && (
                  <span className={`leader-season__item leader-season__item--${t.item.kind}`}>
                    {t.item.kind === 'title' ? <HubIcon name="crown" size={18} /> : <Preview item={t.item} size={30} avatar={avatar} />}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="leader-season__rules">3 points a win, 1 a game. Bragging rights only this time.</p>
      )}
    </section>
  );
}
