// The in-game tour: ids, the step list (desktop + phone variants), and the pure "may the tour be on screen right now?" rules.
// Numbers come from the table's rules (`cfg`) and from shared/board.js exports, never typed in here, so a rebalance changes the
// words too. Copy: short, friendly, no jargon. Targets are CSS selectors / lookups; a step whose target is not on screen is
// skipped by the engine (e.g. Snatch off, no chat bar, camera not zoomed).
import {
  AUCTION_TILE, CHAI_CAP, CHAI_TILE, MAX_LEVEL, MORTGAGE_RATIO, MUNICIPAL_TILE, PASS_START, SET_BONUS, START_TILE, TILES, TRAFFIC_FINE, TRAFFIC_TILE,
  TRANSPORT_TILES, UNMORTGAGE_INTEREST,
} from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import { activeMapId } from '@shared/maps.js';
import { wordsOf } from '@/lib/mapWords.js';
import { resolveTarget } from '../tour/tourModel.js';

export const GAME_TOUR_ID = 'game@1'; // bump to show the tour again after a big change
export const GAME_INVITE_ID = 'game-invite@1'; // the "New here?" card is offered once per browser

const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const secs = (ms) => Math.max(1, Math.round(num(ms, 0) / 1000));
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** A target that picks the first selector that is on screen (a lookup the engine re-runs every frame). */
const firstOf = (...selectors) => () => {
  for (const s of selectors) {
    const el = resolveTarget(s);
    if (el) return el;
  }
  return null;
};
const tileEl = (id) => `[data-tile="${id}"]`;
const firstTileOf = (type) => TILES.find((t) => t.type === type)?.id;

/** What the table is, in one plain sentence (the win rule). */
export function winLine(cfg) {
  const target = num(cfg?.targetWorth, 0);
  const rounds = num(cfg?.maxRounds, 0);
  const net = 'Net worth is your cash plus your districts and upgrades.';
  if (target > 0 && rounds > 0) return `First to ${compactINR(target)} net worth wins, or the richest after round ${rounds}. ${net}`;
  if (target > 0) return `First to ${compactINR(target)} net worth wins. ${net}`;
  if (rounds > 0) return `The richest player after round ${rounds} wins. ${net}`;
  return `The last player standing wins. ${net}`;
}

/**
 * The tour for this table. `me` is my player id (for my pawn). Steps are in teaching order; `phone` overrides swap the
 * target / words for the simple portrait phone table (phone/PhoneTable.jsx).
 */
