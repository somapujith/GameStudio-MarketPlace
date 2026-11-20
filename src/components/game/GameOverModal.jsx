// Game over, as a short cinematic (moments/moments.css, "mo-over"): the room dims under a spotlight, the podium rises one
// step at a time (3rd, 2nd, 1st) with each player's avatar dropping in and their net worth counting up, the crown lands
// on the winner, the reason line and your recap tiles (rent earned, districts, upgrades, best moment) slide in, and the
// match highlights follow. The winner gets pooled confetti + fireworks (<= 60 pieces, none under reduced motion); everybody else a
// dignified, calm version of the same screen. Tap anywhere (or "Skip") jumps to the finished screen. Rematch / Back to
// lobby are always there and large (online, the gold button is "Play again with everyone": the same table settings, the
// same friends invited, and an "Add as friends" list of the other players); "Share result" copies a one-line summary. A resigned / bankrupt viewer gets the right
// wording ("You resigned before the end" / "You went bankrupt before the end").
// Everybody's equipped look shows next to their result: frame, title and the dice / trail / board chips (Loadout), read with
// cosmeticsOf so a player who already left keeps theirs; a legendary frame / title / item gives the winner a soft gold rim.
// Accessible: a modal dialog with a focus trap (ui/Sheet), the headline sits in an aria-live region, the animated digits
// are aria-hidden next to a hidden copy of the final number.
import '@/styles/sheets.css';
import { useEffect, useRef, useState } from 'react';
import { compactINR, formatINR } from '@shared/format.js';
import { buzz } from '@/lib/haptics.js';
import { wordsOf } from '@/lib/mapWords.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import PlayerToken, { artPart, cosmeticsOf } from './ui/PlayerToken.jsx';
import { ordinal, useHeld, worthParts } from './ui/helpers.js';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import Loadout, { hasLegendary, loadoutItems } from '@/components/art/Loadout.jsx';
import { compactTarget, targetOf } from './turn/target.js';
import PlayAgain, { PostGameFriends } from '@/components/online/PlayAgain.jsx';
import { gameName, gameOf } from '@/components/online/games.js';
import Confetti from './moments/Confetti.jsx';
import CountUp from './moments/CountUp.jsx';
import { recapTiles, shareText } from './moments/momentsModel.js';
import './moments/moments.css';
import './moments/gameover.css';

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** The "Play again with everyone" button drawn as this game's gold button (PlayAgain brings the logic). */
const renderAgainButton = ({ onClick, label, disabled, busy }) => (
  <Button variant="gold" size="lg" onClick={onClick} disabled={disabled} aria-busy={busy || undefined} icon={<Icon name="refresh" size={20} />}>
    {label}
  </Button>
);

/** How long the cinematic runs before the finished screen is "settled" (ms). Tap / Skip jumps there. */
export const OVER_PLAY_MS = 5200;

/** Why the game ended (result.reason = the engine's winReason; `result.target` = cfg.targetWorth when known). */
export function reasonLine(result) {
  switch (result?.reason) {
    case 'target':
    case 'net_worth': return result.target ? `Reached the ${compactTarget(result.target)} net worth target` : 'Reached the net worth target';
    case 'rounds': return 'Round limit reached: richest wins';
    case 'last_standing': return 'Last player standing';
    default: return '';
  }
}

/** For a viewer who was already out when the game ended: "You resigned before the end" / "You went bankrupt before the end". */
export function outLine(meOut, resigned) {
  if (!meOut) return '';
  return resigned ? 'You resigned before the end' : 'You went bankrupt before the end';
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
  add('chaiSaved', '☕', wordsOf().isDefault ? 'Chai saves' : 'Token saves', compactINR);
  add('propertiesBought', '🏠', 'Most districts bought', String);
  return out;
}

/** Podium timing: when each step rises, in ms after the room opens (3rd first, the winner last). Pure; exported for tests. */
export const stepDelay = (rank) => (rank >= 3 ? 900 : rank === 2 ? 1250 : 1650);

/** The kicker over the headline. Pure; exported for tests. */
export const kickerOf = (won, rank) => (won ? 'Victory' : rank <= 3 ? 'On the podium' : 'Game over');

