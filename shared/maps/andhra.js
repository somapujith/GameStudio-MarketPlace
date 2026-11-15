// The "Andhra Aatalu" map skin (design: Andhra_Empire_Game_Concept.md). Pure data, NO imports: shared/cards.js reads the
// card list from here (so `cardById` finds Andhra cards) and shared/maps.js wraps it into MAPS.andhra.
//
// It is a SKIN on the unchanged Hustle board. Same 36 tiles, same ids, same per-slot price ladder, same rent / upgrade
// constants, same engine. Only names, lore, colours, level names, decks and city-event wording change. The 24 districts
// are the concept's 24 destinations, redistributed over the eight collections of the concept's collections table and
// placed on the board's group slots in ascending price order. Group ids ('bazaar' ... 'newcity') are structural and
// stay the same on every map, so for Andhra `GROUPS.oldcity` means "Andhra Crafts", and so on (see ANDHRA_GROUPS).
//
// Heritage rule (concept section 3): for historical, cultural and religious destinations the thing bought is a FICTIONAL
// local business, never the landmark, temple or heritage site. The lore lines say so where it matters.

// ---------------------------------------------------------------------------------------------------------------------
// Groups: id (slot) -> collection. Colours come from the concept's palette (deep indigo, terracotta, turmeric yellow, river
// green, coastal blue, antique cream) and every ink is AA (4.5:1) on its colour (checked in shared/maps.test.js).
// ---------------------------------------------------------------------------------------------------------------------
export const ANDHRA_GROUPS = {
  bazaar: { name: 'Towns & Markets', color: '#b9835a', ink: '#1f1100', identity: 'Affordable first investments: busy town markets, quick buys and early rent.',
    levelNames: ['Market Stall', 'Provision Shop', 'Wholesale Mandi'] },
  oldcity: { name: 'Andhra Crafts', color: '#4fb3d9', ink: '#03202f', identity: 'Handloom, toys and Kalamkari: craft towns that shine at festival time.',
    levelNames: ['Craft Corner', 'Handloom Showroom', 'Artisan Emporium'] },
  everyday: { name: 'Godavari Gold', color: '#3f9e6a', ink: '#03210f', identity: 'Rice, coconut and sweets from the river delta: steady neighbourhood trade.',
    levelNames: ['Coconut Stall', 'Rice Mill', 'Agro Export Hub'] },
  twin: { name: 'Uttarandhra', te: 'ఉత్తరాంధ్ర', color: '#4a4fb5', ink: '#ffffff', identity: 'Ports, beaches and coastal trade on the north-east shore.',
    levelNames: ['Seafood Stall', 'Beach Cafe', 'Harbour Logistics Hub'] },
  lake: { name: 'Nature & Heritage', color: '#f08a24', ink: '#2a1400', identity: 'Hills, valleys and heritage towns: tourism and seasonal visitors.',
    levelNames: ['Coffee Kiosk', 'Homestay', 'Heritage Resort'] },
  luxury: { name: 'Rayalaseema', te: 'రాయలసీమ', color: '#bf4a32', ink: '#ffffff', identity: 'Cotton, groundnut and solar: big businesses on the dry plains and costly upgrades.',
    levelNames: ['Groundnut Stall', 'Cotton Yard', 'Agro-Industrial Park'] },
  cyber: { name: 'Spiritual Andhra', color: '#e8b923', ink: '#2a1f00', identity: 'Pilgrim towns: lodges, sweets and crowds at festival time.',
    levelNames: ['Prasadam Stall', 'Pilgrim Lodge', 'Pilgrim Hospitality Hub'] },
  newcity: { name: 'Capital & Commerce', color: '#1f4fa3', ink: '#ffffff', identity: 'Highest entry cost, highest rents: the chilli capital and the new skyline.',
    levelNames: ['Co-working Desk', 'Corporate Office', 'Capital Tower'] },
};

