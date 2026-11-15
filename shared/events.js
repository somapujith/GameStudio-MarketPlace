// City events, "Hyderabad Rush Hour" (docs/HUSTLE_PLAN.md 3.6). When the round number becomes a multiple of
// `cfg.eventEvery` (host rule, default EVENT_EVERY = 3: 3, 6, 9, ...; never round 1; 0 = no city events) one event is drawn
// with the game's seeded rng. It lasts that round and is
// public in `state.event`. Rent effects are applied by the engine's rent calculation, so previewRent and the UI agree.
//
//   kind     'rent' (changes what districts ask) or 'cash' (a one-off payment at the start of the round)
//   pick     'owned' -> the draw picks one collection (preferring ones somebody owns) into `state.event.group`
//   groups   fixed collections the event concerns
//   mult     rent multiplier; `upgradedOnly` = only tiles at level >= 1
//   amount   signed cash per active player (+ receives, - pays); `bonus` = paid to owners per upgraded tile in `groups`

export const EVENT_EVERY = 3;

export const CITY_EVENTS = [
  { id: 'rush_hour', title: 'Hyderabad Rush Hour', text: 'One collection is booming: its districts pay 1.5x rent this round.',
    kind: 'rent', pick: 'owned', mult: 1.5 },
  { id: 'biryani_boom', title: 'Biryani Business Boom', text: 'Food festival! Upgraded Old City and Everyday Hyderabad districts pay double rent this round.',
    kind: 'rent', groups: ['oldcity', 'everyday'], mult: 2, upgradedOnly: true },
  { id: 'wedding_season', title: 'Wedding Season', text: 'Every player pays ₹30,000 for family functions; each upgraded Lake & Leisure or Luxury venue earns its owner ₹20,000.',
    kind: 'cash', groups: ['lake', 'luxury'], amount: -30000, bonus: 20000 },
  { id: 'festival', title: 'Festive Bonus', text: 'The city celebrates together: every player receives ₹50,000.',
    kind: 'cash', amount: 50000 },
  { id: 'monsoon', title: 'Monsoon Showers', text: 'Heavy rain keeps shoppers home: one collection pays half rent this round.',
    kind: 'rent', pick: 'owned', mult: 0.5 },
];

/** Rush-hour flavour per collection (the drawn group decides the title and text). */
export const RUSH_FLAVOUR = {
  bazaar: { title: 'Rush Hour: Bazaar bargain day', text: 'Shoppers pack the bazaars: Bazaar Beginnings pays 1.5x rent this round.' },
  oldcity: { title: 'Rush Hour: Old City shopping', text: 'Tourists crowd the Old City lanes: Old City Icons pays 1.5x rent this round.' },
  everyday: { title: 'Rush Hour: Office-lunch stampede', text: 'Everybody is hungry at once: Everyday Hyderabad pays 1.5x rent this round.' },
  twin: { title: 'Rush Hour: Twin Cities commute', text: 'Trains and buses unload at the crossroads: Twin Cities pays 1.5x rent this round.' },
  lake: { title: 'Rush Hour: Lakefront visitors', text: 'The lake is the place to be: Lake & Leisure pays 1.5x rent this round.' },
  luxury: { title: 'Rush Hour: Cricket crowds', text: 'Fans party before the big match: Lights, Camera, Luxury pays 1.5x rent this round.' },
  cyber: { title: 'Rush Hour: Cyberabad office traffic', text: 'Every campus is full: Cyberabad pays 1.5x rent this round.' },
  newcity: { title: 'Rush Hour: New City launch week', text: 'Corporate launches all week: The New City pays 1.5x rent this round.' },
};

/** Monsoon flavour line per collection. */
export const MONSOON_TEXT = (name) => `Heavy rain keeps shoppers home: ${name} pays half rent this round.`;

/** Festival variants: picked at random, always the same festive, respectful wording. */
export const FESTIVALS = [
  { title: 'Bonalu festive bonus', text: 'The city celebrates Bonalu together: every player receives ₹50,000.' },
  { title: 'Bathukamma festive bonus', text: 'Flowers and songs fill the city for Bathukamma: every player receives ₹50,000.' },
  { title: 'Eid festive bonus', text: 'Eid Mubarak! The city shares sheer khurma and good cheer: every player receives ₹50,000.' },
];

export const cityEventById = (id) => CITY_EVENTS.find((e) => e.id === id) || null;
