import HubIcon from '@/platform/game/HubIcon.jsx';
import Ava, { Title } from './Ava.jsx';
import { fmtStat, statValue } from './gameStats.js';

const MEDAL = ['#ffd24d', '#d9deea', '#e09a5b'];

/**
 * Top three as a podium. DOM order is 1st, 2nd, 3rd (reading order); CSS places 1st in the middle.
 * Rows carry the server's `isMe`, `level`, `frame` and `title`.
 */
export default function Podium({ rows, cols }) {
  const top = rows.slice(0, 3);
  const [main, second] = cols;
  return (
    <ol className="hh2-podium xp-podium" aria-label="Top three players">
      {top.map((r, i) => {
        const place = i + 1;
        const me = r.isMe === true;
        return (
          <li
            key={`${r.rank}-${r.name}`}
            className={`hh2-podium__slot hh2-podium__slot--${place} ${me ? 'is-me' : ''}`}
            style={{ '--mc': MEDAL[i], '--i': i }}
            aria-label={`${place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'} place: ${r.name}${me ? ' (you)' : ''}`}
          >
            <span className="hh2-podium__crown" aria-hidden="true">
              {place === 1 && <HubIcon name="crown" size={26} />}
            </span>
            <Ava preset={r.avatar} size={place === 1 ? 72 : 56} ring={MEDAL[i]} frame={r.frame} />
            <b className="hh2-podium__name" title={r.name}>
              <span>{r.name}</span>
            </b>
            <span className="xp-podium__meta">
              {me && <span className="hh2-you">You</span>}
              <Title title={r.title} />
            </span>
            <span className="hh2-podium__stat">
              <b>{fmtStat(statValue(r, main.key), main)}</b> {main.label.toLowerCase()}
            </span>
            {second && (
              <small className="hh2-podium__stat2">
                {fmtStat(statValue(r, second.key), second)} {second.label.toLowerCase()} {'·'} Lv {r.level ?? 1}
              </small>
            )}
            <span className="hh2-podium__block" aria-hidden="true">
              <b>{place}</b>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
