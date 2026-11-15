// Game over: winner celebration (gold coin shower + trophy), net-worth podium with each player's cash / districts /
// upgrades split, "moments" chips from the match stats (biggest rent, landlord, most rides, chai saves ...), and
// Home / Play again as before.
import '@/styles/sheets.css';
import { useEffect, useRef } from 'react';
import { compactINR, formatINR } from '@shared/format.js';
import { buzz } from '@/lib/haptics.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import Confetti from './ui/Confetti.jsx';
import PlayerToken, { cosmeticsOf } from './ui/PlayerToken.jsx';
import { ordinal, useHeld, worthParts } from './ui/helpers.js';
import AutoMascot from '@/components/art/AutoMascot.jsx';

const same = (a, b) => a != null && b != null && String(a) === String(b);

export function reasonLine(result) {
  switch (result?.reason) {
    case 'rounds': return result.rounds ? `After ${result.rounds} rounds, the richest hustler wins` : 'Last round played: the richest hustler wins';
    case 'last_standing': return 'Last player standing';
    case 'net_worth': return 'Net worth target reached';
    default: return '';
  }
}

/** Highlights of the match from players' stats: [{ key, icon, label, who, value }] (only stats somebody scored). */
export function matchMoments(players = []) {
  const live = players.filter((p) => p && p.stats);
  const best = (key) => {
    let top = null;
    for (const p of live) {
      const v = Number(p.stats[key]) || 0;
      if (v > 0 && (!top || v > top.v)) top = { p, v };
    }
    return top;
  };
  const out = [];
  const add = (key, icon, label, fmt) => {
    const b = best(key);
    if (b) out.push({ key, icon, label, who: b.p.name, id: b.p.id, color: b.p.color, value: fmt(b.v) });
  };
  add('biggestRent', '💥', 'Biggest rent', formatINR);
  add('rentEarned', '🏦', 'Top landlord', compactINR);
  add('upgrades', '🏗️', 'Master builder', (v) => `${v} upgrade${v === 1 ? '' : 's'}`);
  add('rides', '🛺', 'Most rides', (v) => `${v} ride${v === 1 ? '' : 's'}`);
  add('chaiSaved', '☕', 'Chai saves', compactINR);
  add('propertiesBought', '🏠', 'Most districts bought', String);
  return out;
}

export default function GameOverModal({ session, onExit }) {
  const result = useHeld(session.result);
  const open = !!session.result;
  const view = session.view;

  let content = null;
  let won = false;
  if (result) {
    const players = view?.players || [];
    const rows = [...(result.standings || [])]
      .sort((a, b) => a.rank - b.rank)
      .map((r) => {
        const p = players.find((x) => same(x.id, r.id)) || {};
        const parts = view ? worthParts(view, p.id ?? r.id) : null;
        return { ...r, color: p.color, piece: p.piece, avatar: r.avatar ?? p.avatar, bankrupt: !!p.bankrupt, parts, frame: cosmeticsOf(session, { ...p, id: p.id ?? r.id })?.frame };
      });
    const meRow = rows.find((r) => same(r.id, session.me));
    const rank = result.me?.rank ?? meRow?.rank ?? rows.length;
    won = !!(result.me?.won ?? rank === 1);
    const winner = rows.find((r) => same(r.id, result.winner)) || rows[0];
    const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
    const rest = rows.slice(3);
    const reason = reasonLine({ ...result, rounds: result.rounds ?? view?.round });
    const moments = matchMoments(players);

    content = (
      <>
        <div className={`hg-over-head${won ? ' is-won' : ''}`}>
          {won ? <AutoMascot mood="win" /> : <span className="hg-over-trophy"><Icon name="trophy" size={34} /></span>}
          <h2 className="hg-over-title">{won ? 'You own the city!' : `You finished ${ordinal(rank)}`}</h2>
          {!won && winner ? <p className="hg-over-sub">{winner.name} wins with {formatINR(winner.worth)}</p> : null}
          {reason ? <p className="hg-over-reason">{reason}</p> : null}
        </div>

        <ol className={`hg-podium n${podium.length}`} aria-label="Final standings by net worth">
          {podium.map((r) => (
            <li key={r.id} className={`hg-pod p${r.rank}${same(r.id, session.me) ? ' is-me' : ''}`} style={{ '--pc': r.color }}>
              <span className="hg-pod-av">
                {r.rank === 1 ? <Icon name="crown" size={22} className="hg-pod-crown" /> : null}
                <PlayerToken player={r} size={r.rank === 1 ? 60 : 48} ring={false} frame={r.frame} />
              </span>
              <b className="hg-pod-name">{r.name}</b>
              <span className="hg-pod-worth">{compactINR(r.worth)}</span>
              {r.parts ? (
                <span className="hg-pod-split" aria-label={`Cash ${formatINR(r.parts.cash)}, districts ${formatINR(r.parts.districts)}, upgrades ${formatINR(r.parts.upgrades)}`}>
                  <i className="is-cash">{compactINR(r.parts.cash)}</i>
                  <i className="is-land">{compactINR(r.parts.districts)}</i>
                  <i className="is-up">{compactINR(r.parts.upgrades)}</i>
                </span>
              ) : null}
              <span className="hg-pod-block"><i>{r.rank}</i></span>
            </li>
          ))}
        </ol>
        <p className="hg-over-legend" aria-hidden="true">
          <span className="is-cash">cash</span><span className="is-land">districts</span><span className="is-up">upgrades</span>
        </p>

        {rest.length ? (
          <ol className="hg-over-rest" start={4}>
            {rest.map((r) => (
              <li key={r.id} className={same(r.id, session.me) ? 'is-me' : ''}>
                <span className="hg-over-rank">{r.rank}</span>
                <PlayerToken player={r} size={28} />
                <b>{r.name}{r.bankrupt ? <small> bankrupt</small> : null}</b>
                <span>{formatINR(r.worth)}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {moments.length ? (
          <>
            <h3 className="hg-h3">Moments</h3>
            <ul className="hg-moments">
              {moments.map((m) => (
                <li key={m.key} className={`hg-moment${same(m.id, session.me) ? ' is-me' : ''}`} style={{ '--pc': m.color }}>
                  <span className="hg-moment-ico" aria-hidden="true">{m.icon}</span>
                  <span className="hg-moment-txt">
                    <small>{m.label}</small>
                    <b>{same(m.id, session.me) ? 'You' : m.who} · {m.value}</b>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </>
    );
  }

  // one win buzz per result
  const buzzed = useRef(false);
  useEffect(() => {
    if (open && won && !buzzed.current) { buzzed.current = true; buzz('win'); }
    if (!open) buzzed.current = false;
  }, [open, won]);

  return (
    <Sheet
      open={open}
      dismissible={false}
      variant="dialog"
      ariaLabel="Game over"
      className="hg-over"
      behind={won && open ? <Confetti className="hg-coinshower" /> : null}
      footer={result ? (
        <div className="hg-over-actions">
          <Button variant="ghost" onClick={() => onExit?.()} icon={<Icon name="home" size={20} />}>Home</Button>
          <Button variant="gold" size="lg" onClick={() => session.restart?.()} icon={<Icon name="refresh" size={20} />}>
            Play again
          </Button>
        </div>
      ) : null}
    >
      {content}
    </Sheet>
  );
}
