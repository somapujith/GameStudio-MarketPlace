// Turns engine events into short, fun English lines for the game log and the centre-stage bubble.
//
//   describeEvent(ev, ctx) -> { text, tone, tile?, icon?, bubble?, title?, extra? } | null
//
// ctx = {
//   players: [{ id, name }],  me: playerId,                 // "You" / "Your" for `me`
//   owners?: (id|null)[],     // owners BEFORE this event (lets `own` / `level` lines name the owner)
//   round?: number,           // round shown BEFORE this event (turn events log only when it increases)
//   maxRounds?: number|null,  // flags the final round
//   targetWorth?: number|null, // the net worth target: a `win` with reason 'target' names it
// }
//
// tone: 'info' | 'good' | 'bad' | 'warn' | 'cheer'. Optional extras: `bubble` is a shorter text for the bubble;
// `extra` ({ text, tone, icon }) is a second, log-only line (lucky-dice help).
// Events that need no line (plain moves, the receiving half of a rent payment, ...) return null.

import { TILES, GROUPS, MAX_LEVEL, levelName } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { activeMapId } from '@shared/maps.js';
import { wordsOf } from './mapWords.js';

const tileName = (id) => (TILES[id] ? TILES[id].name : `tile ${id}`);

/** The deck names of the table's map ("Nawabi Luck" / "Mana Adrushtam"), read when a line is built. */
const deckNames = () => { const w = wordsOf(); return { luck: w.luck, drama: w.drama }; };

/** One funny line per transport stop (keyed by where the ride starts), per map. */
const RIDE_LINES = {
  5: '"Meter kharab hai, saab!"',
  14: '"Please stand clear of the doors."',
  23: '"Next stop: everywhere, eventually."',
};
const RIDE_LINES_ANDHRA = {
  5: '"All aboard, the sea breeze is free!"',
  14: '"Platform packed, train slightly late."',
  23: '"Fasten your seat belts for the festival flight."',
};
const rideLines = () => (activeMapId() === 'andhra' ? RIDE_LINES_ANDHRA : RIDE_LINES);

function playerName(ctx, id) {
  if (id === null || id === undefined) return 'Someone';
  if (ctx && id === ctx.me) return 'You';
  const p = ctx && Array.isArray(ctx.players) ? ctx.players.find((x) => x.id === id) : null;
  return p && p.name ? p.name : String(id);
}

const isMe = (ctx, id) => !!ctx && id !== null && id !== undefined && id === ctx.me;
const be = (ctx, id) => (isMe(ctx, id) ? 'are' : 'is');
const has = (ctx, id) => (isMe(ctx, id) ? 'have' : 'has');
const their = (ctx, id) => (isMe(ctx, id) ? 'your' : 'their');
/** The person as an object of a sentence: "you" or the name. */
const whom = (ctx, id) => (isMe(ctx, id) ? 'you' : playerName(ctx, id));
/** "a Stall", "an Irani Cafe". */
const withArticle = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/** good/bad when it concerns the local player, otherwise neutral. */
const toneFor = (ctx, id, mine, other = 'info') => (isMe(ctx, id) ? mine : other);

/** "Meera", "Meera and Ravi", "Meera, Ravi and Asha" ("You" for the local player, listed first). */
export function nameList(ctx, ids) {
  const list = Array.isArray(ids) ? ids.filter((id) => id !== null && id !== undefined) : [];
  return joinNames(list.map((id) => playerName(ctx, id)));
}