export function buildGameSteps({ cfg = {}, me = '' } = {}) {
  const w = wordsOf(cfg && cfg.map ? cfg : activeMapId()); // the table's map: chai / festival token, Chai Adda / Sankranti Fair ...
  const snatches = num(cfg.snatches, 1);
  const turnSecs = num(cfg.turnSeconds, 0);
  const passStart = num(cfg.passStart, PASS_START);
  const fine = num(cfg.trafficFine, TRAFFIC_FINE);
  const chaiCap = num(cfg.chaiCap, CHAI_CAP);
  const everyN = num(cfg.eventEvery, 3);
  const fullSet = cfg.requireFullSet !== false;
  const property = TILES.find((t) => t.type === 'property');
  const luck = firstTileOf('card');
  const mortgagePct = Math.round(MORTGAGE_RATIO * 100);
  const feePct = Math.round(UNMORTGAGE_INTEREST * 100);
  const myPawn = () => resolveTarget(`[data-fx-pawn="${String(me).replace(/["\\]/g, '')}"] .hb-pawn__body`); // the pawn wrapper itself has no size
  const transportId = TRANSPORT_TILES[0];

  return [
    {
      id: 'welcome',
      title: 'Welcome to Kingpin!',
      body: 'Buy districts, collect rent and out-earn the whole table. This quick tour shows every control. Press Esc any time to skip.',
    },
    {
      id: 'board',
      target: '.hb-board',
      title: 'The city board',
      body: '36 tiles run clockwise from START. Tap any tile to see its price, rent and owner.',
      phone: { body: '36 tiles run clockwise from START. Tap a tile for its price, rent and owner, and pinch to zoom in.' },
      padding: 4,
    },
    {
      id: 'districts',
      target: property ? tileEl(property.id) : undefined,
      title: 'Districts and collections',
      body: `Coloured tiles are districts. Own the whole colour and its rent pays ×${SET_BONUS.full}${fullSet ? ', and you can start upgrading' : ''}.`,
      placement: 'right',
    },
    {
      id: 'pawn',
      target: myPawn,
      title: 'Your pawn',
      body: 'That is you, walking clockwise. A glow follows whoever is playing, so you always know whose turn it is.',
      padding: 10,
    },
    {
      id: 'players',
      target: firstOf('.hg-pod.is-me', '.hg-pod'),
      title: 'Players and money',
      body: 'Each player shows their cash and net worth. The crown marks who is leading right now.',
      phone: { target: '.pp-list', placement: 'top', body: 'Each player shows cash and net worth. The crown marks the leader, and a tag shows whose turn it is.' },
    },
    {
      id: 'wifi',
      target: firstOf('.hg-pod.is-me .hg-pod__sig', '.hg-pod__sig'),
      title: 'Wi-Fi bars',
      body: 'Bars show how well each player is connected. If someone drops, the table plays safe moves for them until they are back.',
      phone: { target: '.pp__sig', placement: 'top' },
      padding: 6,
    },
    {
      id: 'goal',
      target: firstOf('.hg-top-mid', '.hg-top'),
      title: 'How you win',
      body: winLine(cfg),
      phone: { target: '.ph-top__mid', placement: 'bottom' },
    },
    {
      id: 'dice',
      target: '.cp-hero__die',
      title: 'The die',
      body: cfg.dice === 'fair' ? 'One die per turn, and a six lets you roll again. Fair dice: every number is equally likely.' : 'One die per turn, and a six lets you roll again. Lucky dice quietly help whoever is falling behind.',
      phone: { target: '.pc-die' },
      padding: 6,
    },
    {
      id: 'action',
      target: firstOf('.cp-actions', '.ad'),
      title: 'Your big button',
      body: `Roll, Buy or End turn: your next move is always here${turnSecs ? `, with a ${turnSecs} second timer` : ' with a timer'}. When time runs out the game plays a safe move for you.`,
      phone: { target: '.pa', placement: 'top' },
    },
    {
      id: 'buy',
      target: firstOf('.cp-actions', '.ad'),
      title: 'Buying a district',
      body: snatches > 0
        ? 'Land on a free district and you can Buy it, or Pass: it stays free for the next lander. After a Buy, the others get a short Snatch window.'
        : 'Land on a free district and you can Buy it at the price shown, or Pass: it simply stays free for the next lander.',
      phone: { target: '.pa', placement: 'top' },
    },
    ...(snatches > 0 ? [{
      id: 'snatch',
      target: firstOf('.cp-actions', '.ad'),
      title: 'Snatch!',
      body: `When someone buys a district, a SNATCH button appears for ${secs(cfg.snatchMs || 5000)} seconds: be first to press it and the district is yours. You start with ${snatches} ${plural(snatches, 'button')}, used only when you win. If several press, they bid in secret.`,
      phone: { target: '.pa', placement: 'top' },
    }] : []),
    {
      id: 'upgrade',
      target: '[data-tour="manage"]',
      title: 'Upgrades',
      body: fullSet
        ? `Own every district of a colour, then tap Manage to upgrade them, up to level ${MAX_LEVEL}. Upgrades raise the rent a lot.`
        : `Own a district, then tap Manage to upgrade it, up to level ${MAX_LEVEL}. Upgrades raise the rent a lot.`,
    },
    {
      id: 'mortgage',
      target: '[data-tour="manage"]',
      title: 'Mortgage',
      body: `Short of cash? Mortgage a district for ${mortgagePct}% of its price. It collects no rent until you lift it, for a ${feePct}% fee.`,
    },
    {
      id: 'trade',
      target: '[data-tour="trade"]',
      title: 'Trading',
      body: 'On your turn, swap districts and cash with another player. They can accept, say no, or counter-offer.',
    },
    {
      id: 'chai',
      target: tileEl(CHAI_TILE),
      title: w.chaiCorner,
      body: `Land here to pick up a ${w.chaiToken} (you can hold ${chaiCap}). It halves your next big rent by itself, or gets you out of a ${w.trafficCorner} free.`,
      placement: 'left',
    },
    {
      id: 'transport',
      target: tileEl(transportId),
      title: w.isDefault ? 'Auto, Metro and MMTS' : w.transportStops.replace(' or ', ' and '),
      body: 'Land on a stop and you can ride to the next one for a small fare. A ride that passes START still pays your salary.',
    },
    {
      id: 'traffic',
      target: tileEl(TRAFFIC_TILE),
      title: w.trafficCorner,
      body: fine > 0
        ? `Land here (or draw the wrong card) and you are stuck for a turn. Pay ${formatINR(fine)}, spend a ${w.isDefault ? 'chai' : w.chaiToken}, or wait it out.`
        : 'Land here (or draw the wrong card) and you are stuck, but a free jam lets you out on your next turn.',
    },
    {
      id: 'cards',
      target: luck === undefined ? undefined : tileEl(luck),
      title: 'Luck and Drama cards',
      body: `${w.luck} and ${w.drama} tiles draw a card: bonuses, fines, free moves, rent boosts and even Snatch buttons.`,
    },
    ...(everyN > 0 ? [{
      id: 'events',
      target: firstOf('.hg-top-mid', '.hg-top'),
      title: 'City events',
      body: `Every ${everyN} ${plural(everyN, 'round')} a city event hits: festivals pay everyone, ${w.isDefault ? 'a rush hour boosts one colour, monsoon halves it' : 'a boom lifts one colour, a market swing halves it'}. A flag on the board marks the tiles it touches.`,
      phone: { target: '.ph-top__mid', placement: 'bottom' },
    }] : []),
    {
      id: 'municipal',
      target: tileEl(MUNICIPAL_TILE),
      title: w.municipalCorner,
      body: 'A city fee: a base charge plus more for every upgrade you own. Big builders pay the most.',
      placement: 'left',
    },
    ...(passStart > 0 ? [{
      id: 'start',
      target: tileEl(START_TILE),
      title: 'START salary',
      body: `Pass or land on START and the bank pays you ${formatINR(passStart)}. Every lap is a pay day.`,
      placement: 'right',
    }] : []),
    {
      id: 'bazaar',
      target: tileEl(AUCTION_TILE),
      title: w.auctionTile,
      body: 'Land here and a random free district goes to auction on the spot, if any are left. Everyone can bid!',
    },
    {
      id: 'feed',
      target: '.hg-feedcard',
      title: 'Activity feed',
      body: 'Every roll, purchase and payment shows up here, so you can follow the game without missing a thing.',
      placement: 'left',
    },
    {
      id: 'chat',
      target: firstOf('.table-chat', '.pcb', '.ad-tool.is-icon'),
      title: 'Chat and reactions',
      body: 'Say hello or send a quick emoji to the table. Friendly banter is encouraged.',
      phone: { placement: 'top' },
    },
    {
      id: 'camera',
      target: '[data-bc-hud][data-on]',
      title: 'Camera controls',
      body: 'While the board is zoomed in, use plus and minus, or the corner button, to see the whole board again.',
    },
    {
      id: 'menu',
      target: '[data-tour="menu"]',
      title: 'Menu and settings',
      body: 'Sound, vibration, Reduce motion, stats, the game log, the rules and this tour live here. Resign is here too: the bank takes your cash and districts, and you can keep watching.',
      placement: 'bottom',
    },
    {
      id: 'finish',
      title: 'Win, or go bust',
      body: `${winLine(cfg)} Cannot pay a debt? Mortgage or sell upgrades first. Go bust and the bank takes everything.`,
    },
  ];
}

