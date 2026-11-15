import HubIcon from '@/platform/game/HubIcon.jsx';
import Ava, { Title } from './Ava.jsx';
import { fmtStat, statValue } from './gameStats.js';

const WORD = ['1st', '2nd', '3rd'];
const RING = ['var(--sl-gold)', 'var(--sl-silver)', 'var(--sl-bronze)'];

/**
 * Top three as a podium. DOM order is 1st, 2nd, 3rd (reading order); CSS places 1st in the middle and raises the
 * blocks in turn. Works with one or two rows too. Rows carry the server's `isMe`, `level`, `frame` and `title`.
 */
export default function Podium({ rows, cols }) {
  const top = rows.slice(0, 3);
  const [main, second] = cols;
  return (
    <ol className={`sl-podium sl-podium--n${top.length}`} aria-label="Top three players">
      {top.map((r, i) => {
        const place = i + 1;
        const me = r.isMe === true;
        return (
          <li
            key={`${r.rank}-${r.name}`}
            className={`sl-slot sl-slot--${place} ${me ? 'is-me' : ''}`}
            style={{ '--i': i }}
            aria-label={`${WORD[i]} place: ${r.name}${me ? ' (you)' : ''}`}
          >
            <span className="sl-slot__crown" aria-hidden="true">
              {place === 1 && <HubIcon name="crown" size={28} />}
            </span>
            <span className="sl-slot__ava">
              <Ava preset={r.avatar} size={place === 1 ? 76 : 58} ring={RING[i]} frame={r.frame} />
            </span>
            <b className="sl-slot__name" title={r.name}>
              <span>{r.name}</span>
            </b>
            <span className="sl-slot__meta">
              {me && <span className="sl-you">You</span>}
              <span className="sl-lv">Lv {r.level ?? 1}</span>
              <Title title={r.title} />
            </span>
            <span className="sl-slot__stat">
              <b>{fmtStat(statValue(r, main.key), main)}</b>
              <small>{main.label.toLowerCase()}</small>
            </span>
            {second && (
              <small className="sl-slot__stat2">
                {fmtStat(statValue(r, second.key), second)} {second.label.toLowerCase()}
              </small>
            )}
            <span className="sl-slot__block" aria-hidden="true">
              <b>{place}</b>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
