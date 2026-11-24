// Tiffin Centre in-game HUD. Props: { session, scene, onMute?, muted?, onRunner? }.
//   session  the SESSION INTERFACE of docs/TIFFIN_CENTRE_PLAN.md section 4 (read through useSession)
//   scene    { pick, project, setHighlight } of the plan's Scene API (all optional-chained: a missing scene only disables the 3D taps)
//   onMute / muted   optional: shows the mute button
//   onRunner(runner) optional: receives the action runner (runner.x(), runner.at(), runner.snapshot(), runner.subscribe(fn))
// Mount it over the canvas in the game route; it is pointer-transparent except for its own controls and a canvas pick layer.
import { useSession } from '../../session/index.js';
import HudLayer from './HudLayer.jsx';

export default function Hud({ session, scene, onMute, muted, onRunner }) {
  const snap = useSession(session);
  if (!session || !snap) return null;
  return (
    <HudLayer
      session={session}
      scene={scene}
      state={snap.state}
      tickAt={snap.tickAt}
      status={snap.status}
      connection={snap.connection}
      onMute={onMute}
      muted={muted}
      onRunner={onRunner}
    />
  );
}