/** True while a decision is mine to make (my move, my bid, a Snatch I may press, my debt, a trade answer): the tour stays out of the way. */
export function owesDecision(session) {
  const v = session?.view;
  if (!v || session.result || v.phase === 'over' || session.resigned) return false;
  const me = session.me;
  const mine = (v.players || []).find((p) => p.id === me);
  if (!mine || mine.bankrupt) return false;
  const wf = session.clock?.waitingFor;
  if (Array.isArray(wf) && wf.map(String).includes(String(me)) && session.clock?.deadline) return true;
  const o = session.options || {};
  return !!(o.roll || o.buy || o.skipBuy || o.endTurn || o.bid || o.snatch || o.debt || o.payDebt || o.tradeOffer);
}

/** A table moment that has its own sheet or pop-up (auction, debt, Snatch window, a trade): the tour waits for it to pass. */
export function tableBusy(session) {
  const v = session?.view;
  if (!v) return false;
  return v.phase === 'auction' || v.phase === 'debt' || v.phase === 'snatch' || !!v.trade;
}

/** What the tour pill should say and allow. Pure; exported for tests. */
export function pauseState({ open, owes, busy, minimised }) {
  const paused = !!open && (owes || busy || minimised);
  const canResume = paused && !owes && !busy;
  const text = owes ? 'Your move first' : 'Tour paused';
  return { paused, canResume, text };
}
