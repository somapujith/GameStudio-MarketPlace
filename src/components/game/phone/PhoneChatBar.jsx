// A plain chat bar at the very bottom of the phone table:  [chat history]  [ Say hello…        ]  [emoji]  [send]
//   chat icon   a small popover with the latest messages (a dot while there is something new)
//   input       16px text (iOS does not zoom), Enter = send
//   emoji       the six quick reactions (session.sendChat('', id), same 1.5 s cooldown and connection rule as EmoteBar)
// It sits above the on-screen keyboard (--hg-kb / --kb-inset, see styles/phone.css) and never moves the board.
import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { getPlayer } from '../ui/helpers.js';
import { QUICK_EMOTES, emoteInfo } from '../turn/emotes.js';
import VoicePads from '../../voice/VoicePads.jsx';
import VoiceIcon from '../../voice/VoiceIcon.jsx';
import { useVoiceAccess } from '../../voice/useVoiceAccess.js';
import { voiceItem } from '../../voice/voiceModel.js';

export const COOLDOWN_MS = 1500;
const SHOWN = 30;

const Smile = ({ size = 24 }) => (
  <svg className="hg-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M8.2 14.2c.9 1.3 2.1 2 3.8 2s2.9-.7 3.8-2" />
    <path d="M9 9.6v.2M15 9.6v.2" strokeWidth="2.6" />
  </svg>
);

export function Message({ session, message }) {
  const player = getPlayer(session, message.from);
  const em = message.emote ? emoteInfo(message.emote) : null;
  const vo = message.voice ? voiceItem(message.voice) : null;
  return (
    <li className={(em || vo) && !message.text ? 'is-emote' : undefined}>
      <b style={{ color: player?.color }}>{message.from === session.me ? 'You' : player?.name || message.name || 'Player'}</b>
      <span>
        {message.text || null}
        {em ? <span>{message.text ? ' ' : ''}{em.emoji} {em.label}</span> : null}
        {vo ? <span className="vl-line"><VoiceIcon item={vo} size={18} /> {vo.name}</span> : null}
        {!message.text && !em && !vo ? '👋' : null}
      </span>
    </li>
  );
}

export default function PhoneChatBar({ session }) {
  const [text, setText] = useState('');
  const [panel, setPanel] = useState(null); // null | 'emoji' | 'history'
  const [cool, setCool] = useState(false);
  const voice = useVoiceAccess();
  const [seen, setSeen] = useState(() => (session.chat || []).length);
  const timer = useRef(0);
  const root = useRef(null);
  const list = useRef(null);
  const connected = session.connection === 'open';
  const history = session.chat || [];

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (panel === 'history') setSeen(history.length); }, [panel, history.length]);
  useEffect(() => { if (panel === 'history' && list.current) list.current.scrollTop = list.current.scrollHeight; }, [panel, history.length]);

  /* a tap outside or Escape puts the popover away */
  useEffect(() => {
    if (!panel) return undefined;
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setPanel(null); };
    const key = (e) => { if (e.key === 'Escape') setPanel(null); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
    };
  }, [panel]);

  const cooldown = () => {
    setCool(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCool(false), COOLDOWN_MS);
  };
  const submit = (event) => {
    event.preventDefault();
    if (!text.trim() || !connected || cool) return;
    session.sendChat?.(text.trim());
    setText('');
    cooldown();
  };
  const react = (id) => {
    if (!connected || cool) return;
    session.sendChat?.('', id);
    setPanel(null);
    cooldown();
  };
  const toggle = (name) => setPanel((p) => (p === name ? null : name));
  const unread = Math.max(0, history.length - seen);

  return (
    <section className="pcb" ref={root} aria-label="Room chat">
      {panel === 'emoji' ? (
        <div className="pcb-pop pcb-emoji" role="group" aria-label="Quick reactions">
          {QUICK_EMOTES.map((e) => (
            <button key={e.id} type="button" onClick={() => react(e.id)} disabled={!connected || cool} aria-label={`React: ${e.label}`} title={e.label}>
              <span aria-hidden="true">{e.emoji}</span>
            </button>
          ))}
          <div className="vl-phone"><VoicePads session={session} access={voice} variant="phone" /></div>
        </div>
      ) : null}
      {panel === 'history' ? (
        <div className="pcb-pop pcb-history">
          {history.length ? (
            <ol ref={list} role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
              {history.slice(-SHOWN).map((m) => <Message key={m.id} session={session} message={m} />)}
            </ol>
          ) : (
            <p>No messages yet. Say hello!</p>
          )}
        </div>
      ) : null}

      <form className="pcb-bar" onSubmit={submit} data-typing={text.trim() ? '' : undefined}>
        <button type="button" className="pcb-btn" onClick={() => toggle('history')} aria-label="Chat messages" aria-expanded={panel === 'history'}>
          <Icon name="chat" size={24} />
          {unread > 0 ? <i className="pcb-dot" aria-hidden="true" /> : null}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setPanel((p) => (p === 'emoji' ? null : p))}
          maxLength={120}
          placeholder={connected ? 'Say hello…' : 'Reconnecting…'}
          disabled={!connected}
          aria-label="Chat message"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
        />
        <button type="button" className="pcb-btn" onClick={() => toggle('emoji')} aria-label="Quick reactions" aria-expanded={panel === 'emoji'}>
          <Smile size={24} />
        </button>
        <button type="submit" className="pcb-btn pcb-send" disabled={!text.trim() || !connected || cool} aria-label="Send message">
          <Icon name="send" size={24} />
        </button>
      </form>
    </section>
  );
}