// ---------------------------------------------------------------------------------------------------------------------
// Tiles. Keys are the tile ids of shared/board.js. Properties: [name, short (<= 14 chars, fits a tile), te, lore].
// Prices are NOT here: they stay on the board (same per-slot ladder as the Hyderabad map).
// ---------------------------------------------------------------------------------------------------------------------
const prop = (name, short, te, lore) => ({ name, short, te, lore });

export const ANDHRA_TILES = {
  0: { name: 'START — Andhra Yatra', short: 'START', te: 'ఆంధ్ర యాత్ర', emoji: '🏁',
    lore: 'Every journey across Andhra starts here. Pass or land on START to collect your salary.' },

  // ---- Towns & Markets
  1: prop('Chirala', 'Chirala', 'చీరాల', 'A fictional handloom-and-sea-salt trading counter in the busy coastal market lanes.'),
  2: { name: 'Mana Adrushtam', short: 'Mana Adrushtam', te: 'మన అదృష్టం', emoji: '🍀',
    lore: 'Draw a Mana Adrushtam card: our luck, our fortune.' },
  3: prop('Ongole', 'Ongole', 'ఒంగోలు', 'A fictional feed-and-grain depot at the cattle fair, where the bulls are proud and the bargains are loud.'),
  4: prop('Nellore', 'Nellore', 'నెల్లూరు', 'A fictional rice-and-shrimp wholesale counter where the trucks queue before dawn.'),
  5: { name: 'Visakhapatnam Port', short: 'Vizag Port', emoji: '🚢',
    lore: 'All aboard at the port! The next ride sails to Vijayawada Junction. The fare is fair, the sea breeze is free.' },

  // ---- Andhra Crafts
  6: prop('Kondapalli', 'Kondapalli', 'కొండపల్లి', 'A fictional wooden-toy workshop where little painted elephants line up for the festival rush.'),
  7: prop('Machilipatnam', 'Machilipatnam', 'మచిలీపట్నం', 'A fictional Kalamkari print studio, where every block-printed border takes a patient hand.'),
  8: prop('Mangalagiri', 'Mangalagiri', 'మంగళగిరి', 'A fictional handloom showroom known for crisp cotton sarees and bright zari borders.'),
  9: { name: 'Traffic Jam', short: 'Traffic Jam', emoji: '🚦',
    lore: 'Horns, heat and zero movement on the highway. Stuck here: pay the fine, spend a festival token, or wait a turn.' },

  // ---- Godavari Gold
  10: prop('Amalapuram', 'Amalapuram', 'అమలాపురం', 'A fictional coconut-grove produce stand beside the green Konaseema backwaters.'),
  11: prop('Kakinada', 'Kakinada', 'కాకినాడ', 'A fictional port-side export counter, with a sweet shop next door for the long waits.'),
  12: { name: 'Oori Kaburlu', short: 'Oori Kaburlu', te: 'ఊరి కబుర్లు', emoji: '🗣️',
    lore: 'Draw an Oori Kaburlu card: the village gossip always has a twist.' },
  13: prop('Rajamahendravaram', 'Rajahmundry', 'రాజమహేంద్రవరం', 'A fictional riverside spice-and-sweets market on the banks of the mighty Godavari.'),
  14: { name: 'Vijayawada Junction', short: 'Rail Junction', emoji: '🚉',
    lore: 'Change here for Tirupati Airport. Platforms packed, chai hot, trains slightly late.' },

  // ---- Uttarandhra
  15: prop('Srikakulam', 'Srikakulam', 'శ్రీకాకుళం', 'A fictional cashew-and-coast trading stall in the far north-eastern corner of the state.'),
  16: prop('Vizianagaram', 'Vizianagaram', 'విజయనగరం', 'A fictional musical-instrument showroom in the old fort town, where every veena is tuned by ear.'),
  17: prop('Visakhapatnam', 'Vizag', 'విశాఖపట్నం', 'A fictional harbour-side logistics hub where the beach breeze meets the cargo cranes.'),
  18: { name: 'Sankranti Fair', short: 'Sankranti Fair', te: 'సంక్రాంతి జాతర', emoji: '🪁',
    lore: 'Kites, kolams and sweet pongal. Take a festival token: it halves your next big rent.' },

  // ---- Nature & Heritage
  19: prop('Araku Valley', 'Araku Valley', 'అరకు లోయ', 'A fictional hill-top coffee kiosk with misty views over the valley.'),
  20: prop('Lepakshi', 'Lepakshi', 'లేపాక్షి', 'A fictional handicrafts emporium for visitors to the old temple town; the heritage itself belongs to everyone.'),
  21: { name: 'Mana Adrushtam', short: 'Mana Adrushtam', te: 'మన అదృష్టం', emoji: '🍀',
    lore: 'Draw a Mana Adrushtam card: our luck, our fortune.' },
  22: prop('Gandikota', 'Gandikota', 'గండికోట', 'A fictional canyon-view homestay; the gorge and the old fort belong to nature and history, not to you.'),
  23: { name: 'Tirupati Airport', short: 'Airport', emoji: '✈️',
    lore: 'The flight loops you past START to Visakhapatnam Port. Salary on the way!' },

  // ---- Rayalaseema
  24: prop('Kadapa', 'Kadapa', 'కడప', 'A fictional stone-slab and limestone yard on the dry, sunny plains.'),
  25: prop('Anantapur', 'Anantapur', 'అనంతపురం', 'A fictional groundnut-oil mill, where the wind turbines turn on the horizon.'),
  26: prop('Kurnool', 'Kurnool', 'కర్నూలు', 'A fictional agro-park for onions, cotton and solar power on the banks of the Tungabhadra.'),
  27: { name: 'Road Toll', short: 'Road Toll', emoji: '🛣️',
    lore: 'The state collects its road toll, plus a festival contribution for every upgrade you own.' },

  // ---- Spiritual Andhra
  28: prop('Srikalahasti', 'Srikalahasti', 'శ్రీకాళహస్తి', 'A fictional pilgrim snack-and-lodging counter; the temple itself belongs to everyone.'),
  29: prop('Srisailam', 'Srisailam', 'శ్రీశైలం', 'A fictional forest-hill guesthouse near the dam and the tiger reserve; the shrine stays sacred.'),
  30: { name: 'Oori Kaburlu', short: 'Oori Kaburlu', te: 'ఊరి కబుర్లు', emoji: '🗣️',
    lore: 'Draw an Oori Kaburlu card: the village gossip always has a twist.' },
  31: prop('Tirupati', 'Tirupati', 'తిరుపతి', 'A fictional pilgrim-hospitality lodge and sweet counter at the foot of the hills; the temple itself belongs to everyone.'),
  32: { name: 'Mirchi Market Auction', short: 'Auction', emoji: '🌶️',
    lore: 'A random unowned district goes under the hammer in the Guntur chilli yard. Minimum bid: half its price.' },

  // ---- Capital & Commerce
  33: prop('Guntur', 'Guntur', 'గుంటూరు', 'A fictional chilli-trading house in the spice capital of the state. Handle with watery eyes.'),
  34: prop('Vijayawada', 'Vijayawada', 'విజయవాడ', 'A fictional riverside business centre on the Krishna, as busy as the barrage at flood time.'),
  35: prop('Amaravati', 'Amaravati', 'అమరావతి', 'A fictional skyline campus in the new capital. The priciest address on the board.'),
};

