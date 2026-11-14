// How to play Hyderabad Hustle (docs/HUSTLE_PLAN.md section 3), in short friendly sections. Numbers come from the
// board data and the live game settings when available.
import '@/styles/sheets.css';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import * as shared from '@shared/index.js';
import Sheet from './ui/Sheet.jsx';
import { artPart } from './ui/PlayerToken.jsx';
import {
  CHAI_CAP, CHAI_MIN_RENT, COLLECTIONS, DEFAULT_CFG, DECKS, EVENT_EVERY, FAIR_DICE_TEXT, LUCKY_DICE_TEXT, MAX_LEVEL, MODES,
  MUNICIPAL_BASE, MUNICIPAL_PER_LEVEL, PASS_START_AMOUNT, SET_BONUS_MULT, TRAFFIC_FINE, fareOf, levelNameOf, nextStop,
  rentLadder, settingsSummary, upgradeCostOf,
} from './ui/helpers.js';

const X = '×';

const CITY_EVENTS_FALLBACK = [
  { id: 'rush_hour', title: 'Hyderabad Rush Hour', text: 'one owned collection collects rent ×1.5: office traffic, Old City shopping, lakefront visitors or cricket crowds.' },
  { id: 'biryani_boom', title: 'Biryani Business Boom', text: 'upgraded food businesses in Old City Icons and Everyday Hyderabad pay ×2.' },
  { id: 'wedding_season', title: 'Wedding Season', text: 'everyone pays ₹30,000; each upgraded Lake & Leisure or Luxury district pays its owner ₹20,000.' },
  { id: 'festival', title: 'Festival bonus', text: 'Bonalu, Bathukamma or Eid: every player receives ₹50,000.' },
  { id: 'monsoon', title: 'Monsoon', text: 'one collection collects half rent.' },
];
const CITY_EVENTS = Array.isArray(shared.CITY_EVENTS) && shared.CITY_EVENTS.length && shared.CITY_EVENTS.every((e) => e?.title)
  ? shared.CITY_EVENTS
  : CITY_EVENTS_FALLBACK;

const TRANSPORT = TILES.filter((t) => t.type === 'transport');
const HITEC = TILES.find((t) => /hitec/i.test(t.name || '')) || TILES.filter((t) => t.type === 'property').slice(-4)[0];

