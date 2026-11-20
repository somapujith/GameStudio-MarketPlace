// "X is out": a brief stamp banner when a player goes bankrupt or resigns (BANKRUPT / FORFEIT stamped on a dark ribbon).
// Detected from the animated board state (display players), so it lands together with the presenter's `bankrupt`
// event and never fires for players who were already out when this screen mounted (a resume). Mounted by
// SetCelebration inside its live region, so the words are spoken once through the same polite status. Never blocks input.
import { useEffect, useRef, useState } from 'react';
import { useStateLike } from '../ui/helpers.js';
import PlayerToken from '../ui/PlayerToken.jsx';
import MomentBanner from './MomentBanner.jsx';
import { newlyOut, outCopy } from './momentsModel.js';

export const OUT_MS = 2800; // the presenter holds a bankruptcy for ANIM_MS.bankrupt (3000)

export default function OutStamp({ session }) {
  const state = useStateLike(session);
  const me = session?.me;
  const prev = useRef(null);
  const seq = useRef(0);
  const [stamp, setStamp] = useState(null); // { key, player, copy }
  const timer = useRef(0);

  useEffect(() => {
    if (state?.phase === 'over') return;
    const { out, now } = newlyOut(state?.players, prev.current, { view: session?.view, me, resigned: session?.resigned });
    const first = prev.current === null;
    prev.current = now;
    if (first || !out.length) return;
    const p = out[out.length - 1];
    const mine = String(p.id) === String(me ?? '');
    clearTimeout(timer.current);
    const key = ++seq.current;
    setStamp({ key, player: p, copy: outCopy(p, mine) });
    timer.current = setTimeout(() => setStamp((s) => (s && s.key === key ? null : s)), OUT_MS + 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.players]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!stamp) return null;
  const { player, copy } = stamp;
  return (
    <>
      <span className="hg-sr">{`${copy.title}. ${copy.sub}.`}</span>
      <MomentBanner
        key={stamp.key}
        tone="out"
        kicker={copy.sub}
        title={copy.title}
        lead={<PlayerToken player={player} size={46} ring={false} />}
        badge={copy.word}
        life={OUT_MS}
        top="36%"
      />
    </>
  );
}
