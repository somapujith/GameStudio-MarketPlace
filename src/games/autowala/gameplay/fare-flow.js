// The conversations of a ride, as sequences of small choices (fare-choice.js): the price talk at pickup and the optional small talk.
// Runtime glue between the pure rules (fare-bargain.js, fare-talk.js), the choice controller, and the subtitle lines. No ctx.state of its own.
import { canMeet, dropPrice, meetPrice, openingAsks, quoteFor, respond, startNegotiation } from './fare-bargain.js';
import { sayKey, sayLine } from './fare-say.js';
import { pickTalk, talkEffect, TALK } from './fare-talk.js';

const T = (en, te) => ({ en, te });
const rs = (n) => `Rs ${n}`;

/**
 * Open the price talk for a rider who just boarded.
 * env: { ctx, choices, rng }; rider: { t (the trip), ref (the estimate the price is judged against), note? }
 * done(terms): terms = { mode: 'meter' } | { mode: 'fixed', fixedFare, rounds, opening }, or null when the passenger is let go.
 */
export function startTerms(env, rider, done) {
  const { ctx, choices, rng } = env;
  const t = rider.t;
  const kind = t.kind;
  const ref = rider.ref;
  const speak = (key, vars = {}, driver = false) =>
    sayKey(ctx, key, { speaker: driver ? 'You' : t.name, kind, n: t.id, vars: { dest: t.dest.name, destTe: t.dest.te, ...vars }, driver });

  function negotiate(neg) {
    if (neg.status === 'agreed') {
      speak(neg.conceded ? 'concede' : 'accept');
      done({ mode: 'fixed', fixedFare: neg.price, rounds: neg.round, opening: neg.opening });
      return;
    }
    if (neg.status === 'countered') {
      speak('counter', { price: neg.ask, counter: neg.counter });
      const meet = canMeet(neg);
      const options = [{ id: 'accept', label: T(`Accept ${rs(neg.counter)}`, `₹${neg.counter} సరే`), sub: 'Take their offer', tone: 'good' }];
      if (meet) options.push({ id: 'meet', label: T(`Meet at ${rs(meetPrice(neg))}`, `₹${meetPrice(neg)} కి`), sub: 'Split the difference' });
      options.push({ id: 'hold', label: T(`Hold ${rs(neg.ask)}`, `₹${neg.ask} ఫిక్స్`), sub: 'Risk: they may walk', tone: 'risk' });
      choices.open({
        id: 'counter', kind: 'counter', title: T(`${t.name} offers ${rs(neg.counter)}`, `₹${neg.counter} ఇస్తామంటున్నారు`),
        say: null, seconds: 9, defaultId: 'accept', options,
        onPick: (id) => {
          if (id === 'accept') respond(neg, 'accept');
          else if (id === 'meet') {
            speak('meet', {}, true);
            respond(neg, 'meet', rng());
          } else {
            speak('hold', {}, true);
            respond(neg, 'hold', rng());
          }
          negotiate(neg);
        },
      });
      return;
    }
    // refused
    speak('refuse');
    const drop = dropPrice(kind, ref);
    choices.open({
      id: 'refused', kind: 'refused', title: T(`${t.name} says no`, `${t.te || t.name} వద్దంటున్నారు`), seconds: 8, defaultId: 'meter',
      options: [
        { id: 'meter', label: T('Meter instead', 'మీటర్ మీద'), sub: 'They calm down', tone: 'good' },
        { id: 'drop', label: T(`Drop to ${rs(drop)}`, `₹${drop} కి`), sub: 'Take a lower price' },
        { id: 'leave', label: T('Let them go', 'వెళ్ళనివ్వు'), sub: 'No ride, no pay', tone: 'risk' },
      ],
      onPick: (id) => {
        if (id === 'meter') done({ mode: 'meter', afterRefusal: true });
        else if (id === 'drop') {
          speak('accept');
          done({ mode: 'fixed', fixedFare: drop, rounds: neg.round + 1, opening: neg.opening });
        } else {
          speak('walk');
          done(null);
        }
      },
    });
  }

  speak('open');
  const quote = quoteFor(kind, ref);
  choices.open({
    id: 'terms', kind: 'terms', title: T('Meter, fixed price or bargain?', 'మీటరా, ఫిక్స్డ్ రేటా, బేరమా?'), note: rider.note || null, seconds: 10, defaultId: 'meter',
    options: [
      { id: 'meter', label: T('Meter', 'మీటర్'), sub: 'Honest. Pay what it shows', tone: 'good' },
      { id: 'fixed', label: T(`Fixed ${rs(quote)}`, `ఫిక్స్డ్ ₹${quote}`), sub: 'One price, they may haggle' },
      { id: 'bargain', label: T('Bargain', 'బేరం'), sub: 'Name your own price', tone: 'risk' },
    ],
    onPick: (id) => {
      if (id === 'meter') {
        speak('meter');
        done({ mode: 'meter' });
      } else if (id === 'fixed') {
        speak('quote', { price: quote }, true);
        negotiate(startNegotiation(kind, ref, quote, rng()));
      } else {
        const asks = openingAsks(ref);
        const sub = { high: 'Greedy. They may refuse', fair: 'A fair start', low: 'They will love it' };
        const te = { high: 'ఎక్కువ', fair: 'సరైనది', low: 'తక్కువ' };
        choices.open({
          id: 'bargain', kind: 'bargain', title: T('Name your price', 'మీ రేటు చెప్పండి'), seconds: 8, defaultId: 'fair',
          options: asks.map((a) => ({ id: a.id, label: T(rs(a.price), `₹${a.price} ${te[a.id]}`), sub: sub[a.id], tone: a.id === 'high' ? 'risk' : a.id === 'low' ? 'good' : null })),
          onPick: (aid) => {
            const ask = asks.find((a) => a.id === aid) || asks[1];
            speak('ask', { price: ask.price }, true);
            negotiate(startNegotiation(kind, ref, ask.price, rng()));
          },
        });
      }
    },
  });
}

/**
 * Ask a small-talk question if it is a good moment. Returns true when one opened.
 * env: { ctx, choices, rng }; rider: { t, rd } with rd.talk = { used: [], left, count }; apply({ mood, grace, tipMul, reply })
 */
export function maybeTalk(env, rider, { urgentSoon = false } = {}, apply) {
  const { ctx, choices, rng } = env;
  const t = rider.t;
  const talk = pickTalk(t.kind, rider.rd.talk.used, Math.floor(rng() * 1000), { urgentSoon });
  if (!talk) return false;
  rider.rd.talk.used.push(talk.id);
  rider.rd.talk.count++;
  sayLine(ctx, { id: `fare:talk:${talk.id}`, speaker: t.name, kind: t.kind, line: talk.ask });
  choices.open({
    id: `talk:${talk.id}`, kind: 'talk', quiet: false, title: talk.ask, seconds: TALK.seconds,
    options: talk.options.map((o) => ({ id: o.id, label: o.label, sub: null })),
    onPick: (optId) => {
      const fx = talkEffect(talk.id, optId, t.kind);
      if (!fx) return;
      sayLine(ctx, { id: `fare:talkr:${talk.id}`, speaker: t.name, kind: t.kind, line: fx.reply });
      apply(fx);
    },
  });
  return true;
}
