import Ava, { Title } from './Ava.jsx';
import { fmtStat, statValue } from './gameStats.js';

/**
 * One leaderboard row (rank 4 and below, or the pinned "You" row). `cols` are the stat definitions shown on the
 * right; `me` highlights the row (the server's `row.isMe`); `as` lets the pinned row render outside a list.
 */
export default function RankRow({ row, cols, me = row?.isMe === true, as: Tag = 'li', className = '', style }) {
  return (
    <Tag className={`hh2-lb__row xp-row ${me ? 'is-me' : ''} ${className}`.replace(/\s+/g, ' ').trim()} style={style}>
      <span className="hh2-lb__rank" aria-label={`Rank ${row.rank}`}>
        {row.rank ?? '—'}
      </span>
      <Ava preset={row.avatar} size={42} frame={row.frame} />
      <span className="hh2-lb__who">
        <b title={row.name}>
          {row.name}
          {me && <span className="hh2-you">You</span>}
        </b>
        <span className="xp-row__sub">
          <small>Lv {row.level ?? 1}</small>
          <Title title={row.title} />
        </span>
      </span>
      {cols.map((c) => (
        <span key={c.key} className="hh2-lb__stat">
          <b>{fmtStat(statValue(row, c.key), c)}</b>
          <small>{c.label}</small>
        </span>
      ))}
    </Tag>
  );
}
