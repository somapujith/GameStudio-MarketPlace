// The info cards beside the garage menu: the live number plate, the performance stat bars and the rear banner board.
import { PLATE_STYLES, find } from '../../gameplay/catalog.js';

export function PlatePreview({ plate }) {
  const style = find(PLATE_STYLES, plate?.style) || PLATE_STYLES[0];
  const text = plate?.text || '';
  const size = text.length > 9 ? 26 : text.length > 7 ? 31 : 36;
  return (
    <div
      className={`aw-ws-plate${style.glow ? ' is-glow' : ''}`}
      style={{ '--p-bg': style.bg, '--p-fg': style.fg, '--p-line': style.border }}
      role="img"
      aria-label={`Number plate ${text}`}
    >
      <span className="aw-ws-plate-ind" aria-hidden="true">IND</span>
      <span className="aw-ws-plate-text" style={{ fontSize: size }}>{text || '-'}</span>
    </div>
  );
}

export function PlateCard({ plate, style }) {
  return (
    <div className="aw-ws-card-body">
      <h3 className="aw-ws-card-title">Your plate</h3>
      <PlatePreview plate={plate} />
      <p className="aw-ws-card-note">{style?.name}</p>
    </div>
  );
}

export function StatsCard({ bars, title }) {
  return (
    <div className="aw-ws-card-body">
      <h3 className="aw-ws-card-title">{title || 'Stats'}</h3>
      <ul className="aw-ws-stats">
        {bars.map((b) => {
          const up = b.nextFrac != null && b.nextFrac > b.frac + 1e-6;
          return (
            <li key={b.id} className="aw-ws-stat">
              <span className="aw-ws-stat-label">{b.label}</span>
              <span className="aw-ws-stat-track" aria-hidden="true">
                <span className="aw-ws-stat-fill" style={{ width: `${b.frac * 100}%` }} />
                {up && <span className="aw-ws-stat-gain" style={{ left: `${b.frac * 100}%`, width: `${(b.nextFrac - b.frac) * 100}%` }} />}
              </span>
              <span className="aw-ws-stat-val">
                {b.text}
                {up && <em className="aw-ws-stat-next"> &rarr; {b.nextText}</em>}
              </span>
              <span className="aw-ws-sr">{b.label} {b.text}{up ? `, after: ${b.nextText}` : ''} {b.unit}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BannerCard({ text, title = 'Roof banner' }) {
  return (
    <div className="aw-ws-card-body">
      <h3 className="aw-ws-card-title">{title}</h3>
      <div className="aw-ws-banner" lang="te">{text || '-'}</div>
    </div>
  );
}
