import { useId } from 'react';
import { fmtDay, fmtNum } from './model.js';

/**
 * 14-day bar chart in inline SVG (no library). Bars stretch to the card width; labels are HTML so they never scale.
 * Screen readers get the numbers as a table instead of the picture.
 */
export default function TrendChart({ title, days = [], values = [], approx = false, tone = 'orange' }) {
  const id = useId();
  const n = Math.max(days.length, values.length);
  const vals = Array.from({ length: n }, (_, i) => Math.max(0, Number(values[i]) || 0));
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);
  const last = vals[n - 1] ?? 0;
  const W = 140;
  const H = 60;
  const gap = 2;
  const bw = n ? (W - gap * (n - 1)) / n : 0;
  const top = niceMax(max);

  return (
    <figure className={`adm-chart adm-chart--${tone}`} aria-labelledby={`${id}-t`}>
      <figcaption className="adm-chart__cap">
        <span className="adm-chart__title" id={`${id}-t`}>
          {title}
          {approx ? (
            <span className="adm-chart__approx" title="Counted from each user's last-seen day, so a user active on several days only counts once">
              approx.
            </span>
          ) : null}
        </span>
        <span className="adm-chart__stat">
          <b>{fmtNum(last)}</b> today · {fmtNum(total)} in 14 d
        </span>
      </figcaption>
      <div className="adm-chart__plot" aria-hidden="true">
        <span className="adm-chart__ymax">{fmtNum(top)}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="adm-chart__svg" focusable="false">
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="adm-chart__grid" />
          <line x1="0" x2={W} y1="0.5" y2="0.5" className="adm-chart__grid" />
          {vals.map((v, i) => {
            const h = v ? Math.max(1.2, (v / top) * H) : 0;
            return (
              <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} className={i === n - 1 ? 'adm-chart__bar is-last' : 'adm-chart__bar'}>
                <title>{`${fmtDay(days[i])}: ${fmtNum(v)}`}</title>
              </rect>
            );
          })}
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="adm-chart__base" />
        </svg>
        <span className="adm-chart__x">
          <span>{fmtDay(days[0])}</span>
          <span>{fmtDay(days[Math.floor((n - 1) / 2)])}</span>
          <span>{fmtDay(days[n - 1])}</span>
        </span>
      </div>
      <table className="adm-sr">
        <caption>{`${title}${approx ? ' (approximate)' : ''}, last 14 days`}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {vals.map((v, i) => (
            <tr key={i}>
              <th scope="row">{fmtDay(days[i])}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A round axis maximum: 7 -> 8, 43 -> 50, 1234 -> 1500. */
export function niceMax(v) {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