// Phone-board label lines (the printed face of a tile: at most two lines of at most 9 characters, a real hyphen where a name
// is split at a syllable). Optional: `labelLines` of src/components/game/tileLabel.js may prefer `tile.lines` over its own splitter.
const LINES = {
  7: ['Machili-', 'patnam'], 8: ['Mangala-', 'giri'], 13: ['Rajah-', 'mundry'], 16: ['Viziana-', 'garam'], 18: ['Sankranti', 'Fair'],
  20: ['Lepak-', 'shi'], 28: ['Srikala-', 'hasti'], 29: ['Sri-', 'sailam'], 34: ['Vijaya-', 'wada'],
};
for (const [id, lines] of Object.entries(LINES)) ANDHRA_TILES[id].lines = lines;

// ---------------------------------------------------------------------------------------------------------------------
// Terms: the words the engine, the rules sheet and the UI use for the board's special things.
// ---------------------------------------------------------------------------------------------------------------------
export const ANDHRA_TERMS = {
  chai: 'festival token', // "You can only use festival token before rolling" is built as `use ${chaiUse}`
  chaiUse: 'a festival token',
  chaiToken: 'festival token',
  chaiTokens: 'festival tokens',
  chaiCorner: 'Sankranti Fair', // tile 18
  trafficCorner: 'Traffic Jam', // tile 9
  municipalCorner: 'Road Toll', // tile 27
  auctionTile: 'Mirchi Market Auction', // tile 32
  startCorner: 'Andhra Yatra', // tile 0
  transportStops: 'Port, Junction or Airport', // "advance to the next Port, Junction or Airport"
  place: 'Andhra', // "the richest in Andhra", "Rolling through Andhra"
};

