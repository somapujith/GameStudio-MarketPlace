import { useEffect, useState } from 'react';
import { BRAND } from '@/platform/brand.js';
import { HubMark } from '@/platform/game/hubArt.jsx';
import { Icon } from './icons.jsx';
import { dismissInstall, installState, promptInstall, shouldOfferInstall, subscribeInstall } from './install.js';
import { useToast } from './Toast.jsx';
import '@/styles/cine/overlays.css';

const SHOW_DELAY_MS = 3500;

/** Share glyph as drawn by iOS Safari (box with an arrow up). */
function IosShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="cj-ov-install__share">
      <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * "Install Jalebi Games" card in the hub shell: from the 2nd visit, when the browser offers installing
 * (`beforeinstallprompt`) or on iOS Safari (Share -> Add to Home Screen hint). Dismissing snoozes it.
 */
export default function InstallPrompt() {
  const toast = useToast();
  const [state, setState] = useState(installState);
  const [ready, setReady] = useState(false);

  useEffect(() => subscribeInstall(() => setState(installState())), []);
  useEffect(() => {
    const t = setTimeout(() => {
      setState(installState());
      setReady(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  if (!ready || !shouldOfferInstall(state)) return null;
  const ios = state.platform === 'ios';

  const install = async () => {
    const r = await promptInstall();
    if (r === 'accepted') toast(`${BRAND.name} is on your home screen`, { tone: 'success' });
    else if (r === 'dismissed') dismissInstall();
  };

  return (
    <aside className="xs-install cj-ov-install" aria-labelledby="xs-install-t">
      <span className="cj-ov-install__mark" aria-hidden="true">
        <HubMark size={30} />
      </span>
      <div className="cj-ov-install__text">
        <b id="xs-install-t">Install {BRAND.short}</b>
        {ios ? (
          <span>
            Tap <IosShare /> <em>Share</em>, then <em>Add to Home Screen</em>.
          </span>
        ) : (
          <span>Full screen, one tap from your home screen.</span>
        )}
      </div>
      {!ios && (
        <button type="button" className="hub-btn hub-btn--sm hub-btn--primary cj-ov-install__go" onClick={install}>
          Install
        </button>
      )}
      <button type="button" className="cj-ov-install__x" aria-label="Not now" onClick={() => dismissInstall()}>
        <Icon name="close" size={16} strokeWidth={2.4} />
      </button>
    </aside>
  );
}
