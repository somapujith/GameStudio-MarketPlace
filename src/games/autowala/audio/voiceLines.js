// OWNER: voice agent. The spoken-line catalogue: DATA ONLY (plus tiny lookups). Used by the runtime (voices.js), the offline
// generator (scripts/gen-voicelines.mjs, which imports this file under plain Node: keep it free of imports) and the tests.
//
// Every persona is an ORIGINAL FICTIONAL character. A `brief` describes age / tone / pace / accent in plain words and never
// refers to a real person; real-person voice cloning is not allowed in this project (see docs/AUTOWALA_VOICES.md).
// The Telugu is colloquial Hyderabadi street Telugu written by a non-native reviewer: a native-speaker review is recommended
// before release (see the doc). Ids are the file names (`<id>.mp3`): never renumber an id, only append new ones.

/** The fares agent's customer kinds, exactly. */
export const KINDS = ['regular', 'rusher', 'elder', 'women', 'tourist', 'student'];

/**
 * persona id -> { name, te, color, brief, voice: provider hints, speech: speechSynthesis fallback tuning }
 * `voice.imagine` names are generic voice-library labels from the imagine.art web app (not people); `emotion` / `speed` / `pitch`
 * are provider-neutral hints each adapter maps as it can.
 */
export const PERSONAS = {
  woman_young: {
    name: 'Young woman', te: 'యువతి', color: '#ff7ab8',
    brief: 'Young adult woman in her twenties, bright and friendly, quick light pace, casual Hyderabadi Telugu, a little hurried.',
    voice: { imagine: 'Lively Girl', emotion: 'happy', speed: 1.05, pitch: 1 },
    speech: { pitch: 1.35, rate: 1.05 },
  },
  woman_mid: {
    name: 'Woman', te: 'అక్క', color: '#ff9a5c',
    brief: 'Woman in her forties, warm and practical, everyday market-going tone, medium pace, plain Hyderabadi Telugu.',
    voice: { imagine: 'Calm Woman', emotion: 'neutral', speed: 1, pitch: 0 },
    speech: { pitch: 1.1, rate: 1 },
  },
  elder_woman: {
    name: 'Elder woman', te: 'అమ్మమ్మ', color: '#c9a6ff',
    brief: 'Old woman in her seventies, soft and slightly shaky, very slow pace with pauses, gentle old-fashioned Telugu, affectionate.',
    voice: { imagine: 'Wise Woman', emotion: 'neutral', speed: 0.8, pitch: -2 },
    speech: { pitch: 0.85, rate: 0.78 },
  },
  elder_man: {
    name: 'Elder man', te: 'తాతయ్య', color: '#8fd0ff',
    brief: 'Old man in his seventies, raspy and slow, deliberate pace with pauses, fatherly old-style Telugu, a bit grumbly but kind.',
    voice: { imagine: 'Patient Man', emotion: 'neutral', speed: 0.8, pitch: -3 },
    speech: { pitch: 0.6, rate: 0.78 },
  },
  man_rusher: {
    name: 'Man in a hurry', te: 'తొందరగాడు', color: '#ff6b57',
    brief: 'Man in his thirties, clipped, impatient, fast pace, city Telugu with Hyderabadi Hindi-Urdu flavour, stressed.',
    voice: { imagine: 'Determined Man', emotion: 'angry', speed: 1.2, pitch: 0 },
    speech: { pitch: 0.9, rate: 1.25 },
  },
  student: {
    name: 'Student', te: 'విద్యార్థి', color: '#7dffb0',
    brief: 'Teenager or early twenties, energetic, slightly nervous, fast casual pace, college-slang Telugu mixed with English words.',
    voice: { imagine: 'Casual Guy', emotion: 'happy', speed: 1.1, pitch: 1 },
    speech: { pitch: 1.2, rate: 1.1 },
  },
  tourist: {
    name: 'Tourist', te: 'పర్యాటకుడు', color: '#ffe36b',
    brief: 'Visitor from out of town, curious and polite, slightly slower than a local, simple Telugu with a mild non-local accent and English words.',
    voice: { imagine: 'Friendly Person', emotion: 'surprised', speed: 0.95, pitch: 0 },
    speech: { pitch: 1, rate: 0.95 },
  },
  driver_angry: {
    name: 'Angry driver', te: 'కోపిష్టి డ్రైవర్', color: '#ff5252',
    brief: 'Comic road-rage driver, man in his forties, loud and exasperated, fast sharp pace, Hyderabadi Telugu mixed with Hindi words, shouts from a car window. Funny, never menacing.',
    voice: { imagine: 'Exuberant Girl', emotion: 'angry', speed: 1.15, pitch: -1 },
    speech: { pitch: 0.8, rate: 1.2 },
  },
  mega_hero: {
    name: 'Hero Mama', te: 'హీరో మామ', color: '#ffc857',
    brief: 'An original fictional action-hero narrator: booming, deep, charismatic adult male voice, slow dramatic cadence that rises to proud shouts, big-screen announcer energy, motivational Telugu. Not an imitation of any real person.',
    voice: { imagine: 'Imposing Manner', emotion: 'happy', speed: 0.92, pitch: -4 },
    speech: { pitch: 0.5, rate: 0.9 },
  },
};

export const PERSONA_IDS = Object.keys(PERSONAS);
export const NPC_PERSONAS = ['driver_angry']; // other road users, not passengers
export const PASSENGER_PERSONAS = PERSONA_IDS.filter((p) => p !== 'mega_hero' && !NPC_PERSONAS.includes(p));