// ---------------------------------------------------------------------------------------------------------------------
// Decks. Concept section 8 (Mana Adrushtam) and 9 (Oori Kaburlu), 10 + 10 cards, mapped onto the engine's EXISTING effect
// kinds (see shared/cards.js) and topped up to the same deck size and balance as the Hyderabad decks (21 luck incl. three
// Snatch cards, 18 drama with two good ones). Cards of the concept that have no engine analogue use the nearest effect:
//   Sankranti Homecoming  "double one transport rent"        -> rentBoost x2 (your rents are doubled until your next turn)
//   Smart Investment      "-40,000 on one future upgrade"    -> cash +40,000
//   Business Expansion    1,25,000 -> 1,00,000 (the Hyderabad luck deck pays at most 1,00,000 a card)
//   Power Cut!            "forgo your next rent collection"  -> pay 30,000
// ---------------------------------------------------------------------------------------------------------------------
export const ANDHRA_LUCK_CARDS = [
  // --- the concept's ten
  { id: 'an_sankranti_bonus', kind: 'good', title: 'Sankranti Bonus', te: 'సంక్రాంతి బోనస్',
    text: 'Your seasonal business is booming! Collect ₹75,000.', effect: { type: 'cash', amount: 75000 } },
  { id: 'an_mirchi_up', kind: 'good', title: 'Mirchi Rates Up!',
    text: 'Guntur chilli prices have risen. Collect ₹50,000.', effect: { type: 'cash', amount: 50000 } },
  { id: 'an_blockbuster', kind: 'good', title: 'Cinema Blockbuster',
    text: 'Your film investment is a hit. Collect ₹1,00,000.', effect: { type: 'cash', amount: 100000 } },
  { id: 'an_konaseema', kind: 'good', title: 'Konaseema Tourism',
    text: 'Your homestay had a great season. Collect ₹60,000.', effect: { type: 'cash', amount: 60000 } },
  { id: 'an_expansion', kind: 'good', title: 'Business Expansion',
    text: 'Your startup has attracted investment. Collect ₹1,00,000.', effect: { type: 'cash', amount: 100000 } },
  { id: 'an_export', kind: 'good', title: 'Export Success',
    text: 'Your coastal trading business found a new market. Collect ₹80,000.', effect: { type: 'cash', amount: 80000 } },
  { id: 'an_bommala', kind: 'good', title: 'Bommala Bazaar',
    text: 'Your craft collection is in demand. Collect ₹40,000.', effect: { type: 'cash', amount: 40000 } },
  { id: 'an_homecoming', kind: 'good', title: 'Sankranti Homecoming',
    text: 'Travel demand has increased: your rents are doubled until your next turn.', effect: { type: 'rentBoost', mult: 2 } },
  { id: 'an_fast_highway', kind: 'neutral', title: 'Fast Highway',
    text: 'Your trip is ahead of schedule. Advance to the next Port, Junction or Airport.', effect: { type: 'nextTransport' } },
  { id: 'an_smart_investment', kind: 'good', title: 'Smart Investment',
    text: 'Your business has become more efficient. Collect ₹40,000.', effect: { type: 'cash', amount: 40000 } },
  // --- top-up: moderate payouts, tactical movement, one rare strong effect (a free festival token)
  { id: 'an_free_token', kind: 'good', title: 'Festival token from the fair',
    text: 'The fair organiser knows your face. Take a free festival token.', effect: { type: 'chai' } },
  { id: 'an_wedding_gifts', kind: 'good', title: 'Wedding gifts all round',
    text: 'Every player chips in for your big day. Collect ₹10,000 from each.', effect: { type: 'collectFromAll', amount: 10000 } },
  { id: 'an_yatra_calls', kind: 'good', title: 'Andhra Yatra calls you home',
    text: 'Advance to START and collect your salary.', effect: { type: 'moveTo', tile: 0 } },
  { id: 'an_pilgrim_trip', kind: 'neutral', title: 'A pilgrim trip to Tirupati',
    text: 'The hills are calling. Advance to Tirupati. Pass START? Collect your salary.', effect: { type: 'moveTo', tile: 31 } },
  { id: 'an_araku_coffee', kind: 'neutral', title: 'Coffee meeting in Araku',
    text: 'A buyer wants to meet in the hills. Advance to Araku Valley. Pass START? Collect your salary.', effect: { type: 'moveTo', tile: 19 } },
  { id: 'an_bullock_cart', kind: 'neutral', title: 'A lift on the harvest cart',
    text: '"Hop on, babu." Move forward 3 spaces.', effect: { type: 'moveBy', n: 3 } },
  { id: 'an_pongal_rebate', kind: 'good', title: 'Pongal early-bird rebate',
    text: 'You paid your dues before the festival for once. Collect ₹25,000.', effect: { type: 'cash', amount: 25000 } },
  { id: 'an_capital_expo', kind: 'neutral', title: 'Invitation to the capital expo',
    text: 'A big client meets you at the new skyline. Advance to Amaravati. Pass START? Collect your salary.', effect: { type: 'moveTo', tile: 35 } },
  // --- Snatch cards (same count and cap rules as the Hyderabad deck): +1 Snatch button, at most cfg.snatchCardCap per player
  { id: 'an_snatch_tip', kind: 'good', title: 'Mirchi-yard tip-off',
    text: 'A Guntur yard broker whispers a hot lead. Gain +1 Snatch button.', effect: { type: 'snatch', amount: 1 },
    capText: 'The broker has nothing new, so he sends ₹50,000 as thanks. No extra Snatch button.' },
  { id: 'an_snatch_haggle', kind: 'good', title: 'Haggle like a Machilipatnam trader',
    text: 'Your bargaining is legendary. Gain +1 Snatch button.', effect: { type: 'snatch', amount: 1 },
    capText: 'Your bargaining is legendary, but your Snatch buttons are full. Collect ₹50,000 instead.' },
  { id: 'an_snatch_agent', kind: 'good', title: 'The agent saves your number',
    text: 'He promises you first call on the next hot deal. Gain +1 Snatch button.', effect: { type: 'snatch', amount: 1 },
    capText: 'The agent would help, but your Snatch buttons are full. Collect ₹50,000 instead.' },
];

