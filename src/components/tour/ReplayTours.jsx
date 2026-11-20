import HubIcon from '@/platform/game/HubIcon.jsx';
import { useToast } from '@/components/shell/Toast.jsx';
import { resetAllTours } from './tourState.js';

/** Profile > Settings: show every first-run tour again (home, game page, lobby, profile and the table). */
export default function ReplayTours() {
  const toast = useToast();
  const replay = () => {
    resetAllTours();
    toast('Tutorials reset. You will see the tips again as you visit each screen.', { tone: 'good' });
  };
  return (
    <section className="hub-panel" aria-labelledby="xp-help-h" data-tour="settings-help">
      <h3 id="xp-help-h" className="hub-section__title">
        <HubIcon name="info" size={18} /> Help
      </h3>
      <div className="xp-set">
        <span className="xp-set__label">
          <b>Replay tutorials</b>
          <small>Show the guided tips again on the home page, game pages, lobby and the table.</small>
        </span>
        <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={replay}>
          <HubIcon name="refresh" size={16} /> Replay
        </button>
      </div>
    </section>
  );
}
