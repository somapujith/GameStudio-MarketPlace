// Tiffin Centre in-game HUD. Props: { session, scene, audio?, onMute?, muted?, onRunner? }.
//   session  the SESSION INTERFACE of docs/TIFFIN_CENTRE_PLAN.md section 4 (read through useSession)
//   scene    the Scene API of docs/TIFFIN_CENTRE_PLAN.md (pick, project, setHighlight, and for first person lookBy, lookAt, getLook, setSpeaking;
//            all optional-chained: a missing scene only disables the 3D taps and the head turning)
//   audio    optional: the audio object (speak(utterance), setSpeechEnabled(bool), isSpeechAvailable(lang)) for customer voices
//   onMute / muted   optional: shows the mute button
//   onRunner(runner) optional: receives the action runner (runner.x(), runner.at(), runner.snapshot(), runner.subscribe(fn))
// Mount it over the canvas in the game route; it is pointer-transparent except for its own controls and a canvas pick layer.
import { useSession } from '../../session/index.js';
import HudLayer from './HudLayer.jsx';

export default function Hud({ session, scene, audio, onMute, muted, onRunner }) {
  const snap = useSession(session);
  if (!session || !snap) return null;
  return (
    <HudLayer
      session={session}
      scene={scene}
      audio={audio}
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
