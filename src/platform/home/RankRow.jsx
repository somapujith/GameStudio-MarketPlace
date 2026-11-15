import Ava, { Title } from './Ava.jsx';
import { fmtStat, statValue } from './gameStats.js';

/**
 * One leaderboard row (rank 4 and below, or the pinned "You" row). `cols` are the stat definitions shown on the
 * right (phones show the first two); `me` highlights the row (the server's `row.isMe`); `as` lets the pinned row
 * render outside a list.
 */
export default function RankRow({ row, cols, me = row?.isMe === true, as: Tag = 'li', className = '', style }) {
  return (
    <Tag className={`sl-row ${me ? 'is-me' : ''} ${className}`.replace(/\s+/g, ' ').trim()} style={style}>
      <span className="sl-row__rank" aria-label={`Rank ${row.rank ?? 'unranked'}`}>
        {row.rank ?? '—'}
      </span>
      <Ava preset={row.avatar} size={42} frame={row.frame} />
      <span className="sl-row__who">
        <b title={row.name}>
          <span>{row.name}</span>
        </b>
        <span className="sl-row__sub">
          {me && <span className="sl-you">You</span>}
          <span className="sl-lv">Lv {row.level ?? 1}</span>
          <Title title={row.title} />
        </span>
      </span>
      {cols.map((c, i) => (
        <span key={c.key} className={`sl-stat sl-stat--${i}`}>
          <b>{fmtStat(statValue(row, c.key), c)}</b>
          <small>{c.label}</small>
        </span>
      ))}
    </Tag>
  );
}

/** Column captions that line up with the rows (hidden on phones, where each value carries its own label). */
export function RankHead({ cols }) {
  return (
    <div className="sl-colhead" aria-hidden="true">
      <span className="sl-colhead__rank">#</span>
      <span className="sl-colhead__who">Player</span>
      {cols.map((c, i) => (
        <span key={c.key} className={`sl-stat sl-stat--${i}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}
