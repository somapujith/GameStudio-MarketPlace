// Loading / error / lost-connection / no-WebGL, in the stall's voice, on the hub's StatusPanel.
import StatusPanel from '@/components/online/StatusPanel.jsx';
import { statusCopy } from './menuModels.js';
import './menus.css';

/** Props: { kind: 'loading'|'error'|'disconnected'|'webgl', onRetry, onExit } */
export default function StatusScreen({ kind = 'loading', onRetry, onExit }) {
  const c = statusCopy(kind);
  const actions = [];
  if (c.retry && onRetry) actions.push({ label: c.retry, onClick: onRetry, primary: true });
  if (onExit) actions.push({ label: c.exit, onClick: onExit, primary: !actions.length && !c.busy });
  return (
    <div className={`tc-menu tc-menu-status tc-menu-status--${kind}`}>
      <div className="tc-menu-status__card">
        <StatusPanel icon={c.icon} tone={c.tone} eyebrow={c.eyebrow} title={c.title} body={c.body} busy={c.busy} actions={actions} />
      </div>
    </div>
  );
}
