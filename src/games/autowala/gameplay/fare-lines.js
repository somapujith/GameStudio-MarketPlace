// What passengers say during a ride: the price talk at pickup, the haggling, the grumbles about a long way round, sharing a ride.
// Pure data + two tiny helpers. Every line has an English text and a Telugu text (the subtitle bar shows both). `{dest}` `{price}`
// `{counter}` `{name}` are filled by `fmt` (the Telugu text takes `{dest}` from `destTe` when given).
// Lines are TEXT subtitles (emitted as `voice:line`); no audio files exist for them yet (see the fares report).

/** Subtitle accent colour per customer kind (and the driver). */
export const KIND_COLOR = {
  regular: '#4dd0e1', rusher: '#ff9e40', elder: '#ffd166', women: '#ff7eb6', tourist: '#80ed99', student: '#b794f6', driver: '#ffffff',
};

const L = (en, te) => ({ en, te });

/** key -> { kind | 'any': [lines] } */
export const LINES = {
  // the customer asks the price when they get in
  open: {
    regular: [L('Anna, how much to {dest}?', 'అన్నా, {dest} కి ఎంత అవుతుంది?'), L('{dest} ki ela, anna? Meter or fixed?', '{dest} కి ఎలా అన్నా? మీటరా, ఫిక్స్డా?')],
    elder: [L('Baba, how much to {dest}? Meter is fine.', 'బాబూ, {dest} కి ఎంత? మీటర్ వేయండి.'), L('Slowly, baba. To {dest}.', 'మెల్లగా బాబూ. {dest} కి.')],
    student: [L('Bro, {dest}? Do not loot me, I am a student.', 'బ్రో, {dest}? దోచుకోకు, నేను స్టూడెంట్‌ని.'), L('{dest} bro, what is the rate?', '{dest} బ్రో, రేటు ఎంత?')],
    tourist: [L('To {dest}, please. How much?', '{dest} వెళ్ళాలి. ఎంత?'), L('{dest}? Is it far? What is the price?', '{dest}? దూరమా? ధర ఎంత?')],
    women: [L('To {dest}, on the meter please.', '{dest} కి, మీటర్ వేయండి.'), L('{dest} ki, bhaiya. Meter pettandi.', '{dest} కి భయ్యా. మీటర్ వేయండి.')],
    rusher: [L('{dest}! Fast, I am late!', '{dest}! తొందరగా, లేట్ అవుతోంది!'), L('{dest}, quickly! I will pay extra!', '{dest}, త్వరగా! ఎక్కువే ఇస్తా!')],
  },
  // the driver's offer
  quote: { any: [L('Fixed rate, Rs {price}. No meter.', 'ఫిక్స్డ్ రేటు ₹{price}. మీటర్ లేదు.')] },
  ask: { any: [L('Rs {price}, final.', '₹{price}, ఫైనల్.')] },
  meter: {
    elder: [L('Good, an honest driver.', 'మంచిది, నిజాయితీ గల డ్రైవర్.')],
    women: [L('Thank you, meter is best.', 'థాంక్స్, మీటరే మంచిది.')],
    student: [L('Meter? Okay, fair.', 'మీటరా? సరే, న్యాయమే.')],
    any: [L('Meter it is.', 'సరే, మీటర్ మీదే.')],
  },
  accept: {
    regular: [L('Okay, done.', 'సరే, ఓకే.')],
    elder: [L('Alright, baba, fine.', 'సరే బాబూ, పర్వాలేదు.')],
    student: [L('Fine, fine, let us go bro.', 'సరే సరే, పద బ్రో.')],
    tourist: [L('Sure, sounds great!', 'సరే, బాగుంది!')],
    women: [L('Okay, go.', 'సరే, పోనీయండి.')],
    rusher: [L('Yes yes, go!', 'సరే సరే, పోనివ్వు!')],
  },
  counter: {
    regular: [L('Rs {price}? Too much! Rs {counter}.', '₹{price} ఆ? చాలా ఎక్కువ! ₹{counter} ఇస్తా.')],
    elder: [L('Rs {counter}, baba, what do you say?', '₹{counter} ఇస్తాను బాబూ, ఏమంటారు?')],
    student: [L('Rs {counter} only, bro!', '₹{counter} మాత్రమే బ్రో!')],
    tourist: [L('Hmm, a bit high. Rs {counter}?', 'కొంచెం ఎక్కువ. ₹{counter}?')],
    women: [L('Rs {counter}, not more.', '₹{counter}, అంతకన్నా ఎక్కువ కాదు.')],
    rusher: [L('Rs {counter}, now go!', '₹{counter}, ఇప్పుడు పోనివ్వు!')],
  },
  refuse: {
    regular: [L('Arre, no way! I will find another auto.', 'అయ్యో, కుదరదు! వేరే ఆటో చూసుకుంటా.')],
    elder: [L('That is too much, baba.', 'ఇది చాలా ఎక్కువ బాబూ.')],
    student: [L('Forget it, I will take the bus.', 'వద్దులే, బస్సులో వెళ్తా.')],
    tourist: [L('That seems a lot. No thanks.', 'ఇది చాలా ఎక్కువ. వద్దు, థాంక్స్.')],
    women: [L('No. Meter, or I will not come.', 'వద్దు. మీటర్ మీద అయితేనే వస్తా.')],
    rusher: [L('No time to fight, meter, go!', 'వాదించే టైం లేదు, మీటర్ మీద పోనివ్వు!')],
  },
  concede: { any: [L('Okay okay, you win.', 'సరే సరే, నువ్వే గెలిచావు.')] },
  meet: { any: [L('Let us meet in the middle.', 'మధ్యలో తేల్చుకుందాం.')] },
  hold: { any: [L('My price stays.', 'నా రేటు మారదు.')] },
  walk: { any: [L('Then I will walk. Bye.', 'అయితే నడిచి వెళ్తా. బై.')] },
  // a long way round
  wrong1: {
    regular: [L('Why this way? Is this the right road?', 'ఈ దారి ఎందుకు? ఇదే సరైన రోడ్డా?')],
    elder: [L('Baba, this is not the way.', 'బాబూ, ఇది దారి కాదు.')],
    student: [L('Bro, Google Maps says another road.', 'బ్రో, గూగుల్ మ్యాప్స్ వేరే రోడ్డు చూపిస్తోంది.')],
    tourist: [L('Is this the shortest way? My map says different.', 'ఇదే దగ్గరి దారా? నా మ్యాప్ వేరే చెబుతోంది.')],
    women: [L('Bhaiya, this is not the way, is it?', 'భయ్యా, ఇది దారి కాదు కదా?')],
    rusher: [L('Wrong way! I am late already!', 'తప్పు దారి! ఆల్రెడీ లేట్!')],
  },
  wrong2: {
    regular: [L('You are taking me round and round!', 'చుట్టూ తిప్పుతున్నావు!')],
    elder: [L('Aiyyo, so long! Take me straight.', 'అయ్యో, ఇంత దూరమా! నేరుగా తీసుకెళ్ళు.')],
    student: [L('Bro, you are taking the long way on purpose!', 'బ్రో, కావాలని చుట్టూ తిప్పుతున్నావు!')],
    tourist: [L('This is the scenic route for the meter, no?', 'మీటర్ కోసం చుట్టూ తిప్పుతున్నావా?')],
    women: [L('Stop! Go straight or I get down.', 'ఆపండి! నేరుగా వెళ్ళండి లేదా దిగుతా.')],
    rusher: [L('Are you mad? I will miss it!', 'పిచ్చా నీకు? నేను మిస్ అవుతా!')],
  },
  // a shared ride
  shareOk: { any: [L('Okay, take one more, no problem.', 'సరే, ఇంకొకరిని ఎక్కించుకో, పర్వాలేదు.')] },
  shareBoard: { any: [L('Thank you! I am going the same way.', 'థాంక్స్! నేనూ అటే వెళ్తున్నా.')] },
  shareGrumble: { any: [L('Do not take too long, I have work.', 'ఎక్కువ టైం తీసుకోకు, నాకు పని ఉంది.')] },
  // an urgent passenger, and what they say at the end
  urgentOn: { any: [L('Hurry, please, it is urgent!', 'తొందరగా, ప్లీజ్, అర్జెంట్!')] },
};

/** Pick a line for `key` and `kind` (falls back to 'any'); `n` is any integer (an id, a counter) used to rotate. */
export function pickLine(key, kind, n = 0) {
  const group = LINES[key];
  if (!group) return null;
  const list = group[kind] || group.any || group.regular;
  if (!list || !list.length) return null;
  return list[Math.abs(Math.floor(n)) % list.length];
}

/** Fill `{name}` placeholders. `vars.destTe` etc: the Telugu text takes `<name>Te` when it exists. */
export function fmt(line, vars = {}) {
  if (!line) return null;
  const fill = (s, te) => s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = te && vars[`${k}Te`] != null ? vars[`${k}Te`] : vars[k];
    return v == null ? '' : String(v);
  });
  return { en: fill(line.en, false), te: fill(line.te, true) };
}
