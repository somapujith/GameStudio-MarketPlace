import { useEffect, useState } from 'react';
import HubIcon from '@/platform/game/HubIcon.jsx';
import '@/styles/cine/overlays.css';

const BACK_MS = 2600;

const isOnline = () => (typeof navigator === 'undefined' || navigator.onLine !== false);

/**
 * Network state as a glass pill under the floating nav: "You're offline" while `navigator.onLine` is false, then a short
 * "Back online" once it returns. Announced politely (role="status"). Renders nothing while online.
 * The live region itself stays mounted so assistive tech registers the change.
 */
export default function OfflineBanner() {
  const [online, setOnline] = useState(isOnline);
  const [back, setBack] = useState(false);

  useEffect(() => {
    let t = 0;
    const off = () => {
      clearTimeout(t);
      setBack(false);
      setOnline(false);
    };
    const on = () => {
      setOnline(true);
      setBack(true);
      clearTimeout(t);
      t = setTimeout(() => setBack(false), BACK_MS);
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
      clearTimeout(t);
    };
  }, []);

  const show = !online || back;
  return (
    <div className="xs-net cj-ov-net" role="status" aria-live="polite" aria-atomic="true">
      {show && (
        <p className={`cj-ov-net__pill ${online ? 'is-back' : 'is-off'}`}>
          <HubIcon name={online ? 'check' : 'wifiOff'} size={16} strokeWidth={2.4} />
          {online ? 'Back online' : "You're offline. Some things won't update until you reconnect."}
        </p>
      )}
    </div>
  );
}
