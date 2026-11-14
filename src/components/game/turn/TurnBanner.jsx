// The turn hand-off. Reads `session.handoff` ({ player, round, isFinal }, set by the presenter while a `turn` event
// plays) or, without it, the displayed turn. Every hand-off is shown once:
//   - my turn:      a short gold "Your turn" banner + sound `turn` + buzz('turn')
//   - other turns:  a subtle name chip ("Ravi's turn")
//   - the first hand-off of the final round adds a "Final round!" moment
// It lives exactly as long as the presenter's hand-off (ANIM_MS.turn, ANIM_MS.finalRound for the final round, at the
// playback speed) and goes as soon as `session.handoff` is cleared, so it never lingers into the next roll.
// Purely visual (aria-hidden); the panel announces turns for screen readers.
import { useEffect, useRef, useState } from 'react';
import { ANIM_MS } from '@shared/timing.js';
import { sfx } from '@/lib/sfx.js';
import { buzz } from '@/lib/haptics.js';
import { useSettings } from '@/lib/storage.js';
import { activePlayer } from '../ui/helpers.js';
import { roundBadgeInfo } from './RoundBadge.jsx';
import '@/styles/turn.css';

/** The hand-off to show: the presenter's, else derived from the display. Pure; exported for tests. */
export function currentHandoff(session) {
  if ((session?.display?.phase ?? session?.view?.phase) === 'over') return null;
  const h = session?.handoff;
  const b = roundBadgeInfo(session);
  const round = Number(session?.display?.round ?? session?.view?.round ?? 1);
  if (h && h.player != null) return { player: String(h.player), round: h.round ?? round, isFinal: h.isFinal ?? b.final };
  const p = activePlayer(session);
  if (!p || p.bankrupt) return null;
  return { player: String(p.id), round, isFinal: b.final };
}

export const handoffKey = (h) => (h ? `${h.player}:${h.round}` : '');

/** How long a hand-off stays up (ms): the presenter's own wait for it, at the playback speed. Pure; exported for tests. */
export function handoffMs(final, speed = 1) {
  const base = final ? ANIM_MS.finalRound : ANIM_MS.turn;
  return Math.round(base / Math.max(0.75, Number(speed) > 0 ? Number(speed) : 1));
}

/**
 * The banner state machine. Pure; exported for tests.
 *   state  = { last, finalShown, shown }   (`shown` = null | { key, mine, final, ms, player })
 *   action = { type: 'handoff', handoff, me, speed } | { type: 'cleared' } | { type: 'expire', key }
 */
export function bannerReducer(state, action) {
  switch (action.type) {
    case 'handoff': {
      const h = action.handoff;
      const key = handoffKey(h);
      if (!h || key === state.last) return state;
      const mine = h.player === String(action.me ?? '');
      const final = !!h.isFinal && !state.finalShown;
      return {
        last: key,
        finalShown: state.finalShown || !!h.isFinal,
        shown: { key, mine, final, ms: handoffMs(final, action.speed), player: h.player },
      };
    }
    case 'cleared': // the presenter finished the hand-off: whatever is up goes now
      return state.shown ? { ...state, shown: null } : state;
    case 'expire':
      return state.shown && state.shown.key === action.key ? { ...state, shown: null } : state;
    default:
      return state;
  }
}

export const BANNER_INIT = Object.freeze({ last: '', finalShown: false, shown: null });

export default function TurnBanner({ session }) {
  const [settings] = useSettings();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;
  const h = currentHandoff(session);
  const key = handoffKey(h);
  const [state, setState] = useState(BANNER_INIT);
  const stateRef = useRef(state);
  stateRef.current = state;
  const me = String(session?.me ?? '');
  const presenting = !!session?.handoff;
  const wasPresenting = useRef(presenting);

  const dispatch = (action) => {
    const next = bannerReducer(stateRef.current, action);
    if (next === stateRef.current) return next;
    stateRef.current = next;
    setState(next);
    return next;
  };

  // the presenter cleared its hand-off -> hide now (never linger into the next roll); runs first so a
  // hand-off that starts in the same commit still shows
  useEffect(() => {
    if (wasPresenting.current && !presenting) dispatch({ type: 'cleared' });
    wasPresenting.current = presenting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting]);

  // a new hand-off -> show it (once per player:round)
  useEffect(() => {
    if (!h) return;
    const before = stateRef.current;
    const next = dispatch({ type: 'handoff', handoff: h, me, speed });
    if (next !== before && next.shown?.mine) {
      try { sfx.play('turn'); } catch { /* optional */ }
      buzz('turn');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // the hide timer is (re-)armed by whatever is shown, so a StrictMode remount cannot strand the banner
  const shown = state.shown;
  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => dispatch({ type: 'expire', key: shown.key }), shown.ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.key, shown?.ms]);

  if (!shown) return null;
  const p = session.display?.players?.find((x) => String(x.id) === shown.player) || session.view?.players?.find((x) => String(x.id) === shown.player);
  const name = p?.name || 'Next player';
  const color = p?.color || 'var(--gold)';
  if (shown.mine || shown.final) {
    return (
      <div
        key={shown.key}
        className={`tb-banner${shown.mine ? ' is-mine' : ''}${shown.final ? ' is-final' : ''}`}
        style={{ '--tb-life': `${shown.ms + 120}ms` }}
        aria-hidden="true"
      >
        {shown.final ? <span className="tb-banner__final">Final round!</span> : null}
        <span className="tb-banner__main" style={{ '--pc': color }}>
          {shown.mine ? 'Your turn' : `${name}'s turn`}
        </span>
      </div>
    );
  }
  return (
    <div key={shown.key} className="tb-chip" style={{ '--pc': color, '--tb-life': `${shown.ms + 120}ms` }} aria-hidden="true">
      <i className="tb-chip__dot" />
      <span>{name}&rsquo;s turn</span>
    </div>
  );
}
