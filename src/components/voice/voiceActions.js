// A press on a pad: check, send, start the cooldown, and play it for myself AT ONCE (the server's echo of my own
// message is dropped by VoiceHost, so the clip sounds exactly once on my device and as soon as the others get the broadcast).
import { pressGate } from './voiceModel.js';
import { voiceBus, voiceCooldown } from './voicePlayer.js';

/** Returns `{ ok, reason }` (see pressGate); on ok the message is sent and the local clip is on its way. */
export function pressVoice({ session, access, id, now = Date.now() }) {
  const gate = pressGate({
    signedIn: !!access?.signedIn,
    owned: access?.owned,
    id,
    connected: session?.connection === 'open',
    cooldownLeft: voiceCooldown.left(now),
  });
  if (!gate.ok) return gate;
  if (typeof session.sendVoice !== 'function' || session.sendVoice(id) === false) return { ok: false, reason: 'offline' };
  voiceCooldown.start(now);
  voiceBus.emit({ from: session.me, id, local: true });
  return { ok: true, reason: null };
}
