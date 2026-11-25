// Loading / error / lost-connection / no-WebGL, in the stall's voice, on the hub's StatusPanel.
import StatusPanel from '@/components/online/StatusPanel.jsx';
import { statusCopy } from './menuModels.js';
import './menus.css';

const GLYPH_SIZE = 44;
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };

/** A proper line icon for a status tile (the 64 px tile used to hold a 10 px text squiggle). `glyph` comes from statusCopy. */
export function StatusGlyph({ glyph, size = GLYPH_SIZE }) {
  const svg = (children) => (
    <svg className="tc-menu-status__glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...stroke}>
      {children}
    </svg>
  );
  if (glyph === 'offline') {
    // Wi-Fi arcs cut by a slash: the line to the table is down
    return svg(<path d="M2.6 9.2A14.6 14.6 0 0 1 21.4 9.2M6 13A9.6 9.6 0 0 1 18 13M9.2 16.7A4.9 4.9 0 0 1 14.8 16.7M12 20.4h.01M4 3.6l16.4 17.2" />);
  }
  if (glyph === 'alert') {
    return svg(<path d="M12 3.2l9.4 16.6H2.6zM12 9.5v4.6M12 17.2h.01" />);
  }
  if (glyph === 'cube') {
    return svg(<path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2zM4 7.2l8 4.4 8-4.4M12 11.6v9.6M4.5 19.5l15-15" />);
  }
  return null;
}

/** Props: { kind: 'loading'|'error'|'disconnected'|'webgl', onRetry, onExit } */
export default function StatusScreen({ kind = 'loading', onRetry, onExit }) {
  const c = statusCopy(kind);
  const actions = [];
  if (c.retry && onRetry) actions.push({ label: c.retry, onClick: onRetry, primary: true });
  if (onExit) actions.push({ label: c.exit, onClick: onExit, primary: !actions.length && !c.busy });
  const icon = c.glyph ? <StatusGlyph glyph={c.glyph} /> : c.icon;
  return (
    <div className={`tc-menu tc-menu-status tc-menu-status--${kind}`}>
      <div className="tc-menu-status__card">
        <StatusPanel icon={icon} tone={c.tone} eyebrow={c.eyebrow} title={c.title} body={c.body} busy={c.busy} actions={actions} />
      </div>
    </div>
  );
}