export const ANDHRA_DRAMA_CARDS = [
  // --- the concept's ten
  { id: 'an_traffic_baboi', kind: 'bad', title: 'Traffic, Baboi!',
    text: 'Vijayawada traffic strikes again. You are stuck in traffic.', effect: { type: 'stuck' } },
  { id: 'an_pelliki_pilicharu', kind: 'bad', title: 'Pelliki Pilicharu!',
    text: 'Your relative\'s wedding is today. Pay ₹40,000.', effect: { type: 'cash', amount: -40000 } },
  { id: 'an_mirchi_down', kind: 'bad', title: 'Mirchi Rates Down',
    text: 'The chilli market is struggling. Pay ₹30,000.', effect: { type: 'cash', amount: -30000 } },
  { id: 'an_power_cut', kind: 'bad', title: 'Power Cut!',
    text: 'Your business closes early today and the generator diesel is on you. Pay ₹30,000.', effect: { type: 'cash', amount: -30000 } },
  { id: 'an_repairs', kind: 'bad', title: 'Unexpected Repairs',
    text: 'Your commercial building needs work. Pay ₹25,000.', effect: { type: 'cash', amount: -25000 } },
  { id: 'an_rainy_day', kind: 'bad', title: 'Rainy Day',
    text: 'Heavy rain interrupts travel plans. Move back 3 spaces.', effect: { type: 'moveBy', n: -3 } },
  { id: 'an_last_minute_booking', kind: 'good', title: 'Last-Minute Booking',
    text: 'A tourist group wants your resort. Collect ₹50,000.', effect: { type: 'cash', amount: 50000 } },
  { id: 'an_family_guests', kind: 'bad', title: 'Extra Family Guests',
    text: 'The relatives have arrived! Pay ₹20,000.', effect: { type: 'cash', amount: -20000 } },
  { id: 'an_movie_shoot', kind: 'good', title: 'Movie Shoot!',
    text: 'A film production is using your location. Collect ₹70,000.', effect: { type: 'cash', amount: 70000 } },
  { id: 'an_land_deal', kind: 'bad', title: 'Land Deal Gone Wrong',
    text: 'Your paperwork requires corrections. Pay ₹35,000.', effect: { type: 'cash', amount: -35000 } },
  // --- top-up: expenses and obstructions (the concept asks for no all-positive outcomes)
  { id: 'an_road_block', kind: 'bad', title: 'Road block on the highway',
    text: 'A procession has closed the road. You are stuck in traffic.', effect: { type: 'stuck' } },
  { id: 'an_cyclone_repairs', kind: 'bad', title: 'Cyclone repair bills',
    text: 'The storm tore every roof you built. Pay ₹15,000 per upgrade you own.', effect: { type: 'perLevel', amount: 15000 } },
  { id: 'an_survey_fee', kind: 'bad', title: 'Land survey fee',
    text: 'The revenue office counted your districts. Pay ₹8,000 for each one you own.', effect: { type: 'perProperty', amount: 8000 } },
  { id: 'an_pongal_feast', kind: 'bad', title: 'The Pongal feast is on you',
    text: 'The whole street is invited. Pay ₹10,000 to every player.', effect: { type: 'payAll', amount: 10000 } },
  { id: 'an_ferry_queue', kind: 'bad', title: 'Lost in the ferry queue',
    text: 'The Godavari crossing took two hours. Go back 2 spaces.', effect: { type: 'moveBy', n: -2 } },
  { id: 'an_toll_summons', kind: 'bad', title: 'Summoned to the toll office',
    text: 'Bring every receipt you have. Advance to Road Toll.', effect: { type: 'moveTo', tile: 27 } },
  { id: 'an_licence_check', kind: 'bad', title: 'Surprise licence inspection',
    text: 'The paperwork needs a fresh stamp. Pay ₹40,000.', effect: { type: 'cash', amount: -40000 } },
  { id: 'an_water_tanker', kind: 'bad', title: 'Dry-season tanker',
    text: 'The borewell dried up, so you book a water tanker. Pay ₹18,000.', effect: { type: 'cash', amount: -18000 } },
];