export const PASSENGER_CATEGORIES = [
  'hail', 'boarding', 'chatter', 'complaint_crash', 'complaint_speed', 'complaint_bumpy', 'rush', 'thanks', 'tip', 'missed',
];
export const NPC_CATEGORIES = ['rage_start', 'rage_shout', 'traffic_hit', 'rage_caught'];
export const HERO_CATEGORIES = [
  'hero_first_fare', 'hero_streak', 'hero_earn_1000', 'hero_earn_5000', 'hero_drift', 'hero_jump',
  'hero_night', 'hero_rain', 'hero_fuel', 'hero_workshop', 'hero_garage', 'hero_escape', 'hero_caught',
];
export const CATEGORIES = [...PASSENGER_CATEGORIES, ...NPC_CATEGORIES, ...HERO_CATEGORIES];

/** Places a waiting customer can mention (`customer.place`): the key of a hail line's `place` field. Place names only, no claims. */
export const PLACES = ['bawarchi', 'paradise', 'oyo', 'delhi_mithai', 'metro'];
export function placeKey(place) {
  if (!place) return null;
  const n = `${place.brand || ''} ${place.station || ''} ${place.name || ''} ${place.id || ''}`.toLowerCase();
  if (/bawarchi/.test(n)) return 'bawarchi';
  if (/paradise/.test(n)) return 'paradise';
  if (/\boyo\b/.test(n)) return 'oyo';
  if (/delhi[\s_-]*mithai/.test(n)) return 'delhi_mithai';
  if (/metro/.test(n)) return 'metro';
  return null;
}

// [id, te, roman, en, extra?]  extra: { kind (hail only), dest (boarding only: a poi id), mood, weight }
const P = (persona, category, rows) =>
  rows.map(([id, te, roman, en, extra]) => ({ id, persona, category, te, roman, en, ...extra }));

