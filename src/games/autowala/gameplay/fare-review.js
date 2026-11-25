// Wrong route and reviews. Pure.
//   detourStage: how far past the shortest road route has the driver gone (0 fine, 1 grumble, 2 furious)?
//   makeReview:  a 1-5 star review with a one-line comment (English + Telugu) from what happened on the ride.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const ROUTE = {
  checkEvery: 3, // seconds between route checks
  minDriven: 90, // do not judge before the auto has gone this far
  t1: 0.3, // first complaint when the detour passes 30% of the ideal route ...
  t1Min: 140, // ... and at least this many metres
  t2: 0.7,
  t2Min: 320,
  fareMul1: 0.96,
  fareMul2: 0.9,
  mood1: 0.07,
  mood2: 0.13,
  graceM: 150, // "take the shortcut?" yes: allowance in metres
};

/** How touchy each kind is about the way. */
export const ROUTE_SENS = { regular: 1, rusher: 1.5, elder: 1.1, women: 1.2, tourist: 1.1, student: 0.7 };

/** The detour in metres: the route the auto has actually followed plus what is left, minus the ideal. */
export const detourOf = (driven, driven0, remaining, ideal) => driven - driven0 + remaining - ideal;

/** 0 / 1 / 2 for a detour (metres) on a ride whose ideal road length is `ideal`; `grace` metres of allowance (a shortcut they asked for). */
export function detourStage(detour, ideal, grace = 0) {
  const d = detour - grace;
  if (d > Math.max(ROUTE.t2Min, ideal * ROUTE.t2)) return 2;
  if (d > Math.max(ROUTE.t1Min, ideal * ROUTE.t1)) return 1;
  return 0;
}

/** What the stage costs: { mood (negative), fareMul } for a kind. */
export function complaintEffect(stage, kind) {
  const s = ROUTE_SENS[kind] ?? 1;
  if (stage >= 2) return { mood: -ROUTE.mood2 * s, fareMul: ROUTE.fareMul2 };
  if (stage === 1) return { mood: -ROUTE.mood1 * s, fareMul: ROUTE.fareMul1 };
  return { mood: 0, fareMul: 1 };
}

const R = (en, te) => ({ en, te });
export const REVIEWS = {
  5: [R('Smooth ride, super driver!', 'సూపర్ డ్రైవర్, రైడ్ చాలా స్మూత్!'), R('Safe and quick. Five stars!', 'సేఫ్‌గా, త్వరగా వచ్చాం. ఐదు స్టార్లు!'), R('Best auto in Hyderabad.', 'హైదరాబాద్‌లో బెస్ట్ ఆటో.')],
  4: [R('Good ride, thank you.', 'మంచి రైడ్, థాంక్స్.'), R('Nice driver, a few bumps.', 'మంచి డ్రైవర్, కొన్ని కుదుపులు.'), R('Reached fine. Would ride again.', 'బాగా చేరాం. మళ్ళీ ఎక్కుతా.')],
  3: [R('Okay. Nothing special.', 'పర్వాలేదు. ప్రత్యేకం ఏమీ లేదు.'), R('Average ride.', 'సాధారణ రైడ్.')],
  2: [R('Too rough for me.', 'నాకు చాలా కుదుపులు అనిపించింది.'), R('Not happy with this ride.', 'ఈ రైడ్ నచ్చలేదు.')],
  1: [R('Never again.', 'మళ్ళీ ఎప్పుడూ ఎక్కను.'), R('Terrible ride.', 'చాలా దారుణమైన రైడ్.')],
};

/** Flag pools: negative ones are used for low ratings, positive ones for high. */
export const FLAG_REVIEWS = {
  wrongRoute: { neg: true, lines: [R('Took the long way round on purpose.', 'కావాలని చుట్టూ తిప్పాడు.'), R('Why so many turns? Wrong route.', 'ఇన్ని మలుపులు ఎందుకు? తప్పు దారి.')] },
  late: { neg: true, lines: [R('Late! I missed my time.', 'లేట్ అయింది! నా టైం పోయింది.'), R('Too slow when I was in a hurry.', 'తొందర ఉన్నప్పుడు చాలా నెమ్మదిగా వెళ్ళాడు.')] },
  overcharged: { neg: true, lines: [R('Charged way too much.', 'చాలా ఎక్కువ తీసుకున్నాడు.'), R('The price was a loot.', 'రేటు దోపిడీలా ఉంది.')] },
  crashed: { neg: true, lines: [R('He hit something! Scary.', 'ఏదో గుద్దాడు! భయమేసింది.'), R('Rash driving. Careful, please.', 'అజాగ్రత్తగా నడిపాడు. జాగ్రత్త, ప్లీజ్.')] },
  rough: { neg: true, lines: [R('So many bumps, my back!', 'ఎన్ని కుదుపులో, నా నడుము!')] },
  speeding: { neg: true, lines: [R('Too fast, I was scared.', 'చాలా వేగంగా, నాకు భయమేసింది.')] },
  honest: { neg: false, lines: [R('Honest meter, no tricks.', 'మీటర్ నిజాయితీగా, మోసం లేదు.'), R('Trustworthy driver.', 'నమ్మదగిన డ్రైవర్.')] },
  bargain: { neg: false, lines: [R('Fair price after a good chat.', 'మంచి మాట్లాడి న్యాయమైన రేటు.'), R('Good deal, thank you.', 'మంచి డీల్, థాంక్స్.')] },
  shared: { neg: false, lines: [R('Sharing worked well, cheap too.', 'షేరింగ్ బాగా కుదిరింది, చవక కూడా.')] },
  urgentOk: { neg: false, lines: [R('Got me there in time, life saver!', 'టైంకి చేర్చాడు, ప్రాణదాత!'), R('Fast when it mattered. Thank you!', 'అవసరానికి వేగంగా తీసుకెళ్ళాడు. థాంక్స్!')] },
};

/** Order the negative flags are looked at (worst first), then the positive ones. */
const NEG_ORDER = ['crashed', 'wrongRoute', 'late', 'overcharged', 'speeding', 'rough'];
const POS_ORDER = ['urgentOk', 'honest', 'bargain', 'shared'];

/**
 * A review for a finished ride.
 * in: { stars 1..5, flags: { wrongRoute, late, overcharged, crashed, rough, speeding, honest, bargain, shared, urgentOk }, n (any integer to rotate the pools) }
 * -> { stars, text, te }
 */
export function makeReview({ stars, flags = {}, n = 0 }) {
  const s = clamp(Math.round(stars) || 1, 1, 5);
  let pool = null;
  if (s <= 3) {
    const f = NEG_ORDER.find((k) => flags[k]);
    if (f) pool = FLAG_REVIEWS[f].lines;
  } else {
    const f = POS_ORDER.find((k) => flags[k]);
    // a 4-star ride with a complaint still mentions it half the time
    const bad = s === 4 && n % 2 === 1 ? NEG_ORDER.find((k) => flags[k]) : null;
    if (bad) pool = FLAG_REVIEWS[bad].lines;
    else if (f) pool = FLAG_REVIEWS[f].lines;
  }
  const list = pool || REVIEWS[s];
  const r = list[Math.abs(Math.floor(n)) % list.length];
  return { stars: s, text: r.en, te: r.te };
}

/** Keep the newest `max` reviews. */
export const pushReview = (history, review, max = 6) => {
  history.push(review);
  while (history.length > max) history.shift();
  return history;
};