// ---------------------------------------------------------------------------------------------------------------------
// City events: the SAME events as the Hyderabad map (same ids, kinds, groups, multipliers and amounts; the engine keys on
// the id), with Andhra wording. `groups` are slot ids: oldcity = Andhra Crafts, everyday = Godavari Gold, lake = Nature
// & Heritage, luxury = Rayalaseema. Mapping to the concept: rush_hour = a regional boom (Coastal Trade, Tourism ...),
// biryani_boom = Sankranti Boom, wedding_season = Tourism Season, festival = festive bonus, monsoon = Mirchi Market Swing.
// ---------------------------------------------------------------------------------------------------------------------
export const ANDHRA_EVENTS = {
  list: [
    { id: 'rush_hour', title: 'Andhra Business Boom', text: 'The state is buzzing: one collection is booming and its districts pay 1.5x rent this round.',
      kind: 'rent', pick: 'owned', mult: 1.5 },
    { id: 'biryani_boom', title: 'Sankranti Boom', text: 'Sankranti shopping! Upgraded Andhra Crafts and Godavari Gold businesses pay double rent this round.',
      kind: 'rent', groups: ['oldcity', 'everyday'], mult: 2, upgradedOnly: true },
    { id: 'wedding_season', title: 'Tourism Season', text: 'Peak travel season: every player pays ₹30,000 for trips and festival spending; each upgraded Nature & Heritage or Rayalaseema business earns its owner ₹20,000.',
      kind: 'cash', groups: ['lake', 'luxury'], amount: -30000, bonus: 20000 },
    { id: 'festival', title: 'Festive Bonus', text: 'The state celebrates together: every player receives ₹50,000.',
      kind: 'cash', amount: 50000 },
    { id: 'monsoon', title: 'Mirchi Market Swing', text: 'The chilli market swings down and wallets close: one collection pays half rent this round.',
      kind: 'rent', pick: 'owned', mult: 0.5 },
  ],
  rush: {
    bazaar: { title: 'Boom: Weekly market day', text: 'Market day fills the town squares: Towns & Markets pays 1.5x rent this round.' },
    oldcity: { title: 'Boom: Craft fair weekend', text: 'Collectors crowd the workshops: Andhra Crafts pays 1.5x rent this round.' },
    everyday: { title: 'Boom: Harvest season', text: 'Fresh paddy and coconut hit the mandis: Godavari Gold pays 1.5x rent this round.' },
    twin: { title: 'Boom: Coastal Trade', text: 'Export orders pour into the ports: Uttarandhra pays 1.5x rent this round.' },
    lake: { title: 'Boom: Tourism Season', text: 'Hill and heritage visitors arrive in busloads: Nature & Heritage pays 1.5x rent this round.' },
    luxury: { title: 'Boom: Cotton harvest', text: 'Cotton and groundnut buyers fill the yards: Rayalaseema pays 1.5x rent this round.' },
    cyber: { title: 'Boom: Pilgrim season', text: 'Pilgrim crowds fill every lodge: Spiritual Andhra pays 1.5x rent this round.' },
    newcity: { title: 'Boom: Capital expo', text: 'Investors and delegates swarm the capital: Capital & Commerce pays 1.5x rent this round.' },
  },
  monsoon: 'Chilli prices crash and wallets close: {group} pays half rent this round.',
  festivals: [
    { title: 'Sankranti festive bonus', text: 'Kites fill the sky and sweets are shared at Sankranti: every player receives ₹50,000.' },
    { title: 'Ugadi festive bonus', text: 'A new year begins with ugadi pachadi and good cheer: every player receives ₹50,000.' },
    { title: 'Dasara festive bonus', text: 'The streets glow for Dasara: every player receives ₹50,000.' },
  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// The map card: names, palette, pieces
// ---------------------------------------------------------------------------------------------------------------------
export const ANDHRA_INFO = {
  id: 'andhra',
  name: 'Andhra Aatalu',
  te: 'ఆంధ్ర ఆటలు',
  tagline: 'Ooru Needhe. Business Needhe. Rajyam Needhe!',
  blurb: 'Buy, build and trade from the beaches of Visakhapatnam to the hills of Araku, the chilli yards of Guntur and the fort towns of Rayalaseema, while festivals, tourism and trade change your plans.',
  // The concept's palette (section 11).
  palette: {
    primary: '#2b2f77', // deep indigo
    secondary: '#c8553d', // terracotta red
    accent: '#e8a317', // turmeric yellow
    green: '#2e8b57', // river green
    blue: '#1e88c7', // coastal blue
    paper: '#f6ecd2', // antique cream
  },
  // The concept's token ideas (section 10), one per playable piece id (shared/pieces.js).
  pieceNames: {
    pearl: 'Mango',
    auto: 'Fishing boat',
    handi: 'Red chilli',
    chai: 'Kondapalli elephant',
    bat: 'Veena',
    camera: 'Sankranti kite',
  },
};
