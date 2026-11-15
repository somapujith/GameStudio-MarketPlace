// Collection completed (buy, auction or trade). The LOCAL player gets the full celebration: a gold coin shower and
// a card with the collection's identity and the x1.5 bonus. An opponent completing a set gets a small toast.
// Detected from the animated board ownership, so it lands together with the board animation.
// Mounted inside .hg-boardwrap (over the board); never blocks taps.
import '@/styles/sheets.css';
import { useEffect, useRef, useState } from 'react';
import { buzz } from '@/lib/haptics.js';
import Confetti from './ui/Confetti.jsx';
import Icon from './ui/Icon.jsx';
import { COLLECTIONS, SET_BONUS_MULT, useStateLike } from './ui/helpers.js';

const MINE_MS = 4800;
const TOAST_MS = 4000;
const X = '×';

/** "playerId:groupId" for every complete collection on the board. Pure; exported for tests. */
export function fullSets(state) {
  const out = new Set();
  for (const c of COLLECTIONS) {
    const first = state.owners?.[c.tiles[0]];
    if (first && c.tiles.every((t) => state.owners[t] === first)) out.add(`${first}:${c.id}`);
  }
  return out;
}

export default function SetCelebration({ session }) {
  const state = useStateLike(session);
  const me = session.me;
  const prev = useRef(null);
  const timers = useRef([]);
  const [banner, setBanner] = useState(null); // { key, set }
  const [toasts, setToasts] = useState([]); // [{ key, set, player }]

  useEffect(() => {
    const now = fullSets(state);
    if (prev.current === null) { prev.current = now; return; } // first render (resume): no celebration
    const fresh = [...now].filter((k) => !prev.current.has(k));
    prev.current = now;
    for (const k of fresh) {
      const i = k.lastIndexOf(':');
      const pid = k.slice(0, i);
      const set = COLLECTIONS.find((c) => c.id === k.slice(i + 1));
      if (!set) continue;
      const key = `${k}:${Date.now()}`;
      if (pid === me) {
        setBanner({ key, set });
        buzz('earn');
        timers.current.push(setTimeout(() => setBanner((b) => (b?.key === key ? null : b)), MINE_MS));
      } else {
        const player = state.players.find((p) => p.id === pid);
        setToasts((t) => [...t.slice(-1), { key, set, player }]);
        timers.current.push(setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), TOAST_MS));
      }
    }
  }, [state, me]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <div className="hg-celebrate" role="status" aria-live="polite">
      {banner ? (
        <div key={banner.key} className="hg-celebrate-in">
          <Confetti count={30} loop={false} className="hg-coinshower" />
          <div className="hg-celebrate-card hg-setwin" style={{ '--sc': banner.set.color }}>
            <span className="hg-celebrate-ico"><Icon name="spark" size={22} /></span>
            <div>
              <b>{banner.set.name} complete!</b>
              <span>First businesses there now pay {X}{SET_BONUS_MULT} rent.</span>
              {banner.set.identity ? <em>{banner.set.identity}</em> : null}
            </div>
          </div>
        </div>
      ) : null}
      {toasts.length ? (
        <ul className="hg-settoasts">
          {toasts.map((t) => (
            <li key={t.key} className="hg-settoast" style={{ '--sc': t.set.color, '--pc': t.player?.color }}>
              <i className="hg-settoast-dot" aria-hidden="true" />
              <span><b>{t.player?.name || 'A rival'}</b> completed {t.set.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