/** "Meera", "Meera and Ravi", "Meera, Ravi and Asha"; "You" always first; "Nobody" for an empty list. */
export function joinNames(names) {
  const list = Array.isArray(names) ? [...names] : [];
  const at = list.indexOf('You');
  if (at > 0) list.unshift(...list.splice(at, 1));
  if (list.length <= 1) return list[0] || 'Nobody';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The short Snatch lines (Snatch window, docs/GAME_RULES.md section 9). One place for the words, used by the log, the
 * board-centre caption and the pop-up: `snatchCaption(ev, ctx)` -> { text, tone, tile } | null.
 *   snatch_end snatched   "Meera snatched Sultan Bazaar!"
 *   snatch_end bidding    "Snatch bidding: Asha and Ravi"
 *   snatch_end none       null (silence: nobody snatched, the buyer keeps it)
 *   token_earned (card)   "Asha won a Snatch button from a card"
 */
export function snatchCaption(ev, ctx) {
  if (!ev) return null;
  const tile = Number.isInteger(ev.tile) ? ev.tile : undefined;
  if (ev.type === 'snatch_end') {
    if (ev.outcome === 'snatched' && ev.winner !== null && ev.winner !== undefined) {
      return { text: `${playerName(ctx, ev.winner)} snatched ${tileName(ev.tile)}!`, tone: isMe(ctx, ev.winner) ? 'cheer' : toneFor(ctx, ev.buyer, 'bad'), tile };
    }
    if (ev.outcome === 'bidding') {
      const claimants = Array.isArray(ev.claimants) ? ev.claimants : [];
      return { text: `Snatch bidding: ${nameList(ctx, claimants)}`, tone: claimants.includes(ctx?.me) ? 'warn' : 'info', tile };
    }
    return null;
  }
  if (ev.type === 'token_earned') {
    return { text: `${playerName(ctx, ev.player)} won a Snatch button from a card`, tone: toneFor(ctx, ev.player, 'good'), tile: undefined };
  }
  return null;
}

function describeCash(ev, ctx) {
  const who = playerName(ctx, ev.player);
  const amt = formatINR(Math.abs(ev.delta));
  switch (ev.reason) {
    case 'salary':
      return { text: `${who} passed START and collected ${amt}`, tone: toneFor(ctx, ev.player, 'good'), icon: '💰' };
    case 'rent': {
      if (!(ev.delta < 0)) return null; // the paying half already tells the story
      const to = ev.other !== undefined && ev.other !== null ? ` to ${playerName(ctx, ev.other)}` : '';
      let tone = 'info';
      if (isMe(ctx, ev.player)) tone = 'bad';
      else if (isMe(ctx, ev.other)) tone = 'good';
      return { text: `${who} paid ${amt} rent${to}`, tone, icon: '🏠' };
    }
    case 'tax':
      return { text: `${who} paid ${amt} in ${wordsOf().municipalCorner}`, tone: toneFor(ctx, ev.player, 'bad'), tile: 27, icon: '🏛️' };
    case 'event':
      return ev.delta >= 0
        ? { text: `${who} received ${amt} from the city event`, tone: toneFor(ctx, ev.player, 'good'), icon: '🎁' }
        : { text: `${who} paid ${amt} for the city event`, tone: toneFor(ctx, ev.player, 'bad'), icon: '💸' };
    case 'buy':
    case 'upgrade':
    case 'auction':
    case 'card':
    case 'fare':
    case 'traffic':
    case 'liquidate':
    case 'mortgage':
    case 'unmortgage':
    case 'sell':
    case 'trade':
    case 'bankrupt': // the bank paying the creditor of a bankrupt player: the bankrupt line tells it
      return null; // told by own / level / auction_end / card / ride / traffic / mortgage / trade events
    default:
      return {
        text: `${who} ${ev.delta >= 0 ? 'received' : 'paid'} ${amt}`,
        tone: toneFor(ctx, ev.player, ev.delta >= 0 ? 'good' : 'bad'),
        icon: '💸',
      };
  }
}

function describeLand(ev, ctx) {
  const tile = TILES[ev.tile];
  const who = playerName(ctx, ev.player);
  if (!tile) return null;
  const base = { tone: 'info', tile: ev.tile, icon: tile.emoji };
  const own = ctx.owners && ctx.owners[ev.tile] === ev.player && tile.type === 'property';
  if (own) return { ...base, text: `${who} ${be(ctx, ev.player)} back at ${their(ctx, ev.player)} own ${tile.name}` };
  switch (tile.type) {
    case 'transport':
      return { ...base, text: `${who} reached the ${tile.name}. A shortcut ride costs ${formatINR(tile.fare)}` };
    case 'traffic':
    case 'chai':
    case 'municipal':
    case 'card':
      return null; // the traffic / chai / cash / card line follows
    case 'auction':
      return { ...base, text: `${who} landed on the ${wordsOf().auctionTile}` };
    case 'start':
      return { ...base, text: `${who} landed right on START` };
    default:
      return { ...base, text: `${who} landed on ${tile.name}` };
  }
}

/** What a Traffic Jam fine was: the event's own amount, else the cash event just before it (ctx.lastCash), else just "the fine" (no hard-coded number: the host sets it). */
function fineText(ev, ctx) {
  if (Number.isFinite(ev.amount)) return formatINR(ev.amount);
  const c = ctx && ctx.lastCash;
  if (c && c.reason === 'traffic' && c.player === ev.player && Number.isFinite(c.delta)) return formatINR(Math.abs(c.delta));
  return 'the fine';
}

function describeTraffic(ev, ctx) {
  const who = playerName(ctx, ev.player);
  if (ev.stuck) {
    return {
      text: ev.reason === 'card' ? `${who} ${be(ctx, ev.player)} stuck in traffic. Baigan!` : `Traffic Jam! ${who} ${be(ctx, ev.player)} stuck where ${isMe(ctx, ev.player) ? 'you stand' : 'they stand'}`,
      bubble: 'Stuck in traffic!',
      tone: toneFor(ctx, ev.player, 'bad', 'warn'),
      tile: 9,
      icon: '🚦',
    };
  }
  switch (ev.reason) {
    case 'paid':
      return { text: `${who} paid ${fineText(ev, ctx)} and squeezed out of the jam`, tone: toneFor(ctx, ev.player, 'warn'), icon: '🚦' };
    case 'free':
      return { text: `${who} ${be(ctx, ev.player)} out of the traffic jam, free of charge`, tone: toneFor(ctx, ev.player, 'good'), icon: '🚦' };
    case 'chai':
      return { text: wordsOf().isDefault ? `${who} sipped a chai and the traffic melted away` : `${who} spent a ${wordsOf().chaiToken} and the traffic melted away`, tone: toneFor(ctx, ev.player, 'good'), icon: '☕' };
    default:
      return { text: `${who} waited out the traffic jam`, tone: toneFor(ctx, ev.player, 'warn'), icon: '🚦' };
  }
}

function describeChai(ev, ctx) {
  const who = playerName(ctx, ev.player);
  if (ev.change > 0) {
    return {
      text: ev.reason === 'card' ? `${who} got a free ${wordsOf().chaiToken}` : `${who} picked up a ${wordsOf().chaiToken} at the ${wordsOf().chaiCorner}`,
      bubble: wordsOf().isDefault ? '+1 chai' : `+1 ${wordsOf().chaiToken}`,
      tone: toneFor(ctx, ev.player, 'good'),
      icon: '☕',
    };
  }
  if (ev.reason === 'rent') {
    return {
      text: wordsOf().isDefault ? `Chai break! ${who} saved ${formatINR(ev.saved || 0)} on rent` : `Festival token! ${who} saved ${formatINR(ev.saved || 0)} on rent`,
      bubble: wordsOf().isDefault ? `Chai saved ${formatINR(ev.saved || 0)}` : `Saved ${formatINR(ev.saved || 0)}`,
      tone: toneFor(ctx, ev.player, 'good'),
      icon: '☕',
    };
  }
  return null; // spent on traffic: the traffic line tells it
}

/** "Ameerpet + Begumpet + ₹500" (or "nothing") for one side of a trade. */
function bundleText(b) {
  const tiles = b && Array.isArray(b.tiles) ? b.tiles : [];
  const cash = Number(b && b.cash) || 0;
  const parts = tiles.map(tileName);
  if (cash > 0) parts.push(formatINR(cash));
  return parts.length ? parts.join(' + ') : 'nothing';
}

function describeTrade(ev, ctx) {
  const involvesMe = isMe(ctx, ev.from) || isMe(ctx, ev.to);
  switch (ev.type) {
    case 'trade_offer':
      if (ev.counter) {
        return {
          text: `${playerName(ctx, ev.from)} changed the deal and offered ${whom(ctx, ev.to)}: ${bundleText(ev.give)} for ${bundleText(ev.get)}`,
          tone: isMe(ctx, ev.to) ? 'warn' : 'info',
          icon: '🔁',
        };
      }
      return {
        text: `${playerName(ctx, ev.from)} offered ${whom(ctx, ev.to)} a trade: ${bundleText(ev.give)} for ${bundleText(ev.get)}`,
        tone: isMe(ctx, ev.to) ? 'warn' : 'info',
        icon: '🤝',
      };
    case 'trade_countered':
      return {
        text: `${playerName(ctx, ev.by)} countered ${isMe(ctx, ev.from) ? 'your' : `${playerName(ctx, ev.from)}'s`} offer`,
        tone: involvesMe ? 'warn' : 'info',
        icon: '🔁',
      };
    case 'trade_done':
      return {
        text: `Trade done! ${playerName(ctx, ev.from)} gave ${bundleText(ev.give)} to ${whom(ctx, ev.to)} for ${bundleText(ev.get)}`,
        tone: involvesMe ? 'good' : 'info',
        icon: '🤝',
      };
    default: {
      const why = String(ev.reason || '');
      let text;
      if (/cancel/i.test(why)) text = `${playerName(ctx, ev.from)} cancelled the trade offer to ${whom(ctx, ev.to)}`;
      else if (/time/i.test(why)) text = `The trade offer from ${playerName(ctx, ev.from)} to ${whom(ctx, ev.to)} timed out`;
      else if (/invalid/i.test(why)) text = `The trade offer from ${playerName(ctx, ev.from)} to ${whom(ctx, ev.to)} is no longer valid`;
      else if (/bankrupt/i.test(why)) text = `The trade offer between ${playerName(ctx, ev.from)} and ${whom(ctx, ev.to)} was called off`;
      else text = `${playerName(ctx, ev.to)} turned down ${isMe(ctx, ev.from) ? 'your' : `${playerName(ctx, ev.from)}'s`} trade offer`;
      return { text, tone: involvesMe ? 'warn' : 'info', icon: '🙅' };
    }
  }
}

function describeTurn(ev, ctx) {
  // Per-turn lines would drown the log: only announce a new round.
  if (!ctx || typeof ctx.round !== 'number' || !(ev.round > ctx.round)) return null;
  const max = Number(ctx.maxRounds);
  const final = Number.isFinite(max) && max > 0 && ev.round === max;
  return {
    text: final ? `Round ${ev.round} of ${max} begins. Final round!` : Number.isFinite(max) && max > 0 ? `Round ${ev.round} of ${max} begins` : `Round ${ev.round} begins`,
    bubble: final ? 'Final round!' : `Round ${ev.round}`,
    tone: final ? 'warn' : 'info',
    icon: final ? '🏁' : '🔔',
  };
}

function describeWin(ev, ctx) {
  const who = playerName(ctx, ev.player);
  const worth = formatINR(ev.worth || 0);
  const me = isMe(ctx, ev.player);
  if (ev.player === null || ev.player === undefined) return { text: 'The game is over. Nobody is left standing', tone: 'warn', icon: '🏆' };
  if (ev.reason === 'last_standing') {
    return { text: `${who} ${me ? 'are' : 'is'} the last one standing and ${me ? 'own' : 'owns'} the city!`, bubble: `${who} ${me ? 'win' : 'wins'}!`, tone: 'cheer', icon: '🏆' };
  }
  if (ev.reason === 'target') {
    // the net worth target (ctx.targetWorth, when the caller knows it) was reached before the last round
    const goal = Number(ctx && ctx.targetWorth) > 0 ? `${formatINR(Number(ctx.targetWorth))} net worth` : 'the net worth target';
    return {
      text: `Target reached! ${who} ${be(ctx, ev.player)} the first to hit ${goal} (${worth}) and ${me ? 'own' : 'owns'} the city!`,
      bubble: `${who} ${me ? 'win' : 'wins'}!`,
      tone: 'cheer',
      icon: '🏆',
    };
  }
  return { text: `The last round is over! ${who} ${be(ctx, ev.player)} the richest in ${wordsOf().place} with ${worth}`, bubble: `${who} ${me ? 'win' : 'wins'}!`, tone: 'cheer', icon: '🏆' };
}

export function describeEvent(ev, ctx) {
  ctx = ctx || {};
  if (!ev || typeof ev.type !== 'string') return null;
  try {
    switch (ev.type) {
      case 'dice': {
        const a = (ev.values || [])[0]; // one die, always
        const six = a === 6;
        const d = {
          text: `${playerName(ctx, ev.player)} rolled ${a}${six ? ': six, roll again!' : ''}`,
          tone: six ? toneFor(ctx, ev.player, 'good') : 'info',
          icon: '🎲',
        };
        if (ev.assist && isMe(ctx, ev.player)) d.extra = { text: 'Lucky dice gave you a little help 🍀', tone: 'good', icon: '🍀' };
        return d;
      }

      case 'move':
        if (ev.ride) return null; // the ride line tells it
        return ev.teleport ? { text: `${playerName(ctx, ev.player)} zipped to ${tileName(ev.to)}`, tone: 'info', tile: ev.to, icon: '✨' } : null;

      case 'land':
        return describeLand(ev, ctx);

      case 'cash':
        return describeCash(ev, ctx);

      case 'own': {
        const tile = TILES[ev.tile];
        if (ev.reason === 'buy') {
          return {
            text: `${playerName(ctx, ev.owner)} bought ${tileName(ev.tile)} for ${formatINR(tile ? tile.price : 0)} and opened ${withArticle(levelName(tile, 0))}`,
            tone: toneFor(ctx, ev.owner, 'good'),
            tile: ev.tile,
            icon: '🔑',
          };
        }
        return null; // auction (auction_end tells it), trade (trade_done) and bankrupt (bankrupt)
      }

      case 'level': {
        const tile = TILES[ev.tile];
        const owner = ctx.owners ? ctx.owners[ev.tile] : null;
        const name = levelName(tile, ev.level);
        if (ev.reason === 'upgrade') {
          const top = ev.level >= MAX_LEVEL;
          return {
            text: top
              ? `${playerName(ctx, owner)} turned ${tileName(ev.tile)} into ${withArticle(name)}!`
              : `${playerName(ctx, owner)} grew ${tileName(ev.tile)} into ${withArticle(name)}`,
            tone: top ? 'cheer' : toneFor(ctx, owner, 'good'),
            tile: ev.tile,
            icon: top ? '🏙️' : '🏗️',
          };
        }
        if (ev.reason === 'sell') {
          return {
            text: `${playerName(ctx, owner)} scaled ${tileName(ev.tile)} back to ${withArticle(name)}`,
            tone: toneFor(ctx, owner, 'warn'),
            tile: ev.tile,
            icon: '📉',
          };
        }
        return null; // bankrupt: the bankrupt line tells it
      }

      case 'card': {
        const me = isMe(ctx, ev.player);
        const tone = !me ? 'info' : ev.kind === 'good' ? 'good' : ev.kind === 'bad' ? 'bad' : 'info';
        const deck = deckNames()[ev.deck] || 'a';
        return {
          text: me ? `${ev.title} ${ev.text}` : `${playerName(ctx, ev.player)} drew ${deck}: "${ev.title}" ${ev.text}`,
          bubble: ev.title,
          tone,
          icon: ev.deck === 'drama' ? '🎭' : '🪙',
          title: ev.title,
        };
      }

      case 'ride': {
        const line = rideLines()[ev.from] || '"Hold on tight!"';
        return {
          text: `${playerName(ctx, ev.player)} paid ${formatINR(ev.fare)} and rode from the ${tileName(ev.from)} to the ${tileName(ev.to)}. ${line}`,
          bubble: line.replace(/"/g, ''),
          tone: toneFor(ctx, ev.player, 'good'),
          tile: ev.to,
          icon: TILES[ev.from]?.emoji || '🛺',
        };
      }

      case 'traffic':
        return describeTraffic(ev, ctx);

      case 'chai':
        return describeChai(ev, ctx);

      case 'auction_start': {
        if (ev.reason === 'snatch') return null; // snatch_end ("Snatch bidding: ...") tells it
        const min = formatINR(ev.minBid);
        if (ev.reason === 'bazaar') {
          return { text: `${wordsOf().auctionTile}! ${tileName(ev.tile)} goes under the hammer (min ${min})`, bubble: `${wordsOf().auctionTile}!`, tone: 'warn', tile: ev.tile, icon: '🔨' };
        }
        // never started by a pass any more (only the Bazaar Auction and Snatch bidding); an older saved game may still carry one
        return { text: `${tileName(ev.tile)} goes under the hammer (min ${min})`, bubble: 'Auction!', tone: 'info', tile: ev.tile, icon: '🔨' };
      }

      case 'skip': // a player passed on a free district: it simply stays free (no auction)
        return {
          text: `${playerName(ctx, ev.player)} passed on ${tileName(ev.tile)}. It stays free`,
          tone: 'info', tile: ev.tile, icon: '🚶',
        };

      case 'auction_end': {
        const snatch = ev.reason === 'snatch';
        if (ev.winner === null || ev.winner === undefined) {
          if (snatch) {
            const keeper = ev.buyer === null || ev.buyer === undefined ? 'its buyer' : whom(ctx, ev.buyer);
            return { text: `Nobody bid. ${tileName(ev.tile)} stays with ${keeper}`, tone: 'info', tile: ev.tile, icon: '⚡' };
          }
          return { text: `Nobody bid on ${tileName(ev.tile)}`, tone: 'info', tile: ev.tile, icon: '🔨' };
        }
        const saved = Number(ev.saved) > 0 ? ` (saved ${formatINR(ev.saved)})` : '';
        if (ev.tie === true && !snatch) {
          // equal top bids: the engine draws among the tied bidders (seeded); a server `tieRule` text wins when it sends one
          const rule = ev.tieRule || ev.tieBreak || ev.tieText;
          return { text: `Tie on ${tileName(ev.tile)} — ${playerName(ctx, ev.winner)} won ${rule ? `on ${rule}` : 'the draw'}${saved}`, tone: toneFor(ctx, ev.winner, 'good'), tile: ev.tile, icon: '🔨' };
        }
        return {
          text: `${playerName(ctx, ev.winner)} won ${tileName(ev.tile)} ${snatch ? 'in the snatch bidding' : 'at auction'} for ${formatINR(ev.amount)}${saved}`,
          tone: toneFor(ctx, ev.winner, 'good'),
          tile: ev.tile,
          icon: snatch ? '⚡' : '🔨',
        };
      }

      case 'snatch_open': {
        const secs = Math.max(1, Math.round((Number(ev.ms) || 5000) / 1000));
        const eligible = Array.isArray(ev.eligible) ? ev.eligible : [];
        const mine = !!ctx && ctx.me !== undefined && eligible.includes(ctx.me);
        return {
          text: `Snatch window open (${secs}s): ${nameList(ctx, eligible)} can snatch ${tileName(ev.tile)}`,
          bubble: mine ? 'Snatch it!' : 'Snatch window open',
          tone: mine ? 'warn' : 'info',
          tile: ev.tile,
          icon: '⚡',
        };
      }

      case 'snatch_end': {
        const c = snatchCaption(ev, ctx);
        if (!c) return null; // nobody snatched: silence
        return { text: c.text, bubble: c.text, tone: c.tone, tile: c.tile, icon: '⚡' };
      }

      case 'token_earned': {
        const c = snatchCaption(ev, ctx);
        return { text: c.text, bubble: '+1 Snatch', tone: c.tone, icon: '⚡' };
      }

      case 'snatch_token':
        return null; // the player's chip shows the count; snatch_end already told the story

      case 'city_event':
        return {
          text: `${ev.title}: ${ev.text}`,
          bubble: ev.title,
          tone: ev.kind === 'cash' && Number(ev.amount) < 0 ? 'warn' : 'cheer',
          icon: '🌆',
          title: ev.title,
        };

      case 'bankrupt': {
        // The bank took everything; `paid` ([{ to, amount }], only when a creditor was paid) says who the bank paid.
        const paid = Array.isArray(ev.paid) ? ev.paid.filter((r) => Number(r?.amount) > 0) : [];
        const tail = paid.length
          ? `; ${paid.map((r) => `${playerName(ctx, r.to)} ${isMe(ctx, r.to) ? 'were' : 'was'} paid ${formatINR(r.amount)}`).join(', ')}`
          : '';
        // `reason: 'resign'` (the player gave up; the engine may mark it) reads as a choice, not a collapse
        if (ev.reason === 'resign' || ev.resigned === true) {
          return {
            text: isMe(ctx, ev.player)
              ? `You resigned: the bank took everything${tail}. You can keep watching the rest of the game`
              : `${playerName(ctx, ev.player)} resigned: the bank took everything${tail}`,
            tone: toneFor(ctx, ev.player, 'warn', 'warn'),
            icon: '🏳️',
          };
        }
        return {
          text: isMe(ctx, ev.player)
            ? `You went bankrupt! The bank took everything${tail}`
            : `${playerName(ctx, ev.player)} went bankrupt: the bank took everything${tail}`,
          tone: toneFor(ctx, ev.player, 'bad', 'warn'),
          icon: '💥',
        };
      }

      case 'set_complete': {
        const g = GROUPS[ev.group];
        return {
          text: `${playerName(ctx, ev.player)} ${has(ctx, ev.player)} the whole ${g ? g.name : ev.group} collection: 1.5x rent on its first-level businesses!`,
          bubble: 'Collection complete!',
          tone: toneFor(ctx, ev.player, 'cheer'),
          icon: '🎉',
        };
      }

      case 'mortgage':
        return {
          text: `${playerName(ctx, ev.player)} mortgaged ${tileName(ev.tile)} for ${formatINR(ev.value)}`,
          tone: toneFor(ctx, ev.player, 'warn'),
          tile: ev.tile,
          icon: '🏦',
        };

      case 'unmortgage':
        return {
          text: `${playerName(ctx, ev.player)} paid ${formatINR(ev.cost)} to lift the mortgage on ${tileName(ev.tile)}`,
          tone: toneFor(ctx, ev.player, 'good'),
          tile: ev.tile,
          icon: '🏦',
        };

      case 'trade_offer':
      case 'trade_countered':
      case 'trade_done':
      case 'trade_rejected':
        return describeTrade(ev, ctx);

      case 'debt': {
        const to = ev.creditor === null || ev.creditor === undefined ? 'the city' : whom(ctx, ev.creditor);
        return {
          text: isMe(ctx, ev.player)
            ? `You owe ${formatINR(ev.amount)} to ${to}. Raise cash or resign!`
            : `${playerName(ctx, ev.player)} is in debt: owes ${formatINR(ev.amount)} to ${to}`,
          tone: toneFor(ctx, ev.player, 'bad', 'warn'),
          icon: '⚠️',
        };
      }

      case 'turn':
        return describeTurn(ev, ctx);

      case 'win':
        return describeWin(ev, ctx);

      default:
        return null;
    }
  } catch {
    return null;
  }
}

export { tileName, playerName };