/** Copy `text` to the clipboard (or hand it to the share sheet on phones). Resolves true when something was shared / copied. */
async function shareOut(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.share && /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent || '')) {
      await navigator.share({ text });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function GameOverModal({ session, onExit }) {
  const result = useHeld(session.result);
  const open = !!session.result;
  const view = session.view;
  const [playing, setPlaying] = useState(true);
  const [skipped, setSkipped] = useState(false);
  const [shared, setShared] = useState('');
  const sharedTimer = useRef(0);

  // a fresh result replays the show; it settles by itself after OVER_PLAY_MS
  useEffect(() => {
    if (!open) return undefined;
    setPlaying(true);
    setSkipped(false);
    const t = setTimeout(() => setPlaying(false), OVER_PLAY_MS);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => () => clearTimeout(sharedTimer.current), []);
  const skip = () => { setSkipped(true); setPlaying(false); };

  let content = null;
  let won = false;
  let share = null;
  if (result) {
    const players = view?.players || [];
    const rows = [...(result.standings || [])]
      .sort((a, b) => a.rank - b.rank)
      .map((r) => {
        const p = players.find((x) => same(x.id, r.id)) || {};
        const parts = view ? worthParts(view, p.id ?? r.id) : null;
        const cos = cosmeticsOf(session, { ...p, id: p.id ?? r.id }) || {};
        return { ...r, color: p.color, piece: p.piece, avatar: r.avatar ?? p.avatar, bankrupt: !!p.bankrupt, parts, cos, frame: cos.frame, title: cos.title, legend: hasLegendary(cos), chips: loadoutItems(cos).length };
      });
    const TitleChip = rows.some((r) => r.title) ? artPart('TitleChip') : null; // looked up by name: a strict art mock may not have it
    const meRow = rows.find((r) => same(r.id, session.me));
    const rank = result.me?.rank ?? meRow?.rank ?? rows.length;
    won = !!(result.me?.won ?? rank === 1);
    const winner = rows.find((r) => same(r.id, result.winner)) || rows[0];
    const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
    const rest = rows.slice(3);
    const reason = reasonLine({ ...result, rounds: result.rounds ?? view?.round, target: targetOf(view?.cfg) });
    const out = outLine(!!players.find((x) => same(x.id, session.me))?.bankrupt, !!session.resigned);
    const moments = matchMoments(players);
    const tiles = recapTiles(view, session.me, moments);
    share = shareText({ won, rank, total: rows.length, winnerName: winner?.name, worth: meRow?.worth, rounds: result.rounds ?? view?.round, reason });

    content = (
      <div className="mo-over-stage" onClick={(e) => { if (playing && !e.target.closest('button,a')) skip(); }}>
        <div className="mo-over-bar">
          <button
            type="button"
            className="mo-over-icon"
            aria-label="Copy my result to share"
            title="Copy my result to share"
            onClick={async () => {
              const ok = await shareOut(share);
              setShared(ok ? 'Result copied' : 'Could not copy');
              clearTimeout(sharedTimer.current);
              sharedTimer.current = setTimeout(() => setShared(''), 2200);
            }}
          >
            <Icon name="send" size={20} />
          </button>
          {playing && !skipped ? <button type="button" className="mo-over-skip" onClick={skip}>Skip</button> : null}
        </div>
        <p className="mo-over-toast" role="status" aria-live="polite">{shared}</p>

        <div className={`mo-over-head${won ? ' is-won' : ''}`} aria-live="polite" aria-atomic="true">
          <p className="mo-over-kicker">{kickerOf(won, rank)}</p>
          {won ? <AutoMascot mood="win" /> : <span className="mo-over-trophy"><Icon name="trophy" size={34} /></span>}
          <h2 className="mo-over-title">{won ? 'You own the city!' : `You finished ${ordinal(rank)}`}</h2>
          {!won && winner ? <p className="mo-over-sub">{winner.name} wins with {formatINR(winner.worth)}</p> : null}
          {reason ? <p className="mo-over-reason">{reason}</p> : null}
          {out ? <p className="mo-over-out">{out}</p> : null}
        </div>

        <ol className={`mo-podium n${podium.length}`} aria-label="Final standings by net worth">
          {podium.map((r) => (
            <li key={r.id} className={`mo-pod p${r.rank}${same(r.id, session.me) ? ' is-me' : ''}${r.rank === 1 && r.legend ? ' is-legend' : ''}`} style={{ '--pc': r.color, '--bd': `${stepDelay(r.rank)}ms`, '--wd': `${stepDelay(r.rank) + 340}ms` }}>
              <span className="mo-pod__who">
                <span className="mo-pod__av">
                  {r.rank === 1 ? <Icon name="crown" size={24} className="mo-pod__crown" /> : null}
                  <PlayerToken player={r} size={r.rank === 1 ? 60 : 48} ring={false} frame={r.frame} />
                </span>
                <b className="mo-pod__name">{r.name}</b>
                {TitleChip && r.title ? <span className="mo-pod__title"><TitleChip title={r.title} size={r.rank === 1 ? 'md' : 'sm'} /></span> : null}
                <Loadout cosmetics={r.cos} variant="row" size={r.rank === 1 ? 24 : 20} />
                <span className="mo-pod__worth"><CountUp value={r.worth} format={compactINR} delay={stepDelay(r.rank) + 420} duration={900} skip={skipped} /></span>
                {r.parts ? (
                  <span className="mo-pod__split" aria-label={`Cash ${formatINR(r.parts.cash)}, districts ${formatINR(r.parts.districts)}, upgrades ${formatINR(r.parts.upgrades)}`}>
                    <i className="is-cash">{compactINR(r.parts.cash)}</i>
                    <i className="is-land">{compactINR(r.parts.districts)}</i>
                    <i className="is-up">{compactINR(r.parts.upgrades)}</i>
                  </span>
                ) : null}
              </span>
              <span className="mo-pod__block"><i>{r.rank}</i></span>
            </li>
          ))}
        </ol>
        <p className="mo-over-legend" aria-hidden="true">
          <span className="is-cash">cash</span><span className="is-land">districts</span><span className="is-up">upgrades</span>
        </p>

        {rest.length ? (
          <ol className="mo-over-rest" start={4}>
            {rest.map((r, i) => (
              <li key={r.id} className={same(r.id, session.me) ? 'is-me' : ''} style={{ '--d': `${2500 + i * 100}ms` }}>
                <span className="mo-over-rank">{r.rank}</span>
                <PlayerToken player={r} size={r.frame ? 34 : 28} frame={r.frame} />
                <span className="lo-rest__who">
                  <b>{r.name}{r.bankrupt ? <small> bankrupt</small> : null}</b>
                  {r.title || r.chips ? (
                    <span className="lo-rest__cos">
                      {TitleChip && r.title ? <TitleChip title={r.title} size="sm" /> : null}
                      <Loadout cosmetics={r.cos} variant="chips" size={16} />
                    </span>
                  ) : null}
                </span>
                <span>{formatINR(r.worth)}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {tiles.length ? (
          <>
            <h3 className="mo-over-h">Your game</h3>
            <ul className="mo-recap">
              {tiles.map((t, i) => (
                <li key={t.key} className={`mo-tile mo-tile--${t.key}`} style={{ '--d': `${2700 + i * 120}ms` }}>
                  <span className="mo-tile__ico" aria-hidden="true">{t.icon}</span>
                  <small>{t.label}</small>
                  <b>{t.value}</b>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {moments.length ? (
          <>
            <h3 className="mo-over-h">Match highlights</h3>
            <ul className="mo-highs">
              {moments.map((m, i) => (
                <li key={m.key} className={`mo-high${same(m.id, session.me) ? ' is-me' : ''}`} style={{ '--pc': m.color, '--d': `${3300 + i * 90}ms` }}>
                  <span className="mo-high__ico" aria-hidden="true">{m.icon}</span>
                  <span className="mo-high__txt">
                    <small>{m.label}</small>
                    <b>{same(m.id, session.me) ? 'You' : m.who} · {m.value}</b>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/* online only: the other people of this match, one tap to add them as friends (hidden for friends, guests and you) */}
        {session.room ? <PostGameFriends players={session.room.players} meId={session.me} /> : null}
      </div>
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
      className={`hg-over mo-over${won ? ' is-won' : ''}${skipped ? ' is-skipped' : ''}${playing ? '' : ' is-done'}`}
      behind={open ? (
        <div className={`mo-over-fx${won ? ' is-won' : ''}`} aria-hidden="true">
          <i className="mo-over-spot" />
          {won ? <Confetti kind="festival" count={60} colors={['#ffe08a', '#ffca7a', '#ff5d73', '#3ddc97', '#4cc9f0', '#b794f6', '#ffffff']} delay={1500} /> : null}
        </div>
      ) : null}
      footer={result ? (
        <div className="mo-over-actions">
          <Button variant="ghost" size="lg" onClick={() => onExit?.()} icon={<Icon name="home" size={20} />}>Back to lobby</Button>
          {session.room ? (
            <PlayAgain room={session.room} gameId={session.room.gameId} game={gameOf(session.room.gameId)} gameLabel={gameName(session.room.gameId)} showSummary={false} variant="over" renderButton={renderAgainButton} />
          ) : (
            <Button variant="gold" size="lg" onClick={() => session.restart?.()} icon={<Icon name="refresh" size={20} />}>
              Rematch
            </Button>
          )}
        </div>
      ) : null}
    >
      {content}
    </Sheet>
  );
}