function Dice({ n = 6 }) {
  const pips = {
    1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
  };
  return (
    <svg viewBox="0 0 100 100" width="22" height="22" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="20" fill="#fff7e6" stroke="#f3e6c8" strokeWidth="4" />
      {pips[n].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" fill="#1b1340" />)}
    </svg>
  );
}

function Rule({ icon, title, children, wide = false, id }) {
  return (
    <section className={`hg-rule${wide ? ' hg-rule--wide' : ''}`} id={id}>
      <span className="hg-rule-ico" aria-hidden="true">{icon}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

export default function RulesSheet({ open, onClose, session }) {
  const rawCfg = session?.display?.cfg || session?.view?.cfg || {};
  const cfg = { ...DEFAULT_CFG, ...rawCfg };
  const summary = settingsSummary(rawCfg, session?.display?.goal ?? rawCfg.goal);
  const fairDice = (cfg.dice ?? 'lucky') === 'fair';
  const declineAuction = cfg.auctionOnDecline !== false;
  const passStart = cfg.passStart ?? PASS_START_AMOUNT;
  const fine = cfg.trafficFine ?? TRAFFIC_FINE;
  const chaiCap = cfg.chaiCap ?? CHAI_CAP;
  const BuildingArt = artPart('BuildingArt');
  const hitecRent = HITEC ? rentLadder(HITEC) : [];
  const modeList = ['standard', 'quick', 'classic'].map((id) => MODES[id]).filter(Boolean);

  return (
    <Sheet open={open} onClose={onClose} title="How to play" className="hg-rules" desktop="modal">
      <p className="hg-summary is-strong">{summary}</p>
      <p className="hg-rules-pitch">Buy districts across Hyderabad, build businesses, collect rent and survive the traffic, festivals and drama. Richest after the last round wins.</p>

      <Rule icon={'🏁'} title="Pick a mode" id="rules-modes">
        <ul className="hg-rules-modes">
          {modeList.map((m) => (
            <li key={m.id} className={cfg.mode === m.id ? 'is-on' : ''}>
              <b>{m.label}</b>
              <span>{m.rounds ? `${m.rounds} rounds` : 'Until one player is left'} · start {formatINR(m.startCash)}</span>
            </li>
          ))}
        </ul>
      </Rule>

      <Rule icon={<Dice n={6} />} title="Your turn">
        <ol className="hg-rules-steps">
          <li><b>Roll</b> one die and move 1&ndash;6 squares. A <b>six</b> rolls again.</li>
          <li><b>Resolve</b> the square: buy, pay rent, draw a card or take the special.</li>
          <li><b>Invest</b>: upgrade your districts, mortgage or sell.</li>
          <li><b>Negotiate</b>: offer a trade.</li>
          <li><b>End turn.</b></li>
        </ol>
        <p>Pass or land on START and collect <b>{formatINR(passStart)}</b>.</p>
      </Rule>

      <Rule icon={'🏠'} title="Buy, or let the city auction it">
        <p>
          Land on a free district and buy it at its price.{' '}
          {declineAuction
            ? <>Skip it, or be unable to afford it, and a <b>City Takeover</b> auction starts.</>
            : <>Skip it and it stays free. If you cannot afford it, a <b>City Takeover</b> auction starts.</>}
          {' '}Everyone places <b>one sealed bid</b> (from 10% of the price); the highest wins.
        </p>
        <p>Land on someone else&rsquo;s district and you pay them rent.</p>
      </Rule>

      <Rule icon={'🏗️'} title="Three businesses per district" wide>
        <p>
          A district you buy opens its first business. Upgrade it twice (<b>half the price</b> each time, on your turn, no full set needed) and the rent climbs.
          {HITEC && hitecRent.length ? <> {HITEC.name}: {hitecRent.map(formatINR).join(' → ')}.</> : null}
        </p>
        <ol className="hg-rules-ladder">
          {Array.from({ length: MAX_LEVEL + 1 }, (_, i) => (
            <li key={i}>
              {BuildingArt ? <BuildingArt theme="tech" group="cyber" level={i} size={46} /> : null}
              <b>{HITEC ? levelNameOf(HITEC, i) : `Level ${i + 1}`}</b>
              <small>{i === 0 ? 'on purchase' : `+${HITEC ? formatINR(upgradeCostOf(HITEC)) : 'upgrade'}`}</small>
            </li>
          ))}
        </ol>
        <ul className="hg-rules-colls">
          {COLLECTIONS.map((c) => (
            <li key={c.id} style={{ '--sc': c.color }}>
              <i aria-hidden="true" />
              <b>{c.name}</b>
              {c.levelNames ? <span>{c.levelNames.join(' → ')}</span> : null}
            </li>
          ))}
        </ul>
      </Rule>

      <Rule icon={'🎨'} title="Full set bonus">
        <p>Own all three districts of a collection and their <b>first businesses</b> pay <b>{X}{SET_BONUS_MULT}</b> rent. Upgraded businesses pay their own rent.</p>
      </Rule>

      <Rule icon={'🛺'} title="Transport shortcut">
        <p>
          Land on {TRANSPORT.length ? TRANSPORT.map((t) => `${t.name} (${formatINR(fareOf(t))})`).join(', ') : 'a transport stop'} and you may pay the fare to
          ride ahead to the next stop{TRANSPORT.length > 1 && nextStop(TRANSPORT[0]) ? ` (${TRANSPORT[0].name} → ${nextStop(TRANSPORT[0]).name})` : ''}.
          Handy to skip a street full of rivals. Passing START on the way still pays.
        </p>
        <p className="hg-rule-note">&ldquo;Meter kharab hai, saab!&rdquo;</p>
      </Rule>

      <Rule icon={'🚦'} title="Traffic Jam">
        <p>
          Land on the Traffic Jam corner (or draw &ldquo;Ameerpet traffic&rdquo;) and you are <b>stuck</b>: your turn ends.
          Next turn pay <b>{formatINR(fine)}</b>, spend a <b>chai token</b>, or wait it out (no move that turn).
        </p>
      </Rule>

      <Rule icon={'☕'} title="Chai Adda">
        <p>
          Grab a <b>chai token</b> (hold at most {chaiCap}). It is spent by itself on your next rent of <b>{formatINR(CHAI_MIN_RENT)}</b> or more and halves it,
          or you can use it to get out of traffic.
        </p>
      </Rule>

      <Rule icon={'🧾'} title="Municipal Charges">
        <p>Pay <b>{formatINR(MUNICIPAL_BASE)}</b> plus <b>{formatINR(MUNICIPAL_PER_LEVEL)}</b> for every upgrade level you own.</p>
      </Rule>

      <Rule icon={'🔨'} title="Bazaar Auction">
        <p>A random unowned district goes under the hammer. Everyone, the lander too, bids sealed; the minimum is half its price. Nothing unowned? Nothing happens.</p>
      </Rule>

      <Rule icon={'🎴'} title={`${DECKS.luck.name} & ${DECKS.drama.name}`}>
        <p>
          <b>{DECKS.luck.name}</b> cards bring windfalls, free chai and lucky rides. <b>{DECKS.drama.name}</b> brings bills, traffic and surprises.
          One funny hook, one clear effect.
        </p>
      </Rule>

      <Rule icon={'🌆'} title="Hyderabad Rush Hour">
        <p>Every <b>{EVENT_EVERY} rounds</b> a city event hits for that round. Watch the banner and trade for the booming collection:</p>
        <ul className="hg-rule-list">
          {CITY_EVENTS.map((e) => <li key={e.id}><b>{e.title}</b>{e.text ? <>: {e.text}</> : null}</li>)}
        </ul>
      </Rule>

      <Rule icon={'🏦'} title="Mortgage and selling">
        <p>
          Mortgage a district at its first business for <b>half its price</b>; it earns nothing until you lift it (loan + 10%).
          Sell an upgrade back for half what it cost.
        </p>
      </Rule>

      <Rule icon={'🤝'} title="Trading">
        <p>On your turn, offer districts and cash for theirs. One offer at a time, answered before the timer runs out. The sheet tells you when a trade completes a collection.</p>
      </Rule>

      <Rule icon={'🏆'} title="Net worth and winning" wide>
        <p className="hg-rules-formula">
          <b>Net worth</b> = cash + price of your districts (mortgaged: price minus the loan) + half of what you spent on upgrades &minus; unpaid debt.
        </p>
        <p>When the last round ends, the highest net worth wins (tie: more cash). The last player standing wins straight away.</p>
      </Rule>

      <Rule icon={'💸'} title="Debt and bankruptcy">
        <p>
          A bill bigger than your cash puts you in <b>debt</b>: sell upgrades or mortgage districts until you can pay.
          If that is not enough, or you give up, you are bankrupt and out.
        </p>
      </Rule>

      <Rule icon={fairDice ? '⚖️' : '🍀'} title={fairDice ? 'Fair dice' : 'Lucky dice'}>
        <p>{fairDice ? FAIR_DICE_TEXT : LUCKY_DICE_TEXT}</p>
      </Rule>
    </Sheet>
  );
}
