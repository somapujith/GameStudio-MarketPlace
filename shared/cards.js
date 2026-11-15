// The two card decks (docs/HUSTLE_PLAN.md 3.3). Nawabi Luck (tiles 2, 21) is mostly good fortune, City Drama
// (tiles 12, 30) mostly expenses and obstructions. Each deck is shuffled with the game's seeded rng and reshuffled
// when it runs out. Card = one funny hook (`title`), one short sentence (`text`), one clear effect.
// Move targets never point at a card tile.
//
// effect types:
//   { type:'cash', amount }              +amount from the bank / -amount to the bank
//   { type:'moveTo', tile }              travel clockwise to `tile` (passing or landing on START pays the salary)
//   { type:'moveBy', n }                 n > 0 clockwise (salary applies), n < 0 backwards (never salary)
//   { type:'nextTransport' }             travel clockwise to the next Auto / Metro / MMTS stop
//   { type:'stuck' }                     stuck in traffic where you stand (like the Traffic Jam corner)
//   { type:'rentBoost', mult }           your rents x mult until your next turn begins
//   { type:'chai' }                      gain a chai token (nothing at the cap)
//   { type:'snatch', amount }            gain `amount` Snatch buttons, at most cfg.snatchCardCap from cards per game
//                                        (at the cap the card pays SNATCH_CAP_PAYOUT and shows its `capText`)
//   { type:'collectFromAll', amount }    every other active player pays you `amount`
//   { type:'payAll', amount }            you pay `amount` to every other active player
//   { type:'perLevel', amount }          pay `amount` for every upgrade level you own
//   { type:'perProperty', amount }       pay `amount` for every district you own

export const LUCK_CARDS = [
  { id: 'biryani_viral', kind: 'good', title: 'Biryani franchise goes viral',
    text: 'Your food business has a blockbuster weekend. Collect ₹80,000.', effect: { type: 'cash', amount: 80000 } },
  { id: 'investor', kind: 'good', title: 'An investor is impressed!',
    text: 'Your commercial empire attracts fresh capital. Collect ₹1,00,000.', effect: { type: 'cash', amount: 100000 } },
  { id: 'cricket_night', kind: 'good', title: 'Cricket night at Uppal!',
    text: 'Visitors flood the city: your rents are doubled until your next turn.', effect: { type: 'rentBoost', mult: 2 } },
  { id: 'metro_hitec', kind: 'neutral', title: 'Take the Metro to HITEC City',
    text: 'Advance to HITEC City. Pass START? Collect your salary.', effect: { type: 'moveTo', tile: 31 } },
  { id: 'free_chai', kind: 'good', title: 'Chai on the house',
    text: 'The Irani cafe owner knows your face. Take a free chai token.', effect: { type: 'chai' } },
  { id: 'birthday', kind: 'good', title: 'Happy birthday, boss!',
    text: 'Every player chips in for your cake. Collect ₹10,000 from each.', effect: { type: 'collectFromAll', amount: 10000 } },
  { id: 'haleem_season', kind: 'good', title: 'Haleem season rush',
    text: 'Your stall sells out every evening. Collect ₹60,000.', effect: { type: 'cash', amount: 60000 } },
  { id: 'film_shoot', kind: 'good', title: 'Lights, camera, your shop!',
    text: 'A Tollywood crew rents your shopfront for a song shoot. Collect ₹50,000.', effect: { type: 'cash', amount: 50000 } },
  { id: 'app_deal', kind: 'good', title: 'Side-hustle app gets funded',
    text: 'Your weekend coding project lands a seed cheque. Collect ₹75,000.', effect: { type: 'cash', amount: 75000 } },
  { id: 'go_start', kind: 'good', title: 'Namma Hyderabad calls you home',
    text: 'Advance to START and collect your ₹2,00,000.', effect: { type: 'moveTo', tile: 0 } },
  { id: 'auto_shortcut', kind: 'neutral', title: 'Auto anna knows a shortcut',
    text: '"Trust me, saab." Move forward 3 spaces.', effect: { type: 'moveBy', n: 3 } },
  { id: 'next_ride', kind: 'neutral', title: 'Catch the next ride',
    text: 'Advance to the next Auto, Metro or MMTS stop.', effect: { type: 'nextTransport' } },
  { id: 'pearl_deal', kind: 'good', title: 'Pearl deal of the decade',
    text: 'A wholesaler in the old city gives you a sweet bulk price. Collect ₹40,000.', effect: { type: 'cash', amount: 40000 } },
  { id: 'ghmc_rebate', kind: 'good', title: 'Early-bird rebate',
    text: 'You paid your dues on time for once. Collect ₹30,000.', effect: { type: 'cash', amount: 30000 } },
  { id: 'necklace_sunset', kind: 'neutral', title: 'Sunset stroll on Necklace Road',
    text: 'Advance to Necklace Road. Pass START? Collect your salary.', effect: { type: 'moveTo', tile: 22 } },
  { id: 'gachibowli_client', kind: 'neutral', title: 'Big client in Gachibowli',
    text: 'The meeting is at the stadium end. Advance to Gachibowli.', effect: { type: 'moveTo', tile: 33 } },
  { id: 'kirana_karma', kind: 'good', title: 'Kirana karma',
    text: 'Your old regulars send the whole colony to your shop. Collect ₹25,000.', effect: { type: 'cash', amount: 25000 } },
  { id: 'mall_draw', kind: 'good', title: 'Lucky draw winner!',
    text: 'Your mall coupon finally won something. Collect ₹45,000.', effect: { type: 'cash', amount: 45000 } },
  // Snatch cards (docs/GAME_RULES.md section 9): +1 Snatch button, at most cfg.snatchCardCap per player per game. A
  // player at the cap (or a game without Snatch) collects SNATCH_CAP_PAYOUT instead and the card shows `capText`.
  { id: 'snatch_tip', kind: 'good', title: 'Auction-house tip-off',
    text: 'A Begum Bazaar insider whispers a hot lead. Gain +1 Snatch button.', effect: { type: 'snatch', amount: 1 },
    capText: 'The insider has nothing new, so he sends ₹50,000 as thanks. No extra Snatch button.' },
  { id: 'snatch_haggle', kind: 'good', title: 'Haggle like a Laad Bazaar pro',
    text: 'Your bargaining is legendary. Gain +1 Snatch button.', effect: { type: 'snatch', amount: 1 },
    capText: 'Your bargaining is legendary, but your Snatch buttons are full. Collect ₹50,000 instead.' },
  { id: 'snatch_broker', kind: 'good', title: 'The broker saves your number',
    text: 'He promises you first call on the next hot deal. Gain +1 Snatch button.', effect: { type: 'snatch', amount: 1 },
    capText: 'The broker would help, but your Snatch buttons are full. Collect ₹50,000 instead.' },
];

