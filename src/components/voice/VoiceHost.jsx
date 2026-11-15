// Plays the voice lines of the table and shows who is speaking. Mount once per game screen (GameView, phone and desktop).
//   remote  a `voice` entry in session.chat (useRoomConnection adds it for every `{t:'voice'}` broadcast) = play it now
//   local   my own press (voiceBus) = already playing; the server's echo of it (from === me) is skipped, so a clip sounds once
// Everybody at the table hears it, spectators too, unless "Voice lines" is off in the settings. A clip that cannot play
// (muted, no gesture yet, offline, too many at once) still gets its caption; it never raises an error and never touches the game.
// Speaker marks are fixed overlays on the speaker's pod (`[data-fx-player]`): a caption bubble, a ring and an equaliser, all
// transform / opacity only, gone when the clip ends. No pointer events.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadSettings, useSettings } from '@/lib/storage.js';
import { placeBubble } from '../game/turn/SpeechBubble.jsx';
import { getPlayer } from '../game/ui/helpers.js';
import { clipMs, createSeen, newRemoteVoices, voiceItem } from './voiceModel.js';
import { getVoicePlayer, voiceBus } from './voicePlayer.js';
import { usePrimeVoices } from './useVoiceAccess.js';
import VoiceIcon from './VoiceIcon.jsx';
import '@/styles/voice.css';

const MAX_MARKS = 3;

function anchorRect(id) {
  if (typeof document === 'undefined' || id == null) return null;
  const sel = `[data-fx-player="${String(id).replace(/["\\]/g, '')}"]`;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

function useSpeakerAnchor(playerId) {
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let raf = 0;
    const measure = () => {
      const rect = anchorRect(playerId);
      setPlace({ rect, pos: placeBubble(rect, window.innerWidth, window.innerHeight, 150) });
    };
    measure();
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', later); window.removeEventListener('scroll', later, true); };
  }, [playerId]);
  return place;
}

/** The marks for one speaking player: caption bubble + pod ring + equaliser. */
export function SpeakerMark({ mark, session }) {
  const place = useSpeakerAnchor(mark.from);
  if (!place) return null;
  const { rect, pos } = place;
  const p = getPlayer(session, mark.from);
  const me = String(mark.from) === String(session?.me);
  const name = me ? 'You' : p?.name || 'Player';
  const style = { left: `${pos.left}px`, '--tail': `${pos.tail}px`, '--half': `${pos.half}px`, '--pc': p?.color || 'var(--gold, #f6c453)' };
  if (pos.below) style.top = `${pos.top}px`;
  else style.bottom = `${pos.bottom}px`;
  return (
    <>
      <div className={`vl-bubble${pos.below ? ' is-below' : ''}`} style={style} aria-hidden="true" data-voice-caption={mark.item.id}>
        <VoiceIcon item={mark.item} size={22} />
        <span className="vl-bubble__text">{`${name}: ${mark.item.name}`}</span>
      </div>
      {rect ? (
        <>
          <span className="vl-ring" aria-hidden="true" style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6, '--pc': style['--pc'] }} />
          <span className="vl-eq" aria-hidden="true" style={{ left: rect.right - 20, top: rect.top - 8 }}><i /><i /><i /></span>
        </>
      ) : null}
    </>
  );
}

export default function VoiceHost({ session }) {
  const [settings] = useSettings();
  const [marks, setMarks] = useState([]);
  const seen = useRef(createSeen());
  const timers = useRef(new Map());
  const chat = session?.chat || [];
  const last = chat[chat.length - 1];
  const lastId = useRef(last?.id ?? null); // what was already in the history when the table mounted is not replayed
  const meRef = useRef(session?.me);
  meRef.current = session?.me;
  usePrimeVoices();

  const speak = (from, id) => {
    const item = voiceItem(id);
    if (!item) return;
    getVoicePlayer(loadSettings).play(item, { from });
    const key = `${from}|${id}`;
    clearTimeout(timers.current.get(key));
    setMarks((cur) => [...cur.filter((m) => m.key !== key), { key, from, item }].slice(-MAX_MARKS));
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      setMarks((cur) => cur.filter((m) => m.key !== key));
    }, clipMs(item)));
  };
  const speakRef = useRef(speak);
  speakRef.current = speak;

  // my own press: the clip starts on this device the moment I tap
  useEffect(() => voiceBus.on((ev) => { if (ev && ev.local) speakRef.current(ev.from, ev.id); }), []);

  // everybody else's broadcast
  useEffect(() => {
    if (!last || last.id === lastId.current) return;
    const fresh = newRemoteVoices(chat, lastId.current, meRef.current, seen.current);
    lastId.current = last.id;
    for (const v of fresh) speakRef.current(v.from, v.id); // my own echo is skipped: that clip already played when I tapped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  // "Voice lines" or the global sound switch turned off: silence what is playing
  const audible = settings.voiceLines !== false && settings.sfx !== false;
  useEffect(() => {
    if (!audible) getVoicePlayer(loadSettings).stopAll();
  }, [audible]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    try { getVoicePlayer(loadSettings).stopAll(); } catch { /* ignore */ }
  }, []);

  return marks.map((m) => <SpeakerMark key={m.key} mark={m} session={session} />);
}
