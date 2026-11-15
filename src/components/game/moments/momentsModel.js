// Pure helpers for the key moments (card reveal, turn banner, set celebration, "X is out", game over). No React here, so
// every rule is unit-tested (moments.test.js).
import { TILES } from '@shared/board.js';
import { SNATCH_CAP_PAYOUT, cardById } from '@shared/cards.js';
import { compactINR, formatINR } from '@shared/format.js';

const same = (a, b) => a != null && b != null && String(a) === String(b);
const money = (n) => formatINR(Math.abs(Number(n) || 0));
const X = '×';

/**
 * The one-line effect of a card as a coloured chip: { tone: 'up'|'down'|'snatch'|'move'|'info', label }.
 * Read from the rules (`cardId`), else from the first rupee amount in the text, else null (nothing to highlight).
 * 'up' is green, 'down' is red, 'snatch' is the gold bolt, 'move' is a neutral violet. The sign is part of the label,
 * so the chip never relies on colour alone.
 */
export function cardEffect(card) {
  if (!card) return null;
  const def = card.cardId ? cardById(card.cardId) : null;
  const e = def?.effect;
  if (e) {
    switch (e.type) {
      case 'cash':
        return e.amount >= 0 ? { tone: 'up', label: `+${money(e.amount)}` } : { tone: 'down', label: `−${money(e.amount)}` };
      case 'collectFromAll': return { tone: 'up', label: `+${money(e.amount)} from each player` };
      case 'payAll': return { tone: 'down', label: `−${money(e.amount)} to each player` };
      case 'perLevel': return { tone: 'down', label: `−${money(e.amount)} per upgrade` };
      case 'perProperty': return { tone: 'down', label: `−${money(e.amount)} per district` };
      case 'snatch':
        return card.capped
          ? { tone: 'up', label: `+${money(SNATCH_CAP_PAYOUT)} instead (Snatch limit)` }
          : { tone: 'snatch', label: `+${e.amount > 1 ? `${e.amount} ` : '1 '}Snatch button${e.amount > 1 ? 's' : ''}`, bolt: true };
      case 'chai': return { tone: 'up', label: '+1 Chai token' };
      case 'rentBoost': return { tone: 'up', label: `Your rents ${X}${e.mult} until your next turn` };
      case 'stuck': return { tone: 'down', label: 'Stuck in traffic' };
      case 'nextTransport': return { tone: 'move', label: 'Ride to the next stop' };
      case 'moveTo': return { tone: 'move', label: `Go to ${TILES[e.tile]?.name || 'a new tile'}` };
      case 'moveBy': return { tone: 'move', label: e.n >= 0 ? `Move ${e.n} ahead` : `Move ${Math.abs(e.n)} back` };
      default: break;
    }
  }
  const m = /₹\s?[\d,]+/.exec(`${card.text || ''}`);
  if (m && (card.kind === 'good' || card.kind === 'bad')) {
    return card.kind === 'good' ? { tone: 'up', label: `+${m[0].replace(/\s/g, '')}` } : { tone: 'down', label: `−${m[0].replace(/\s/g, '')}` };
  }
  return null;
}

/** Where the card should travel when it leaves: the pod / strip of the player it affects (the drawer). */
export const cardTargetPlayer = (card) => (card && card.player != null ? card.player : null);

/**
 * A "Six! Roll again!" ribbon: show it once each time a roll of six hands the SAME player another roll, never on resume.
 * `armed` is the one bit of state the component keeps: true while a roll can still be announced.
 * -> { show, armed }
 */
export function sixStep({ armed, extraRoll, busy }) {
  if (busy) return { show: false, armed: true }; // a roll is being played out: the next quiet moment may announce it
  if (extraRoll && armed) return { show: true, armed: false };
  if (!extraRoll) return { show: false, armed: true };
  return { show: false, armed };
}

/** The ribbon copy for a six. -> { kicker, title } */
export function sixCopy(mine, name) {
  return mine ? { kicker: 'You rolled a six', title: 'Roll again!' } : { kicker: `${name || 'A player'} rolled a six`, title: 'Rolls again!' };
}

/** Which players went out since `prev` (a Set of ids that were already out). -> { out: [{ id, name, color, resigned }], now: Set } */
export function newlyOut(players, prev, { view, me, resigned } = {}) {
  const now = new Set();
  const out = [];
  for (const p of players || []) {
    if (!p?.bankrupt) continue;
    const id = String(p.id);
    now.add(id);
    if (prev && !prev.has(id)) {
      const real = view?.players?.find?.((x) => same(x.id, p.id));
      out.push({ id, name: p.name, color: p.color, avatar: p.avatar, piece: p.piece, resigned: !!(p.resigned || real?.resigned || (same(p.id, me) && resigned)) });
    }
  }
  return { out, now };
}

/** The stamp copy for a player who is out. -> { title, word, sub } */
export function outCopy({ name, resigned }, mine) {
  const who = mine ? 'You are' : `${name || 'A player'} is`;
  return {
    title: `${who} out`,
    word: resigned ? 'FORFEIT' : 'BANKRUPT',
    sub: resigned ? (mine ? 'You left the game. You can keep watching.' : 'Left the game by choice') : (mine ? 'Out of cash. You can keep watching.' : 'Out of cash'),
  };
}

/** Number of districts owned by `id`. */
export const districtCount = (owners, id) => (owners || []).reduce((n, o) => (same(o, id) ? n + 1 : n), 0);

/**
 * The recap tiles of the game-over screen for one player: [{ key, icon, label, value }]. Only tiles with something to show.
 * `moments` = matchMoments(players) (the best of the match).
 */
export function recapTiles(view, id, moments = []) {
  const p = view?.players?.find?.((x) => same(x.id, id));
  const st = p?.stats || null;
  const out = [];
  if (st && Number(st.rentEarned) > 0) out.push({ key: 'rent', icon: '\u{1F3E6}', label: 'Rent earned', value: compactINR(st.rentEarned) });
  const d = districtCount(view?.owners, id);
  out.push({ key: 'districts', icon: '\u{1F3E0}', label: 'Districts owned', value: String(d) });
  if (st && Number(st.upgrades) > 0) out.push({ key: 'upgrades', icon: '\u{1F3D7}️', label: 'Upgrades built', value: String(st.upgrades) });
  const sn = Number(st?.snatches ?? st?.snatchWins);
  if (Number.isFinite(sn) && sn > 0) out.push({ key: 'snatches', icon: '⚡', label: 'Snatches won', value: String(sn) });
  const mine = moments.find((m) => same(m.id, id));
  const best = mine || moments[0];
  if (best) out.push({ key: 'best', icon: best.icon, label: 'Best moment', value: `${best.label}: ${same(best.id, id) ? 'you' : best.who} (${best.value})` });
  return out.slice(0, 5);
}

/** The text the share button copies. Pure. */
export function shareText({ won, rank, total, winnerName, worth, rounds, reason }) {
  const head = won ? 'I won Hyderabad Tycoon!' : `I finished ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} of ${total} in Hyderabad Tycoon.`;
  const tail = [];
  if (!won && winnerName) tail.push(`${winnerName} took the city`);
  if (worth != null) tail.push(`net worth ${formatINR(worth)}`);
  if (rounds) tail.push(`${rounds} rounds`);
  if (reason) tail.push(reason);
  return `${head}${tail.length ? ` ${tail.join(', ')}.` : ''}`;
}

/** Count-up value at progress t (0..1) with an ease-out curve. */
export const countAt = (target, t) => {
  const k = Math.max(0, Math.min(1, t));
  return Math.round(target * (1 - (1 - k) ** 3));
};
