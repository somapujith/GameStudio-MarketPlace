// The one-time heads-ups for the net worth target: "Sana is at 80% of the ₹50L target", then again at 95%.
//   useTargetWatch(session, say)  watches every player's net worth (as the board shows it, once the table has settled) and, the
//                                 first time somebody reaches 80% and again 95% of the target, says it through the live region
//                                 `say`, shows a short toast and adds a log note. Per player and step it happens once.
//   <TargetToasts toasts />       the toast(s), over the board
// It stays silent on the first look at a table (a reload, a reconnect, a finished game) and when the rule is off.
import { useEffect, useRef, useState } from 'react';
import { useWorths } from '../ui/helpers.js';
import Icon from '../ui/Icon.jsx';
import { alertNote, alertText, mergeLogNotes, targetAlerts, targetOf } from './target.js';
import '@/styles/turn.css';

export const TOAST_MS = 4600;

export function useTargetWatch(session, say) {
  const { worths, state } = useWorths(session);
  const target = targetOf(session?.display?.cfg || session?.view?.cfg);
  const over = (session?.display?.phase ?? session?.view?.phase) === 'over';
  const busy = !!session?.busy;
  const seen = useRef(null);
  const timers = useRef([]);
  const [toasts, setToasts] = useState([]);
  const [notes, setNotes] = useState([]);
  const logRef = useRef(session?.log);
  logRef.current = session?.log;
  const sayRef = useRef(say);
  sayRef.current = say;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!target) {
      seen.current = null;
      return;
    }
    if (busy) return; // let the table finish what it is showing: the worths in between are not real
    if (over) {
      if (seen.current === null) seen.current = {};
      return;
    }
    const { seen: next, alerts } = targetAlerts(seen.current, state.players, worths, target);
    seen.current = next;
    if (!alerts.length) return;
    const log = logRef.current || [];
    const after = log.length ? log[log.length - 1].id ?? null : null;
    const fresh = alerts.map((a) => ({ alert: a, isMe: a.id === session.me }));
    setNotes((n) => [...n, ...alerts.map((a) => alertNote(a, target, session.me, after))]);
    const shown = fresh.map(({ alert, isMe }) => {
      const player = state.players.find((p) => p.id === alert.id);
      return { key: `${alert.id}:${alert.step}`, text: alertText({ ...alert, isMe }, target), color: player?.color, step: alert.step, isMe };
    });
    setToasts(shown.slice(-2)); // a newer heads-up replaces the older toast (the log keeps every line)
    sayRef.current?.(shown[shown.length - 1].text);
    for (const s of shown) {
      timers.current.push(setTimeout(() => setToasts((t) => t.filter((x) => x.key !== s.key)), TOAST_MS));
    }
  }, [worths, state.players, target, over, busy, session.me]);

  // a new game in the same screen (rematch) starts over
  useEffect(() => {
    if (!target) setNotes((n) => (n.length ? [] : n));
  }, [target]);

  return { toasts, notes };
}

/** `session` with the heads-up notes in its log (same object when there is nothing to add). */
export const withNotes = (session, notes) => (notes.length ? { ...session, log: mergeLogNotes(session.log, notes) } : session);

export function TargetToasts({ toasts }) {
  if (!toasts.length) return null;
  return (
    <ul className="tw-toasts" aria-hidden="true">
      {toasts.map((t) => (
        <li key={t.key} className={`tw-toast${t.step >= 95 ? ' is-near' : ''}${t.isMe ? ' is-me' : ''}`} style={{ '--pc': t.color || 'var(--gold)' }}>
          <Icon name="target" size={16} />
          <span>{t.text}</span>
        </li>
      ))}
    </ul>
  );
}
