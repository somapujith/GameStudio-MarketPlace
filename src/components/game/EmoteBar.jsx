// Table chat: six quick-react buttons (the server's emote whitelist, see turn/emotes.js) above the text composer.
// Reactions are sent as `{t:'chat', emote}` via session.sendChat('', id) and pop up over the sender's avatar (EmoteFloats).
import { useEffect, useRef, useState } from 'react';
import Icon from './ui/Icon.jsx';
import { getPlayer } from './ui/helpers.js';
import { QUICK_EMOTES, emoteInfo } from './turn/emotes.js';
import VoicePads, { VoiceToggle } from '../voice/VoicePads.jsx';
import VoiceIcon from '../voice/VoiceIcon.jsx';
import { useVoiceAccess } from '../voice/useVoiceAccess.js';
import { voiceItem } from '../voice/voiceModel.js';
import '@/styles/chat.css';

const COOLDOWN_MS = 1500;

export default function EmoteBar({ session }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [cool, setCool] = useState(false);
  const [board, setBoard] = useState(false); // the voice-line soundboard (pads) above the reactions
  const voice = useVoiceAccess();
  const root = useRef(null);
  const timer = useRef(null);
  const list = useRef(null);
  const stick = useRef(true);
  const connected = session.connection === 'open';
  const history = session.chat || [];
  useEffect(() => () => clearTimeout(timer.current), []);
  /* a tap outside or Escape puts the soundboard away */
  useEffect(() => {
    if (!board) return undefined;
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setBoard(false); };
    const key = (e) => { if (e.key === 'Escape') setBoard(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
    };
  }, [board]);
  useEffect(() => { if (list.current && stick.current) list.current.scrollTop = list.current.scrollHeight; }, [history.length, open]);

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
    cooldown();
  };

  return (
    <section className="table-chat" aria-label="Room chat" ref={root}>
      {board ? <div className="vl-pop" id="vl-board-pop"><VoicePads session={session} access={voice} variant="bar" /></div> : null}
      <div className="table-chat__reacts" role="group" aria-label="Quick reactions">
        {QUICK_EMOTES.map((e) => (
          <button
            key={e.id}
            type="button"
            className="table-chat__react"
            onClick={() => react(e.id)}
            disabled={!connected || cool}
            aria-label={`React: ${e.label}`}
            title={e.label}
          >
            <span aria-hidden="true">{e.emoji}</span>
          </button>
        ))}
        <VoiceToggle open={board} onClick={() => { setBoard((v) => !v); if (!board && voice.state === 'locked') voice.reload?.(); }} access={voice} popId="vl-board-pop" />
      </div>
      {open && history.length > 0 ? (
        <ol
          ref={list}
          className="table-chat__history"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(event) => { const el = event.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32; }}
        >
          {history.slice(-100).map((message) => {
            const player = getPlayer(session, message.from);
            const em = message.emote ? emoteInfo(message.emote) : null;
            const vo = message.voice ? voiceItem(message.voice) : null;
            return (
              <li key={message.id} className={(em || vo) && !message.text ? 'is-emote' : undefined}>
                <b style={{ color: player?.color }}>{message.from === session.me ? 'You' : player?.name || message.name || 'Player'}</b>
                <span>
                  {message.text || null}
                  {em ? <span className="table-chat__em">{message.text ? ' ' : ''}{em.emoji} {em.label}</span> : null}
                  {vo ? <span className="table-chat__em vl-line"><VoiceIcon item={vo} size={18} /> {vo.name}</span> : null}
                  {!message.text && !em && !vo ? '👋' : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      <form className="table-chat__composer" onSubmit={submit}>
        <button type="button" className="table-chat__toggle" aria-label={open ? 'Hide chat' : 'Show chat'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <Icon name="chat" size={21} />
          {history.length > 0 ? <i aria-hidden="true" /> : null}
        </button>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setOpen(true)}
          maxLength={120}
          placeholder={connected ? 'Salaam, kya haal?' : 'Reconnecting…'}
          disabled={!connected}
          aria-label="Chat message"
          autoComplete="off"
        />
        <button type="submit" className="table-chat__send" disabled={!text.trim() || !connected || cool} aria-label="Send message">
          <Icon name="send" size={21} />
        </button>
      </form>
    </section>
  );
}
