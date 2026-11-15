// Collection completed (buy, auction or trade). The LOCAL player gets the full celebration: a ribbon in the collection's
// colour sweeps across the board ("Cyberabad complete!" with a "Rents x1.5" badge and the collection's identity) and a
// pooled confetti burst (<= 54 pieces, none under reduced motion). An opponent completing a set gets a small toast with
// the collection's colour. The same live region also hosts the "X is out" stamp (moments/OutStamp).
// Detected from the animated board ownership, so it lands together with the board animation.
// Mounted inside .hg-boardwrap (over the board); never blocks taps.
import '@/styles/sheets.css';
import { useEffect, useRef, useState } from 'react';
import { buzz } from '@/lib/haptics.js';
import Icon from './ui/Icon.jsx';
import PlayerToken from './ui/PlayerToken.jsx';
import { COLLECTIONS, SET_BONUS_MULT, useStateLike } from './ui/helpers.js';
import MomentBanner from './moments/MomentBanner.jsx';
import Confetti from './moments/Confetti.jsx';
import OutStamp from './moments/OutStamp.jsx';
import { GOLD_PALETTE } from './moments/particles.js';

const MINE_MS = 4800;
const TOAST_MS = 4000;
const X = '×';
const CONFETTI_ORIGIN = [0.5, 0.38];

/** "playerId:groupId" for every complete collection on the board. Pure; exported for tests. */
export function fullSets(state) {
  const out = new Set();
  for (const c of COLLECTIONS) {
    const first = state.owners?.[c.tiles[0]];
    if (first && c.tiles.every((t) => state.owners[t] === first)) out.add(`${first}:${c.id}`);
  }
  return out;
}

/** The headline of the celebration: "Cyberabad complete! Rents ×1.5". Pure; exported for tests. */
export const setHeadline = (set) => `${set.name} complete! Rents ${X}${SET_BONUS_MULT}`;

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
    <div className="hg-celebrate mo-celebrate" role="status" aria-live="polite">
      {banner ? (
        <div key={banner.key} className="mo-celebrate__in">
          <span className="hg-sr">{setHeadline(banner.set)}</span>
          <div className="mo-stage" aria-hidden="true">
            <Confetti kind="burst" count={54} origin={CONFETTI_ORIGIN} colors={[banner.set.color, banner.set.color, ...GOLD_PALETTE]} delay={260} />
          </div>
          <MomentBanner
            tone="set"
            color={banner.set.color}
            kicker="Collection complete"
            title={`${banner.set.name} complete!`}
            sub={banner.set.identity || 'First businesses there now pay more rent.'}
            lead={<span className="mo-rib__lead--icon" aria-hidden="true"><Icon name="spark" size={28} /></span>}
            badge={`Rents ${X}${SET_BONUS_MULT}`}
            life={MINE_MS - 200}
            top="30%"
          />
        </div>
      ) : null}
      {toasts.length ? (
        <ul className="mo-toasts">
          {toasts.map((t) => (
            <li key={t.key} className="mo-toast" style={{ '--sc': t.set.color }}>
              {t.player ? <PlayerToken player={t.player} size={28} ring={false} /> : <i className="mo-toast__sw"><Icon name="spark" size={16} /></i>}
              <span><b>{t.player?.name || 'A rival'}</b> completed <em>{t.set.name}</em></span>
              <i className="mo-toast__sw" aria-hidden="true" style={{ width: 14, height: 14 }} />
            </li>
          ))}
        </ul>
      ) : null}
      <OutStamp session={session} />
    </div>
  );
}