/** What a Snatch card pays instead of a button when the player is at the card cap (or the game has no Snatch). */
export const SNATCH_CAP_PAYOUT = 50000;

export const DRAMA_CARDS = [
  { id: 'shaadi_season', kind: 'bad', title: 'Shaadi ka season!',
    text: 'Your cousin booked the biggest function hall in town. Pay ₹50,000.', effect: { type: 'cash', amount: -50000 } },
  { id: 'ameerpet_traffic', kind: 'bad', title: 'Ameerpet traffic. Baigan!',
    text: 'Your journey hits an unexpected standstill. You are stuck in traffic.', effect: { type: 'stuck' } },
  { id: 'landlord_advance', kind: 'bad', title: 'The landlord wants an advance',
    text: 'Your latest business deal comes with a surprise. Pay ₹35,000.', effect: { type: 'cash', amount: -35000 } },
  { id: 'monsoon_leaks', kind: 'bad', title: 'Monsoon leak repairs',
    text: 'Every roof you built needs patching. Pay ₹15,000 per upgrade you own.', effect: { type: 'perLevel', amount: 15000 } },
  { id: 'pothole', kind: 'bad', title: 'Pothole or swimming pool?',
    text: 'Your delivery bike found a crater. Pay ₹20,000 for repairs.', effect: { type: 'cash', amount: -20000 } },
  { id: 'challan_sms', kind: 'bad', title: 'Challan by SMS',
    text: 'The signal camera saw everything. Pay ₹25,000.', effect: { type: 'cash', amount: -25000 } },
  { id: 'power_cut', kind: 'bad', title: 'Power cut at peak hour',
    text: 'The generator diesel is on you. Pay ₹30,000.', effect: { type: 'cash', amount: -30000 } },
  { id: 'water_tanker', kind: 'bad', title: 'Tanker raj',
    text: 'The borewell dried up, so you book a water tanker. Pay ₹18,000.', effect: { type: 'cash', amount: -18000 } },
  { id: 'wrong_flyover', kind: 'bad', title: 'Wrong turn on the flyover',
    text: 'Google Maps said "slight left". Go back 3 spaces.', effect: { type: 'moveBy', n: -3 } },
  { id: 'chai_round', kind: 'bad', title: 'Chai round is on you',
    text: 'The whole adda is watching. Pay ₹10,000 to every player.', effect: { type: 'payAll', amount: 10000 } },
  { id: 'inspection', kind: 'bad', title: 'Surprise inspection',
    text: 'The paperwork needs a fresh stamp. Pay ₹40,000.', effect: { type: 'cash', amount: -40000 } },
  { id: 'municipal_summons', kind: 'bad', title: 'Summoned to the municipal office',
    text: 'Bring every file you have. Advance to Municipal Charges.', effect: { type: 'moveTo', tile: 27 } },
  { id: 'matchday_jam', kind: 'bad', title: 'Match-day jam',
    text: 'The whole city is driving to the stadium. You are stuck in traffic.', effect: { type: 'stuck' } },
  { id: 'honest_auto', kind: 'bad', title: 'Phone left in the auto',
    text: 'An honest auto anna brings it back. Tip him ₹10,000.', effect: { type: 'cash', amount: -10000 } },
  { id: 'biryani_queue', kind: 'bad', title: 'Lost in the biryani queue',
    text: 'Lunch took two hours. Go back 2 spaces.', effect: { type: 'moveBy', n: -2 } },
  { id: 'property_notice', kind: 'bad', title: 'Property tax notice',
    text: 'The city counted your districts. Pay ₹8,000 for each one you own.', effect: { type: 'perProperty', amount: 8000 } },
  { id: 'catering_order', kind: 'good', title: 'Surprise catering order',
    text: 'A wedding party orders 500 plates from your kitchen. Collect ₹50,000.', effect: { type: 'cash', amount: 50000 } },
  { id: 'festival_crowd', kind: 'good', title: 'Festival crowds at your door',
    text: 'The festive streets are full of shoppers. Collect ₹35,000.', effect: { type: 'cash', amount: 35000 } },
];

export const DECKS = Object.freeze({ luck: LUCK_CARDS, drama: DRAMA_CARDS });

/** Human name of a deck. */
export const DECK_NAMES = Object.freeze({ luck: 'Nawabi Luck', drama: 'City Drama' });

export const cardById = (id) => LUCK_CARDS.find((c) => c.id === id) || DRAMA_CARDS.find((c) => c.id === id) || null;