export const LINES = [
  // ---- hail: a customer by the road calls the auto. `kind` = the fares agent's customer kind --------------------------------
  ...P('man_rusher', 'hail', [
    ['hail_reg_m1', 'బాబూ ఆటో!', 'Babu auto!', 'Hey, auto!', { kind: 'regular' }],
    ['hail_reg_m2', 'ఓయ్ ఆటో బాబూ, ఇక్కడ ఆపు!', 'Ooy auto babu, ikkada aapu!', 'Hey auto, stop here!', { kind: 'regular' }],
    ['hail_reg_m3', 'ఆటో ఆటో! ఇటు రా!', 'Auto auto! Itu raa!', 'Auto, auto! Come over here!', { kind: 'regular' }],
    ['hail_rush_1', 'ఆటో! జల్దీ రా బాబూ!', 'Auto! Jaldi raa babu!', 'Auto! Come quick, babu!', { kind: 'rusher', mood: 'angry' }],
    ['hail_rush_2', 'ఏయ్ ఆటో! అర్జెంట్ బాబూ!', 'Ey auto! Urgent babu!', 'Hey auto! It is urgent, babu!', { kind: 'rusher', mood: 'angry' }],
    ['hail_rush_3', 'ఆపు ఆపు! లేట్ అయిపోతోంది!', 'Aapu aapu! Late ayipotondi!', 'Stop, stop! I am running late!', { kind: 'rusher', mood: 'angry' }],
  ]),
  ...P('woman_mid', 'hail', [
    ['hail_reg_w1', 'బాబూ, ఆటో ఖాళీయేనా?', 'Babu, auto khaaliyena?', 'Babu, is the auto free?', { kind: 'regular' }],
    ['hail_reg_w2', 'ఆపు బాబూ, ఆపు!', 'Aapu babu, aapu!', 'Stop, babu, stop!', { kind: 'regular' }],
    ['hail_reg_w3', 'ఆటో బాబూ, ఇటు వస్తావా?', 'Auto babu, itu vastava?', 'Auto, will you come this way?', { kind: 'regular' }],
    ['hail_wom_m1', 'అన్నా, ఆటో ఆపండి!', 'Anna, auto aapandi!', 'Brother, please stop the auto!', { kind: 'women' }],
    ['hail_wom_m2', 'ఆటో! ఆటో! ఇక్కడే!', 'Auto! Auto! Ikkade!', 'Auto! Auto! Right here!', { kind: 'women' }],
    ['hail_wom_m3', 'అన్నా, ఇటు రండి ఆటో!', 'Anna, itu randi auto!', 'Brother, come this way, auto!', { kind: 'women' }],
  ]),
  ...P('woman_young', 'hail', [
    ['hail_wom_y1', 'అన్నా, ఆటో!', 'Anna, auto!', 'Brother, auto!', { kind: 'women' }],
    ['hail_wom_y2', 'ఆటో అన్నా! ఇక్కడ ఆపండి!', 'Auto anna! Ikkada aapandi!', 'Auto, brother! Stop here, please!', { kind: 'women' }],
    ['hail_wom_y3', 'అన్నా, ఖాళీనా?', 'Anna, khaalina?', 'Brother, are you free?', { kind: 'women' }],
  ]),
  ...P('elder_man', 'hail', [
    ['hail_eld_m1', 'ఆటో... బాబూ... ఆపు బాబూ', 'Auto... babu... aapu babu', 'Auto... son... please stop.', { kind: 'elder' }],
    ['hail_eld_m2', 'ఒరేయ్ బాబూ, ఆటో... ఇక్కడ ఆపరా', 'Orey babu, auto... ikkada aaparaa', 'Hey son, auto... stop here.', { kind: 'elder' }],
    ['hail_eld_m3', 'బాబూ... ఓ బాబూ... ఆటో ఖాళీనా?', 'Babu... o babu... auto khaalina?', 'Son... oh son... is the auto free?', { kind: 'elder' }],
  ]),
  ...P('elder_woman', 'hail', [
    ['hail_eld_w1', 'ఆటో... ఓ బాబూ... ఆపు నాయనా', 'Auto... o babu... aapu nayana', 'Auto... oh dear... please stop.', { kind: 'elder' }],
    ['hail_eld_w2', 'ఆటో బాబూ... మెల్లగా రా నాయనా', 'Auto babu... mellaga raa nayana', 'Auto, son... come slowly, dear.', { kind: 'elder' }],
    ['hail_eld_w3', 'ఓ నాయనా, ఆటో... ఇటు రా నాయనా', 'O nayana, auto... itu raa nayana', 'Oh dear, auto... come this way, dear.', { kind: 'elder' }],
  ]),
  ...P('tourist', 'hail', [
    ['hail_tou_1', 'ఆటో! ఆటో! ప్లీజ్!', 'Auto! Auto! Please!', 'Auto! Auto! Please!', { kind: 'tourist' }],
    ['hail_tou_2', 'అన్నా, ఆటో! ప్లీజ్ ఆపండి!', 'Anna, auto! Please aapandi!', 'Brother, auto! Please stop!', { kind: 'tourist' }],
    ['hail_tou_3', 'ఎక్స్క్యూజ్ మీ, ఆటో!', 'Excuse me, auto!', 'Excuse me, auto!', { kind: 'tourist' }],
  ]),
  ...P('student', 'hail', [
    ['hail_stu_1', 'అన్నా ఆటో! కాలేజీకి టైం అయింది!', 'Anna auto! College ki time ayindi!', 'Brother, auto! I am late for college!', { kind: 'student' }],
    ['hail_stu_2', 'అన్నా, ఓ ఆటో! ఇక్కడ!', 'Anna, o auto! Ikkada!', 'Brother, oh auto! Over here!', { kind: 'student' }],
    ['hail_stu_3', 'ఆటో అన్నా! ఆగు ఆగు!', 'Auto anna! Aagu aagu!', 'Auto, brother! Wait, wait!', { kind: 'student' }],
  ]),

  // hail variants that name the place the customer waits at (used only when customer.place matches)
  ...P('man_rusher', 'hail', [
    ['hail_pl_m_bawarchi', 'బావర్చి దగ్గర ఆటో బాబూ!', 'Bawarchi daggara auto babu!', 'Auto, babu, here at Bawarchi!', { kind: 'regular', place: 'bawarchi' }],
    ['hail_pl_m_paradise', 'ప్యారడైజ్ దగ్గర ఆటో! ఇటు రా!', 'Paradise daggara auto! Itu raa!', 'Auto at Paradise! Come over here!', { kind: 'regular', place: 'paradise' }],
    ['hail_pl_m_oyo', 'ఓయో దగ్గర ఉన్నా, ఆటో బాబూ!', 'OYO daggara unna, auto babu!', 'I am at OYO, auto, babu!', { kind: 'regular', place: 'oyo' }],
    ['hail_pl_m_delhi', 'ఢిల్లీ మిఠాయి వాలా దగ్గర ఆటో!', 'Delhi Mithai Wala daggara auto!', 'Auto at Delhi Mithai Wala!', { kind: 'regular', place: 'delhi_mithai' }],
    ['hail_pl_m_metro', 'మెట్రో స్టేషన్ దగ్గర ఆటో బాబూ!', 'Metro station daggara auto babu!', 'Auto, babu, at the metro station!', { kind: 'regular', place: 'metro' }],
  ]),
  ...P('woman_mid', 'hail', [
    ['hail_pl_w_bawarchi', 'బావర్చి దగ్గర ఉన్నా బాబూ, ఆటో!', 'Bawarchi daggara unna babu, auto!', 'I am at Bawarchi, babu, auto!', { kind: 'regular', place: 'bawarchi' }],
    ['hail_pl_w_delhi', 'ఢిల్లీ మిఠాయి వాలా దగ్గర ఆపండి అన్నా!', 'Delhi Mithai Wala daggara aapandi anna!', 'Stop at Delhi Mithai Wala, brother!', { kind: 'regular', place: 'delhi_mithai' }],
    ['hail_pl_w_metro', 'మెట్రో స్టేషన్ దగ్గర ఆటో బాబూ!', 'Metro station daggara auto babu!', 'Auto, babu, at the metro station!', { kind: 'regular', place: 'metro' }],
  ]),
  ...P('student', 'hail', [['hail_pl_s_metro', 'అన్నా, మెట్రో స్టేషన్ దగ్గర ఆటో!', 'Anna, metro station daggara auto!', 'Brother, auto at the metro station!', { kind: 'student', place: 'metro' }]]),
  ...P('tourist', 'hail', [['hail_pl_t_oyo', 'ఓయో దగ్గర ఉన్నాం, ఆటో ప్లీజ్!', 'OYO daggara unnam, auto please!', 'We are at OYO, auto please!', { kind: 'tourist', place: 'oyo' }]]),

  // ---- boarding: the customer gets in and says where to. Lines with `dest` (a poi id) are used when the trip goes there -----
  ...P('man_rusher', 'boarding', [
    ['board_m1', 'ఎక్కేశా బాబూ, పోనివ్వు!', 'Ekkesa babu, poniyyu!', 'I am in, babu, go!'],
    ['board_m2', 'సరే బాబూ, తీసుకెళ్ళు', 'Sare babu, teesukellu', 'Okay, babu, take me.'],
    ['board_m_charminar', 'చార్మినార్ కి తీసుకెళ్ళు బాబూ', 'Charminar ki teesukellu babu', 'Take me to Charminar, babu.', { dest: 'charminar' }],
    ['board_m_station', 'స్టేషన్ కి పోనివ్వు బాబూ, ట్రైన్ టైం అవుతోంది', 'Station ki poniyyu babu, train time avutondi', 'To the station, babu, the train is due.', { dest: 'station' }],
    ['board_m_airport', 'ఎయిర్ పోర్ట్ కి పోనివ్వు బాబూ', 'Airport ki poniyyu babu', 'To the airport, babu.', { dest: 'airport' }],
    ['board_m_hospital', 'హాస్పిటల్ కి తొందరగా పోనివ్వు బాబూ', 'Hospital ki thondaraga poniyyu babu', 'To the hospital, quickly, babu.', { dest: 'hospital' }],
  ]),
  ...P('woman_mid', 'boarding', [
    ['board_w1', 'బాబూ, తీసుకెళ్ళు', 'Babu, teesukellu', 'Babu, take me.'],
    ['board_w2', 'అన్నా, పోనివ్వండి', 'Anna, poniyyandi', 'Brother, please go ahead.'],
    ['board_w_charminar', 'చార్మినార్ కి పోనివ్వండి అన్నా', 'Charminar ki poniyyandi anna', 'To Charminar, brother, please.', { dest: 'charminar' }],
    ['board_w_station', 'స్టేషన్ దగ్గర దింపండి అన్నా', 'Station daggara dimpandi anna', 'Drop me near the station, brother.', { dest: 'station' }],
    ['board_w_airport', 'ఎయిర్ పోర్ట్ కి పోదాం అన్నా', 'Airport ki podam anna', 'Let us go to the airport, brother.', { dest: 'airport' }],
    ['board_w_hospital', 'హాస్పిటల్ కి పోనివ్వండి అన్నా', 'Hospital ki poniyyandi anna', 'To the hospital, brother, please.', { dest: 'hospital' }],
  ]),
  ...P('woman_young', 'boarding', [['board_y1', 'అన్నా, త్వరగా పోనివ్వండి', 'Anna, tvaraga poniyyandi', 'Brother, please drive on, quickly.']]),
  ...P('elder_man', 'boarding', [
    ['board_em1', 'మెల్లగా ఎక్కనివ్వు బాబూ... సరే, పోనివ్వు', 'Mellaga ekkaniyyu babu... sare, poniyyu', 'Let me climb in slowly, son... all right, go.'],
    ['board_em2', 'నెమ్మదిగా పోనివ్వు బాబూ', 'Nemmadiga poniyyu babu', 'Drive slowly, son.'],
  ]),
  ...P('elder_woman', 'boarding', [
    ['board_ew1', 'నెమ్మదిగా పోనివ్వు నాయనా', 'Nemmadiga poniyyu nayana', 'Drive slowly, dear.'],
    ['board_ew2', 'పట్టుకో నాయనా... సరే, పోనివ్వు', 'Pattuko nayana... sare, poniyyu', 'Help me in, dear... all right, go.'],
  ]),
  ...P('student', 'boarding', [['board_s1', 'అన్నా, తొందరగా వెళ్ళు', 'Anna, thondaraga vellu', 'Brother, go quickly.']]),
  ...P('tourist', 'boarding', [
    ['board_t1', 'థ్యాంక్స్! పోనివ్వండి', 'Thanks! Poniyyandi', 'Thanks! Please go ahead.'],
    ['board_t2', 'చార్మినార్ చూడాలి అన్నా!', 'Charminar choodali anna!', 'I want to see Charminar, brother!'],
  ]),

  // ---- chatter while riding -----------------------------------------------------------------------------------------------
  ...P('woman_mid', 'chatter', [
    ['chat_w1', 'ఈ ట్రాఫిక్ చూడు బాబూ, రోజూ ఇంతే', 'Ee traffic choodu babu, rojoo inthe', 'Look at this traffic, babu. Every day the same.'],
    ['chat_w2', 'ఇవాళ ఎండ ఎక్కువగా ఉంది కదా బాబూ', 'Ivala enda ekkuvaga undi kada babu', 'It is very hot today, is it not?'],
  ]),
  ...P('woman_young', 'chatter', [
    ['chat_y1', 'అన్నా, ఇక్కడ ఇరానీ చాయ్ బాగుంటుందా?', 'Anna, ikkada Irani chai baguntunda?', 'Brother, is the Irani chai good around here?'],
    ['chat_y2', 'అన్నా, మ్యూజిక్ పెట్టండి కొంచెం', 'Anna, music pettandi konchem', 'Brother, put some music on.'],
  ]),
  ...P('elder_man', 'chatter', [
    ['chat_em1', 'మా కాలంలో ఇవన్నీ ఖాళీ రోడ్లు బాబూ', 'Maa kaalamlo ivanni khaali roadlu babu', 'In our days these were all empty roads, son.'],
    ['chat_em2', 'ఒకప్పుడు ఇక్కడ గుర్రపు బళ్ళు తిరిగేవి బాబూ', 'Okappudu ikkada gurrapu ballu tirigevi babu', 'Once, horse carts ran here, son.'],
  ]),
  ...P('elder_woman', 'chatter', [
    ['chat_ew1', 'మనవడిని చూడటానికి వెళ్తున్నా నాయనా', 'Manavadini choodataniki veltunna nayana', 'I am going to see my grandson, dear.'],
    ['chat_ew2', 'ఈ రోజుల్లో అంతా వేగమే నాయనా', 'Ee rojullo antha vegame nayana', 'Everything is so fast these days, dear.'],
  ]),
  ...P('student', 'chatter', [
    ['chat_s1', 'అన్నా, ఈ రోజు పరీక్ష ఉంది, భయంగా ఉంది', 'Anna, ee roju pareeksha undi, bhayanga undi', 'Brother, I have an exam today and I am nervous.'],
    ['chat_s2', 'అన్నా, నీ ఆటో సూపర్ ఉంది!', 'Anna, nee auto super undi!', 'Brother, your auto looks super!'],
  ]),
  ...P('tourist', 'chatter', [
    ['chat_t1', 'వావ్! హైదరాబాద్ చాలా బావుంది!', 'Wow! Hyderabad chaala bavundi!', 'Wow! Hyderabad is lovely!'],
    ['chat_t2', 'ఇక్కడ బిర్యానీ ఎక్కడ బావుంటుంది అన్నా?', 'Ikkada biryani ekkada bavuntundi anna?', 'Where is the best biryani around here, brother?'],
  ]),
  ...P('man_rusher', 'chatter', [['chat_m1', 'ఈ సిటీ ఎప్పుడూ బిజీనే బాబూ', 'Ee city eppudu busy ne babu', 'This city is always busy, babu.']]),

  // ---- complaints: a crash (loud), speeding, and a rough ride -------------------------------------------------------------
  ...P('woman_mid', 'complaint_crash', [['crash_w', 'అయ్యో! చూసి నడపండి బాబూ!', 'Ayyo! Choosi nadapandi babu!', 'Oh no! Drive carefully, babu!', { mood: 'fearful' }]]),
  ...P('woman_young', 'complaint_crash', [['crash_y', 'అయ్యో అమ్మ! జాగ్రత్త అన్నా!', 'Ayyo amma! Jagratta anna!', 'Oh mother! Careful, brother!', { mood: 'fearful' }]]),
  ...P('elder_man', 'complaint_crash', [['crash_em', 'ఓరి దేవుడా! మెల్లగా పో బాబూ!', 'Ori devuda! Mellaga po babu!', 'Oh God! Go slowly, son!', { mood: 'fearful' }]]),
  ...P('elder_woman', 'complaint_crash', [['crash_ew', 'అయ్యో రామా! నెమ్మదిగా నాయనా!', 'Ayyo Rama! Nemmadiga nayana!', 'Oh Lord Rama! Slowly, dear!', { mood: 'fearful' }]]),
  ...P('man_rusher', 'complaint_crash', [['crash_m', 'ఏయ్! ఏం చేస్తున్నావ్!', 'Ey! Em chestunnav!', 'Hey! What are you doing!', { mood: 'angry' }]]),
  ...P('student', 'complaint_crash', [['crash_s', 'అన్నా! ఏమైంది అన్నా!', 'Anna! Emaindi anna!', 'Brother! What happened, brother!', { mood: 'fearful' }]]),
  ...P('tourist', 'complaint_crash', [['crash_t', 'ఓ మై గాడ్! జాగ్రత్త!', 'Oh my god! Jagratta!', 'Oh my god! Careful!', { mood: 'fearful' }]]),

  ...P('woman_mid', 'complaint_speed', [['speed_w', 'మెల్లగా పో బాబూ, మెల్లగా!', 'Mellaga po babu, mellaga!', 'Slow down, babu, slow down!']]),
  ...P('elder_man', 'complaint_speed', [['speed_em', 'ఒరేయ్ బాబూ, అంత స్పీడ్ వద్దు రా!', 'Orey babu, antha speed vaddu ra!', 'Hey son, not so fast!']]),
  ...P('elder_woman', 'complaint_speed', [['speed_ew', 'నెమ్మదిగా నాయనా, నాకు భయమేస్తోంది', 'Nemmadiga nayana, naaku bhayamestondi', 'Slowly, dear, I am getting scared.']]),
  ...P('woman_young', 'complaint_speed', [['speed_y', 'అన్నా, కొంచెం మెల్లగా ప్లీజ్!', 'Anna, konchem mellaga please!', 'Brother, a little slower, please!']]),
  ...P('tourist', 'complaint_speed', [['speed_t', 'స్లో డౌన్ ప్లీజ్!', 'Slow down please!', 'Slow down, please!']]),

  ...P('woman_mid', 'complaint_bumpy', [['bump_w', 'అబ్బా! గుంతలు చూడు బాబూ!', 'Abba! Gunthalu choodu babu!', 'Ouch! Watch the potholes, babu!']]),
  ...P('elder_woman', 'complaint_bumpy', [['bump_ew', 'అబ్బా, నడుము పోతోంది నాయనా!', 'Abba, nadumu potondi nayana!', 'Ouch, my back is breaking, dear!']]),
  ...P('elder_man', 'complaint_bumpy', [['bump_em', 'అమ్మో! ఎగిరిపడుతున్నాం బాబూ!', 'Ammo! Egiripadutunnam babu!', 'Whoa! We are bouncing about, son!']]),
  ...P('woman_young', 'complaint_bumpy', [['bump_y', 'అబ్బా! ఏంటి అన్నా ఇది!', 'Abba! Enti anna idi!', 'Ouch! What is this, brother!']]),

  // ---- rusher: urgency while riding --------------------------------------------------------------------------------------
  ...P('man_rusher', 'rush', [
    ['rush_m1', 'తొందరగా పో బాబూ, ట్రైన్ అయిపోతుంది!', 'Thondaraga po babu, train ayipotundi!', 'Go fast, babu, the train is leaving!', { mood: 'angry' }],
    ['rush_m2', 'జల్దీ జల్దీ! టైం లేదు!', 'Jaldi jaldi! Time ledu!', 'Hurry, hurry! There is no time!', { mood: 'angry' }],
    ['rush_m3', 'ఇంకా ఎంత సేపు బాబూ?', 'Inka entha sepu babu?', 'How much longer, babu?', { mood: 'angry' }],
    ['rush_m4', 'మీటింగ్ కి లేట్ అవుతోంది, గ్యాస్ ఇవ్వు!', 'Meeting ki late avutondi, gas ivvu!', 'I am late for a meeting, step on it!', { mood: 'angry' }],
  ]),
  ...P('student', 'rush', [['rush_s1', 'క్లాస్ కి లేట్ అవుతోంది అన్నా!', 'Class ki late avutondi anna!', 'I am getting late for class, brother!']]),

  // ---- thanks at the drop-off ---------------------------------------------------------------------------------------------
  ...P('woman_mid', 'thanks', [
    ['thx_w1', 'ధన్యవాదాలు బాబూ', 'Dhanyavadalu babu', 'Thank you, babu.', { mood: 'happy' }],
    ['thx_w2', 'చాలా బాగా నడిపావు బాబూ', 'Chala baaga nadipav babu', 'You drove very well, babu.', { mood: 'happy' }],
  ]),
  ...P('woman_young', 'thanks', [['thx_y1', 'థాంక్స్ అన్నా!', 'Thanks anna!', 'Thanks, brother!', { mood: 'happy' }]]),
  ...P('man_rusher', 'thanks', [
    ['thx_m1', 'సరే బాబూ, థాంక్స్!', 'Sare babu, thanks!', 'All right, babu, thanks!'],
    ['thx_m2', 'టైంకి చేర్చావ్, శభాష్!', 'Timeki cherchav, shabash!', 'You got me there on time. Well done!', { mood: 'happy' }],
  ]),
  ...P('elder_man', 'thanks', [
    ['thx_em1', 'చల్లగా ఉండు బాబూ', 'Challaga undu babu', 'God bless you, son.', { mood: 'happy' }],
    ['thx_em2', 'దేవుడు నిన్ను చల్లగా చూడాలి', 'Devudu ninnu challaga choodali', 'May God keep you well.', { mood: 'happy' }],
  ]),
  ...P('elder_woman', 'thanks', [
    ['thx_ew1', 'చల్లగా ఉండు నాయనా, ధన్యవాదాలు', 'Challaga undu nayana, dhanyavadalu', 'God bless you, dear. Thank you.', { mood: 'happy' }],
    ['thx_ew2', 'జాగ్రత్తగా తీసుకొచ్చావు నాయనా', 'Jagrattaga teesukochchavu nayana', 'You brought me safely, dear.', { mood: 'happy' }],
  ]),
  ...P('student', 'thanks', [['thx_s1', 'థాంక్యూ అన్నా!', 'Thank you anna!', 'Thank you, brother!', { mood: 'happy' }]]),
  ...P('tourist', 'thanks', [['thx_t1', 'థాంక్యూ సో మచ్!', 'Thank you so much!', 'Thank you so much!', { mood: 'happy' }]]),

  // ---- tips ------------------------------------------------------------------------------------------------------------------
  ...P('woman_mid', 'tip', [['tip_w', 'ఇదిగో బాబూ, ఇది నీకే', 'Idigo babu, idi neeke', 'Here, babu, this is for you.', { mood: 'happy' }]]),
  ...P('man_rusher', 'tip', [['tip_m', 'ఉంచుకో బాబూ, చాయ్ తాగు', 'Unchuko babu, chai thaagu', 'Keep it, babu, have some chai.', { mood: 'happy' }]]),
  ...P('elder_man', 'tip', [['tip_em', 'ఇదిగో బాబూ, మిఠాయి కొనుక్కో', 'Idigo babu, mitayi konukko', 'Here, son, buy yourself some sweets.', { mood: 'happy' }]]),
  ...P('tourist', 'tip', [['tip_t', 'కీప్ ద చేంజ్!', 'Keep the change!', 'Keep the change!', { mood: 'happy' }]]),
  ...P('student', 'tip', [['tip_s', 'అన్నా, ఇదిగో టిప్!', 'Anna, idigo tip!', 'Brother, here is a tip!', { mood: 'happy' }]]),

  // ---- missed: the customer gives up waiting -------------------------------------------------------------------------------
  ...P('woman_mid', 'missed', [['miss_w', 'ఇంకెంత సేపు? నేను వేరే ఆటో చూసుకుంటా!', 'Inkenta sepu? Nenu vere auto choosukunta!', 'How much longer? I will find another auto!', { mood: 'angry' }]]),
  ...P('man_rusher', 'missed', [
    ['miss_m1', 'ఛీ! వెళ్ళిపోతున్నా!', 'Chhee! Vellipotunna!', 'Ugh! I am leaving!', { mood: 'angry' }],
    ['miss_m2', 'ఎవరూ రావట్లేదు, నేనే నడుస్తా!', 'Evaru ravatledu, nene nadustha!', 'Nobody is coming, I will walk!', { mood: 'angry' }],
  ]),
  ...P('elder_man', 'missed', [['miss_em', 'ఇంకా రాలేదా... సరే లే, బస్సులో పోతాలే', 'Inka raaleda... sare le, bussulo pothale', 'Still not here... never mind, I will take the bus.', { mood: 'sad' }]]),
  ...P('elder_woman', 'missed', [['miss_ew', 'ఇక రావేమో... నెమ్మదిగా నడుస్తాలే', 'Ika raavemo... nemmadiga nadusthale', 'He will not come now... I will walk slowly.', { mood: 'sad' }]]),
  ...P('student', 'missed', [['miss_s', 'అన్నా రాలేదు! క్యాబ్ బుక్ చేసుకున్నా!', 'Anna raaledu! Cab book chesukunna!', 'Brother did not come! I booked a cab.', { mood: 'angry' }]]),
  ...P('tourist', 'missed', [['miss_t', 'ఓకే, వేరే ఆటో చూద్దాం', 'Okay, vere auto choodam', 'Okay, let us find another auto.', { mood: 'sad' }]]),
  ...P('woman_young', 'missed', [['miss_y', 'ఇక చాలు, వేరే ఆటో పిలుస్తా', 'Ika chaalu, vere auto pilustha', 'That is enough, I will call another auto.', { mood: 'angry' }]]),

  // ---- angry drivers (the road-rage events): comic shouting from a car window, no slurs, no threats -------------------------
  ...P('driver_angry', 'rage_start', [
    ['rage_start_1', 'ఏయ్! ఆగు ఆగు!', 'Ey! Aagu aagu!', 'Hey! Stop, stop!', { mood: 'angry' }],
    ['rage_start_2', 'ఎక్కడికి పోతున్నావ్! ఆగు!', 'Ekkadiki potunnav! Aagu!', 'Where are you going! Stop!', { mood: 'angry' }],
    ['rage_start_3', 'ఆ ఆటోని ఆపండి!', 'Aa autoni aapandi!', 'Stop that auto!', { mood: 'angry' }],
  ]),
  ...P('driver_angry', 'rage_shout', [
    ['rage_shout_1', 'ఏయ్! చూసుకుని పో!', 'Ey! Choosukuni po!', 'Hey! Watch where you go!', { mood: 'angry' }],
    ['rage_shout_2', 'ఆగు! ఆగు!', 'Aagu! Aagu!', 'Stop! Stop!', { mood: 'angry' }],
    ['rage_shout_3', 'ఎక్కడికి పోతున్నావ్!', 'Ekkadiki potunnav!', 'Where are you going!', { mood: 'angry' }],
    ['rage_shout_4', 'అరే భాయ్, ఏం చేస్తున్నావ్!', 'Arey bhai, em chestunnav!', 'Hey brother, what are you doing!', { mood: 'angry' }],
    ['rage_shout_5', 'హార్న్ కొట్టినా వినపడట్లేదా!', 'Horn kottina vinapadatledha!', 'Can you not hear the horn!', { mood: 'angry' }],
    ['rage_shout_6', 'ఇదేం డ్రైవింగ్ రా బాబూ!', 'Idem driving ra babu!', 'What kind of driving is this!', { mood: 'angry' }],
    ['rage_shout_7', 'జరా చూడు భయ్యా!', 'Zara choodu bhayya!', 'Look a little, brother!', { mood: 'angry' }],
  ]),
  ...P('driver_angry', 'traffic_hit', [
    ['hit_1', 'అరే! నా బండి!', 'Arey! Naa bandi!', 'Hey! My vehicle!', { mood: 'angry' }],
    ['hit_2', 'చూసుకుని నడపరా!', 'Choosukuni nadaparaa!', 'Drive with your eyes open!', { mood: 'angry' }],
    ['hit_3', 'అయ్యో, నా కారు!', 'Ayyo, naa car!', 'Oh no, my car!', { mood: 'angry' }],
    ['hit_4', 'ఏంటి భయ్యా ఇది!', 'Enti bhayya idi!', 'What is this, brother!', { mood: 'angry' }],
    ['hit_5', 'సీదా పో భాయ్!', 'Seedha po bhai!', 'Go straight, brother!', { mood: 'angry' }],
  ]),
  ...P('driver_angry', 'rage_caught', [
    ['caught_1', 'దొరికావ్ ఇప్పుడు!', 'Dorikav ippudu!', 'Got you now!', { mood: 'angry' }],
    ['caught_2', 'ఆగమన్నా ఆగవా!', 'Aagamanna aagava!', 'I said stop, did you not hear!', { mood: 'angry' }],
    ['caught_3', 'హమ్మయ్య, ఆగావు!', 'Hammayya, aagavu!', 'Phew, you stopped!', { mood: 'happy' }],
  ]),

  // ---- Mega Hero: an original, booming fictional narrator who cheers the player on at milestones ----------------------------
  ...P('mega_hero', 'hero_first_fare', [
    ['hero_first_1', 'మొదటి ఫేర్! ఇదే మొదలు, ఇక ఆపేది లేదు!', 'Modati fare! Ide modalu, ika aapedi ledu!', 'First fare! This is the beginning, and nothing stops you now!', { mood: 'happy' }],
    ['hero_first_2', 'ఇవాళ ఆటో కాదు, ఆయుధం! హైదరాబాద్ నీదే!', 'Ivala auto kaadu, aayudham! Hyderabad needhe!', 'Today it is not an auto, it is a weapon! Hyderabad is yours!', { mood: 'happy' }],
  ]),
  ...P('mega_hero', 'hero_streak', [
    ['hero_streak_1', 'ఐదు రైడ్లు వరుసగా! నువ్వు ఆపలేని తుఫాన్!', 'Aidu rides varusaga! Nuvvu aapaleni tufaan!', 'Five rides in a row! You are an unstoppable storm!', { mood: 'happy' }],
    ['hero_streak_2', 'హ్యాట్రిక్ దాటేశావ్! రోడ్డు నీ రాజ్యం!', 'Hat-trick daatesav! Roddu nee rajyam!', 'You are past the hat-trick! The road is your kingdom!', { mood: 'happy' }],
  ]),
  ...P('mega_hero', 'hero_earn_1000', [
    ['hero_1k_1', 'వెయ్యి రూపాయలు! చిన్న మొదలు, పెద్ద కథ!', 'Veyyi rupayalu! Chinna modalu, pedda katha!', 'A thousand rupees! A small start, a big story!', { mood: 'happy' }],
    ['hero_1k_2', 'వెయ్యి కొట్టావ్! ఇంకా సినిమా మొదలే!', 'Veyyi kottav! Inka cinema modale!', 'You hit a thousand! The film has only just begun!', { mood: 'happy' }],
  ]),
  ...P('mega_hero', 'hero_earn_5000', [
    ['hero_5k_1', 'ఐదు వేలు! ఇది సంపాదన కాదు, సామ్రాజ్యం!', 'Aidu velu! Idi sampaadana kaadu, saamraajyam!', 'Five thousand! This is not earnings, it is an empire!', { mood: 'happy' }],
    ['hero_5k_2', 'ఐదు వేలు దాటావ్! సిటీ మొత్తం నీ పేరే మోగుతోంది!', 'Aidu velu daatav! City mottham nee pere mogutondi!', 'Past five thousand! The whole city rings with your name!', { mood: 'happy' }],
  ]),
  ...P('mega_hero', 'hero_drift', [
    ['hero_drift_1', 'ఆ డ్రిఫ్ట్ చూశావా! రోడ్డే వణికింది!', 'Aa drift choosava! Roddhe vanikindi!', 'Did you see that drift! The road itself trembled!', { mood: 'surprised' }],
    ['hero_drift_2', 'టైర్ల మీద నాట్యం చేశావ్!', 'Tirla meeda natyam chesav!', 'You danced on those tyres!', { mood: 'surprised' }],
  ]),
  ...P('mega_hero', 'hero_jump', [
    ['hero_jump_1', 'ఆకాశంలో ఆటో! ఇదే అసలు హీరోయిజం!', 'Aakasamlo auto! Ide asalu heroism!', 'An auto in the sky! This is real heroism!', { mood: 'surprised' }],
    ['hero_jump_2', 'గాల్లో ఎగిరావ్, నేల వణికింది!', 'Gaallo egiraav, nela vanikindi!', 'You flew through the air, and the ground shook!', { mood: 'surprised' }],
  ]),
  ...P('mega_hero', 'hero_night', [
    ['hero_night_1', 'రాత్రి మొదలైంది! ఇప్పుడు అసలైన ఆట!', 'Raathri modalaindi! Ippudu asalaina aata!', 'Night has begun! Now the real game starts!', { mood: 'neutral' }],
    ['hero_night_2', 'చీకటి పడితేనే హీరో వెలుగుతాడు!', 'Cheekati padithene hero velugutadu!', 'A hero shines only when darkness falls!', { mood: 'neutral' }],
  ]),
  ...P('mega_hero', 'hero_rain', [
    ['hero_rain_1', 'వాన పడుతోంది! జారుతున్న రోడ్డు, ఆగని నువ్వు!', 'Vaana padutondi! Jaarutunna roddu, aagani nuvvu!', 'It is raining! A slippery road, and you do not stop!', { mood: 'neutral' }],
    ['hero_rain_2', 'వర్షంలో కూడా నీ ఆటో గర్జించాలి!', 'Varshamlo kooda nee auto garjinchali!', 'Even in the rain, your auto must roar!', { mood: 'neutral' }],
  ]),
  ...P('mega_hero', 'hero_fuel', [
    ['hero_fuel_1', 'ట్యాంక్ ఖాళీ అవుతోంది! బంక్ కి పో, హీరో!', 'Tank khaali avutondi! Bunk ki po, hero!', 'The tank is running dry! Head to the pump, hero!', { mood: 'neutral' }],
    ['hero_fuel_2', 'గ్యాస్ తక్కువ! నింపుకో, తర్వాత చెలరేగు!', 'Gas takkuva! Nimpuko, tarvata chelaregu!', 'Gas is low! Fill up, then go wild!', { mood: 'neutral' }],
  ]),
  ...P('mega_hero', 'hero_workshop', [
    ['hero_shop_1', 'కొత్త పార్ట్! ఇప్పుడు నీ ఆటో నీ స్టైల్!', 'Kotta part! Ippudu nee auto nee style!', 'A new part! Now your auto has your style!', { mood: 'happy' }],
    ['hero_shop_2', 'మొదటి మార్పు! ఇది ఇంకా ట్రైలర్ మాత్రమే!', 'Modati maarpu! Idi inka trailer maatrame!', 'The first upgrade! This is only the trailer!', { mood: 'happy' }],
  ]),
  ...P('mega_hero', 'hero_escape', [
    ['hero_escape_1', 'తప్పించుకున్నావ్! వాళ్ళకి దుమ్ము మాత్రమే మిగిలింది!', 'Tappinchukunnav! Vallaki dummu maatrame migilindi!', 'You escaped! All they got was dust!', { mood: 'happy' }],
    ['hero_escape_2', 'మాయమైపోయావ్! ఇదే అసలైన ఎస్కేప్!', 'Maayamaipoyav! Ide asalaina escape!', 'You vanished! That is a real escape!', { mood: 'surprised' }],
  ]),
  ...P('mega_hero', 'hero_caught', [
    ['hero_caught_1', 'పట్టుబడ్డావ్... కానీ హీరో మళ్ళీ లేస్తాడు!', 'Pattubaddav... kani hero malli lestadu!', 'Caught... but a hero always gets back up!', { mood: 'sad' }],
    ['hero_caught_2', 'జరిమానా కట్టు, రేపు మళ్ళీ ఆట మొదలు!', 'Jarimana kattu, repu malli aata modalu!', 'Pay the fine; tomorrow the game starts again!', { mood: 'sad' }],
  ]),
  ...P('mega_hero', 'hero_garage', [
    ['hero_garage_1', 'గ్యారేజ్ కి తిరిగొచ్చావ్! హీరో ఎప్పుడూ ఇంటికే వస్తాడు!', 'Garage ki tirigochchav! Hero eppudu intike vastadu!', 'Back at the garage! A hero always comes home!', { mood: 'happy' }],
    ['hero_garage_2', 'విశ్రాంతి తీసుకో, రేపు మళ్ళీ రోడ్డు పిలుస్తుంది!', 'Vishraanti teesuko, repu malli roddu pilustundi!', 'Rest up, tomorrow the road calls again!', { mood: 'neutral' }],
  ]),
];

export const LINES_BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l]));
export const getLine = (id) => LINES_BY_ID[id] || null;
export const isHeroLine = (l) => l?.persona === 'mega_hero';

/** Telugu Unicode block check used by the tests and the generator (letters + digits + danda live in U+0C00..U+0C7F). */
export const hasTelugu = (s) => /[ఀ-౿]/.test(String(s));

/** Everything the generator sends to the TTS provider for one line (the spoken text is the Telugu script). */
export function ttsRequest(line) {
  const persona = PERSONAS[line.persona];
  return {
    text: line.te,
    lang: 'te',
    persona: line.persona,
    style: { brief: persona.brief, mood: line.mood || persona.voice.emotion, voice: persona.voice },
  };
}
