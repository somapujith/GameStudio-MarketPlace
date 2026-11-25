// Tiffin Centre: how every dish is made. Pure data, no DOM. Used by the tutorial's recipe cards (tutorial.js) and by the HUD's
// action sheet. One entry per dish of the catalogue (a test fails when a dish has no recipe):
//
//   RECIPES[dishId] = {
//     station,                       the station KIND that makes it (always DISHES[id].station)
//     steps:  [3-6 short imperative lines]   English
//     te:     the same lines in Telugu       (index i is the translation of steps[i])
//     hi:     the same lines in Hindi        (index i is the translation of steps[i])
//     tip, tipTe, tipHi              one line: what "ready" looks like and what to watch
//     uses:   [{ item, name, te, hi, qty, label }]   what ONE dish takes from the shelf (DISHES[id].uses; `label` is the portion as 1/2, 1 1/4 ...)
//   }
//
//   PREP_RECIPES[ingredientId] = {   the back-counter jobs (INGREDIENTS[id].prep): what goes in and how it is made
//     item, station: 'prep1', needs: null | 'power' | 'gas',
//     goes / goesTe / goesHi         [2-4 lines] what goes INTO it (the ingredient list)
//     steps / te / hi                [3 lines]   how it is made, same index = same line in each language
//     tip, tipTe, tipHi
//   }
//
// NOTE for reviewers: the Telugu and Hindi lines are written to sound like a street stall, not word for word; they are flagged for
// review by a native speaker, like the dialogue lines. RECIPE_REVIEW lists what still needs that review (the prep recipes are new).
import { DISHES, INGREDIENTS } from './catalog.js';

export { PREP_RECIPES, prepRecipeFor, prepRecipeSteps, prepRecipeGoes, prepRecipeTip } from './recipes.prep.js';

/** Native-speaker review status: `te` / `hi` true = the lines are still to be checked by a native speaker (the HUD may show a small badge in dev builds). */
export const RECIPE_REVIEW = Object.freeze({ te: true, hi: true, scope: 'all recipe lines, ingredient names and prep recipes' });

/** Hindi names of the ingredients (the English and Telugu names live in the catalogue). */
export const INGREDIENT_HI = Object.freeze({
  batter_dosa: 'डोसा घोल', batter_idly: 'इडली घोल', batter_pesarattu: 'पेसरट्टू घोल', potato_masala: 'आलू मसाला', coconut_chutney: 'नारियल चटनी',
  sambar: 'सांभर', podi_ghee: 'पोडी और घी', poori_dough: 'पूरी का आटा', vada_batter: 'वड़ा घोल', besan_batter: 'बेसन घोल', mirchi: 'बज्जी मिर्च',
  tea_decoction_milk: 'चाय काढ़ा और दूध', coffee_decoction: 'कॉफ़ी डिकॉक्शन', biscuits: 'उस्मानिया बिस्कुट', oil: 'खाने का तेल',
});

const FRACTION = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };
/** A portion as a short label: 0.25 -> '1/4', 1.25 -> '1 1/4', 2 -> '2'. */
export function portionLabel(q) {
  const whole = Math.floor(q);
  const part = Math.round((q - whole) * 100) / 100;
  const f = part ? FRACTION[part] || String(part) : '';
  return whole && f ? `${whole} ${f}` : f || String(whole);
}

/** What one dish takes from the shelf: [{ item, name, te, hi, qty, label }] in the catalogue's order. */
export function ingredientsOf(dishId) {
  if (!Object.hasOwn(DISHES, dishId) || !DISHES[dishId].uses) return [];
  return Object.entries(DISHES[dishId].uses).map(([item, qty]) => ({
    item, name: INGREDIENTS[item].name, te: INGREDIENTS[item].te, hi: INGREDIENT_HI[item], qty, label: portionLabel(qty),
  }));
}

const R = (dish, def) => Object.freeze({ station: DISHES[dish].station, uses: Object.freeze(ingredientsOf(dish)), ...def });

export const RECIPES = Object.freeze({
  dosa: R('dosa', {
    steps: [
      'Wipe the hot tawa with the oil onion',
      'Pour a ladle of batter in the middle',
      'Spread it in a spiral with the back of the ladle',
      'Drizzle oil round the edge and let it turn golden',
      'Lift it with the spatula the moment it is ready',
    ],
    te: [
      'నూనెలో ముంచిన ఉల్లిపాయతో వేడి పెనం తుడవండి',
      'గరిటెతో పిండి మధ్యలో పోయండి',
      'గరిటె వెనుక భాగంతో గుండ్రంగా పలుచగా పరచండి',
      'అంచుల చుట్టూ నూనె వేసి బంగారు రంగు రానివ్వండి',
      'సిద్ధం అవ్వగానే అట్లకాడతో తీయండి',
    ],
    hi: [
      'तेल में डूबे प्याज़ से गरम तवा पोंछें',
      'कलछी से बीच में घोल डालें',
      'कलछी के पीछे से गोल-गोल पतला फैलाएँ',
      'किनारों पर तेल डालें और सुनहरा होने दें',
      'तैयार होते ही पलटे से उतार लें',
    ],
    tip: 'Golden with the edges lifting means ready. Lift it fast: it burns a few seconds later.',
    tipTe: 'బంగారు రంగులో అంచులు లేస్తే సిద్ధం. వెంటనే తీయండి, లేకపోతే మాడిపోతుంది.',
    tipHi: 'सुनहरा हो और किनारे उठने लगें तो तैयार है। तुरंत उतारें, वरना जल जाएगा।',
  }),
  masala_dosa: R('masala_dosa', {
    steps: [
      'Wipe the tawa and spread the batter thin',
      'Drizzle oil and cook until the base is crisp',
      'Spoon the potato masala onto one half',
      'Fold the dosa over with the spatula',
      'Lift it while it is crisp and golden',
    ],
    te: [
      'పెనం తుడిచి పిండిని పలుచగా పరచండి',
      'నూనె చల్లి అడుగు కరకరలాడే వరకు కాల్చండి',
      'ఒక వైపు బంగాళాదుంప మసాలా వేయండి',
      'అట్లకాడతో దోశను మడతపెట్టండి',
      'కరకరలాడుతూ బంగారు రంగులో ఉండగా తీయండి',
    ],
    hi: [
      'तवा पोंछें और घोल पतला फैलाएँ',
      'तेल डालें और नीचे से कुरकुरा होने दें',
      'एक आधे हिस्से पर आलू का मसाला रखें',
      'पलटे से डोसा मोड़ दें',
      'कुरकुरा और सुनहरा होते ही उतार लें',
    ],
    tip: 'Thin and crisp, folded over the masala. It takes a little longer than a plain dosa.',
    tipTe: 'పలుచగా కరకరలాడుతూ, మసాలా మీద మడత. సాదా దోశ కంటే కొంచెం ఎక్కువ సమయం పడుతుంది.',
    tipHi: 'पतला और कुरकुरा, मसाले पर मुड़ा हुआ। सादे डोसे से थोड़ा ज़्यादा समय लगता है।',
  }),
  podi_dosa: R('podi_dosa', {
    steps: [
      'Wipe the tawa and spread the batter',
      'Smear ghee over the top',
      'Sprinkle the spicy podi (gunpowder)',
      'Let the ghee sizzle, then fold it',
      'Lift it hot, while the podi is fragrant',
    ],
    te: [
      'పెనం తుడిచి పిండి పరచండి',
      'పైన నెయ్యి రాయండి',
      'కారం పొడి (గన్‌పౌడర్) చల్లండి',
      'నెయ్యి చిటపటలాడాక మడతపెట్టండి',
      'పొడి ఘుమఘుమలాడుతుండగా వేడిగా తీయండి',
    ],
    hi: [
      'तवा पोंछें और घोल फैलाएँ',
      'ऊपर घी लगाएँ',
      'तीखा पोडी (गनपाउडर) छिड़कें',
      'घी चटकने दें, फिर मोड़ दें',
      'पोडी की खुशबू आते ही गरम उतार लें',
    ],
    tip: 'When the ghee smell fills the stall it is ready. Do not wait: ghee burns quickly.',
    tipTe: 'నెయ్యి వాసన వస్తే సిద్ధం. ఆలస్యం వద్దు, నెయ్యి త్వరగా మాడుతుంది.',
    tipHi: 'घी की खुशबू फैले तो तैयार है। देर न करें, घी जल्दी जलता है।',
  }),
  set_dosa: R('set_dosa', {
    steps: [
      'Wipe the tawa',
      'Pour three small thick discs',
      'Let the tops turn spongy with tiny holes',
      'Flip once, only for a few seconds',
      'Lift all three together',
    ],
    te: [
      'పెనం తుడవండి',
      'మూడు చిన్న మందపాటి దోశలు పోయండి',
      'పైన చిన్న రంధ్రాలు పడి స్పంజీగా అయ్యే వరకు ఉంచండి',
      'ఒక్కసారి మాత్రమే తిప్పి కొద్ది సెకన్లు కాల్చండి',
      'మూడూ కలిపి తీయండి',
    ],
    hi: [
      'तवा पोंछें',
      'तीन छोटे मोटे डोसे डालें',
      'ऊपर छोटे छेद पड़कर स्पंजी होने दें',
      'बस एक बार पलटें, कुछ ही सेकंड',
      'तीनों साथ उतार लें',
    ],
    tip: 'Soft and spongy, never crisp. Serve the three together with chutney.',
    tipTe: 'మెత్తగా స్పంజీగా ఉండాలి, కరకరలాడకూడదు. మూడూ చట్నీతో కలిపి ఇవ్వండి.',
    tipHi: 'नरम और स्पंजी, कुरकुरा नहीं। तीनों साथ चटनी के साथ परोसें।',
  }),
  pesarattu: R('pesarattu', {
    steps: [
      'Wipe the tawa and pour the green moong batter',
      'Spread it wide, a little thicker than a dosa',
      'Sprinkle chopped onion, green chilli and ginger',
      'Drizzle oil and cook until the edges are crisp',
      'Lift it with the spatula',
    ],
    te: [
      'పెనం తుడిచి పెసర పిండి పోయండి',
      'దోశ కంటే కొంచెం మందంగా గుండ్రంగా పరచండి',
      'ఉల్లిపాయ, పచ్చిమిర్చి, అల్లం ముక్కలు చల్లండి',
      'నూనె చల్లి అంచులు కరకరలాడే వరకు కాల్చండి',
      'అట్లకాడతో తీయండి',
    ],
    hi: [
      'तवा पोंछें और हरी मूँग का घोल डालें',
      'डोसे से थोड़ा मोटा, चौड़ा फैलाएँ',
      'कटा प्याज़, हरी मिर्च और अदरक छिड़कें',
      'तेल डालें और किनारे कुरकुरे होने तक पकाएँ',
      'पलटे से उतार लें',
    ],
    tip: 'Green and crisp at the edge, soft in the middle. Serve with ginger chutney.',
    tipTe: 'అంచు కరకరలాడుతూ మధ్యలో మెత్తగా, ఆకుపచ్చగా ఉంటుంది. అల్లం చట్నీతో ఇవ్వండి.',
    tipHi: 'किनारे कुरकुरे, बीच में नरम, हरा रंग। अदरक की चटनी के साथ परोसें।',
  }),
  idly: R('idly', {
    steps: [
      'Grease the idly moulds with a little oil',
      'Pour the batter into each mould',
      'Close the lid and let it steam',
      'Open the lid when the idlis are puffed and white',
      'Lift the plate and serve with sambar and chutney',
    ],
    te: [
      'ఇడ్లీ అచ్చులకు కొద్దిగా నూనె రాయండి',
      'ప్రతి అచ్చులో పిండి పోయండి',
      'మూత పెట్టి ఆవిరిపై ఉడకనివ్వండి',
      'ఇడ్లీలు ఉబ్బి తెల్లగా అయ్యాక మూత తీయండి',
      'ప్లేట్ తీసి సాంబార్, చట్నీతో వడ్డించండి',
    ],
    hi: [
      'इडली के साँचों में थोड़ा तेल लगाएँ',
      'हर साँचे में घोल डालें',
      'ढक्कन बंद करके भाप में पकने दें',
      'इडली फूलकर सफ़ेद हो जाए तब ढक्कन खोलें',
      'प्लेट निकालें और सांबर-चटनी के साथ परोसें',
    ],
    tip: 'Idlis take a while but wait nicely in the steam. Puffed, white and soft means ready.',
    tipTe: 'ఇడ్లీ ఉడకడానికి సమయం పడుతుంది కానీ ఆవిరిలో చాలా సేపు ఉంటాయి. ఉబ్బి తెల్లగా మెత్తగా ఉంటే సిద్ధం.',
    tipHi: 'इडली को पकने में समय लगता है, पर भाप में देर तक ठीक रहती है। फूली, सफ़ेद और नरम हो तो तैयार है।',
  }),
  poori: R('poori', {
    steps: [
      'Roll small discs of dough, not too thin',
      'Check the oil is hot: a pinch of dough rises at once',
      'Slide the poori in and press it gently with the jhara',
      'Turn it once when it balloons',
      'Skim it out with the jhara and serve with aloo',
    ],
    te: [
      'పిండిని చిన్న వృత్తాలుగా చేయండి, మరీ పలుచగా వద్దు',
      'నూనె వేడిగా ఉందో చూడండి: చిటికెడు పిండి వెంటనే పైకి తేలాలి',
      'పూరీని నూనెలో వేసి జల్లి గరిటెతో మెల్లగా నొక్కండి',
      'ఉబ్బగానే ఒక్కసారి తిప్పండి',
      'జల్లి గరిటెతో తీసి ఆలూ కూరతో వడ్డించండి',
    ],
    hi: [
      'आटे की छोटी गोल पूरियाँ बेलें, बहुत पतली नहीं',
      'तेल गरम है या नहीं देखें: आटे की चुटकी तुरंत ऊपर आए',
      'पूरी डालें और झारे से हल्के से दबाएँ',
      'फूलते ही एक बार पलटें',
      'झारे से निकालें और आलू की सब्ज़ी के साथ परोसें',
    ],
    tip: 'A puffed, golden poori is ready. If it stays flat, the oil is too cold.',
    tipTe: 'ఉబ్బి బంగారు రంగులో ఉంటే సిద్ధం. ఉబ్బకపోతే నూనె చల్లగా ఉందని అర్థం.',
    tipHi: 'फूली और सुनहरी पूरी तैयार है। फूले नहीं तो तेल ठंडा है।',
  }),
  vada: R('vada', {
    steps: [
      'Wet your palm and shape a thick ring with a hole in the middle',
      'Slide it gently into medium-hot oil',
      'Fry until deep golden and crisp all round',
      'Skim it out with the jhara and drain the oil',
    ],
    te: [
      'అరచేతిని తడిపి మధ్యలో రంధ్రం ఉన్న మందపాటి వడ చేయండి',
      'మధ్యస్థ వేడి నూనెలో మెల్లగా వేయండి',
      'అన్ని వైపులా ముదురు బంగారు రంగు వచ్చే వరకు వేయించండి',
      'జల్లి గరిటెతో తీసి నూనె వడకట్టండి',
    ],
    hi: [
      'हथेली गीली करें और बीच में छेद वाला मोटा वड़ा बनाएँ',
      'मध्यम गरम तेल में धीरे से डालें',
      'चारों ओर गहरा सुनहरा और कुरकुरा होने तक तलें',
      'झारे से निकालें और तेल निथार लें',
    ],
    tip: 'Deep golden outside, soft inside, with the hole still open. Pale means it needs more time.',
    tipTe: 'బయట ముదురు బంగారు రంగు, లోపల మెత్తగా, రంధ్రం తెరిచి ఉండాలి. లేతగా ఉంటే ఇంకా సమయం కావాలి.',
    tipHi: 'बाहर गहरा सुनहरा, अंदर नरम, छेद खुला रहे। हल्का रंग हो तो और समय चाहिए।',
  }),
  mysore_bonda: R('mysore_bonda', {
    steps: [
      'Mix the batter and drop round balls into the oil',
      'Keep the oil medium hot so the inside cooks too',
      'Fry, turning gently, until golden brown',
      'Skim with the jhara and serve with coconut chutney',
    ],
    te: [
      'పిండి కలిపి గుండ్రని ఉండలుగా నూనెలో వదలండి',
      'నూనె మధ్యస్థంగా వేడిగా ఉండాలి, లోపల కూడా ఉడకాలి',
      'మెల్లగా తిప్పుతూ బంగారు గోధుమ రంగు వచ్చే వరకు వేయించండి',
      'జల్లి గరిటెతో తీసి కొబ్బరి చట్నీతో వడ్డించండి',
    ],
    hi: [
      'घोल मिलाकर गोल गोले तेल में डालें',
      'तेल मध्यम गरम रखें ताकि अंदर तक पके',
      'धीरे पलटते हुए सुनहरा भूरा होने तक तलें',
      'झारे से निकालें और नारियल की चटनी के साथ परोसें',
    ],
    tip: 'Round, puffy and golden brown. If it is dark outside but raw inside, the oil was too hot.',
    tipTe: 'గుండ్రంగా ఉబ్బి బంగారు గోధుమ రంగులో ఉండాలి. బయట నల్లగా లోపల పచ్చిగా ఉంటే నూనె మరీ వేడి.',
    tipHi: 'गोल, फूला और सुनहरा भूरा। बाहर काला और अंदर कच्चा हो तो तेल ज़्यादा गरम था।',
  }),
  mirchi_bajji: R('mirchi_bajji', {
    steps: [
      'Slit the big green chilli and stuff a little tamarind salt',
      'Dip it in the besan batter to coat it fully',
      'Slide it into hot oil: it sizzles at once',
      'Fry until the coat is golden and crisp',
      'Skim with the jhara and sprinkle onion and chaat masala',
    ],
    te: [
      'పెద్ద పచ్చిమిర్చిని చీరి కొద్దిగా చింతపండు ఉప్పు నింపండి',
      'శనగపిండిలో ముంచి పూర్తిగా పట్టించండి',
      'వేడి నూనెలో వేయండి, వెంటనే చిటపట మంటుంది',
      'పిండి పొర బంగారు రంగులో కరకరలాడే వరకు వేయించండి',
      'జల్లి గరిటెతో తీసి ఉల్లిపాయ, చాట్ మసాలా చల్లండి',
    ],
    hi: [
      'बड़ी हरी मिर्च चीरकर थोड़ा इमली-नमक भरें',
      'बेसन के घोल में पूरा लपेटें',
      'गरम तेल में डालें, तुरंत छन्न से बोलेगा',
      'परत सुनहरी और कुरकुरी होने तक तलें',
      'झारे से निकालें, प्याज़ और चाट मसाला छिड़कें',
    ],
    tip: 'The besan coat turns golden and crisp. Hot oil is what makes it crunchy, not oily.',
    tipTe: 'శనగపిండి పొర బంగారు రంగులో కరకరలాడాలి. వేడి నూనె వల్లే కరకరలాడుతుంది, జిడ్డుగా ఉండదు.',
    tipHi: 'बेसन की परत सुनहरी और कुरकुरी हो। गरम तेल से ही कुरकुरी बनती है, चिकनी नहीं।',
  }),
  irani_chai: R('irani_chai', {
    steps: [
      'Keep the milk on a slow boil with the thick decoction',
      'Add sugar and a pinch of cardamom',
      'Pour the chai high from one vessel to the other (the long pour)',
      'Pour it into the small glass and serve',
    ],
    te: [
      'చిక్కటి డికాషన్‌తో పాలను మెల్లగా మరగనివ్వండి',
      'చక్కెర, చిటికెడు యాలకులు వేయండి',
      'ఒక పాత్ర నుంచి మరొకదానికి ఎత్తు నుంచి పోయండి (పొడవైన పోత)',
      'చిన్న గ్లాసులో పోసి ఇవ్వండి',
    ],
    hi: [
      'गाढ़े डिकॉक्शन के साथ दूध को धीमी आँच पर उबलने दें',
      'चीनी और चुटकी भर इलायची डालें',
      'एक बर्तन से दूसरे में ऊँचाई से डालें (लंबी धार)',
      'छोटे गिलास में डालकर परोसें',
    ],
    tip: 'The long pour makes it creamy and cools it a little. Serve it while it is hot.',
    tipTe: 'పొడవైన పోత వల్ల క్రీమీగా అవుతుంది, కొంచెం చల్లారుతుంది. వేడిగా ఉండగానే ఇవ్వండి.',
    tipHi: 'लंबी धार से चाय मलाईदार बनती है और थोड़ी ठंडी होती है। गरम-गरम परोसें।',
  }),
  filter_coffee: R('filter_coffee', {
    steps: [
      'Put the coffee powder in the filter and pour hot water',
      'Let the decoction drip down slowly',
      'Mix hot milk and sugar with the decoction',
      'Pull it between the davara and tumbler to make froth',
      'Serve it hot',
    ],
    te: [
      'ఫిల్టర్‌లో కాఫీ పొడి వేసి వేడి నీళ్లు పోయండి',
      'డికాషన్ నెమ్మదిగా కిందకు దిగనివ్వండి',
      'వేడి పాలు, చక్కెర డికాషన్‌లో కలపండి',
      'దవారా, టంబ్లర్ మధ్య పోస్తూ నురగ తెప్పించండి',
      'వేడిగా ఇవ్వండి',
    ],
    hi: [
      'फ़िल्टर में कॉफ़ी पाउडर डालकर गरम पानी डालें',
      'डिकॉक्शन को धीरे-धीरे नीचे टपकने दें',
      'गरम दूध और चीनी डिकॉक्शन में मिलाएँ',
      'दवरा-टम्बलर में ऊपर-नीचे डालकर झाग बनाएँ',
      'गरम-गरम परोसें',
    ],
    tip: 'Froth on top and a strong smell means it is ready. It stays hot for a good while.',
    tipTe: 'పైన నురగ, గాఢమైన వాసన ఉంటే సిద్ధం. చాలా సేపు వేడిగా ఉంటుంది.',
    tipHi: 'ऊपर झाग और तेज़ खुशबू हो तो तैयार है। काफ़ी देर तक गरम रहती है।',
  }),
  osmania: R('osmania', {
    steps: [
      'Take the Osmania biscuits out of the glass jar',
      'Lay a few on a small steel plate',
      'Serve them with the chai while they are crisp',
    ],
    te: [
      'ఉస్మానియా బిస్కెట్లను జాడీలోంచి తీయండి',
      'చిన్న స్టీల్ ప్లేటులో కొన్ని పెట్టండి',
      'కరకరలాడుతుండగానే చాయ్‌తో పాటు ఇవ్వండి',
    ],
    hi: [
      'उस्मानिया बिस्कुट बरनी से निकालें',
      'छोटी स्टील की प्लेट में कुछ रखें',
      'कुरकुरे रहते ही चाय के साथ परोसें',
    ],
    tip: 'The quickest dish of all, and it keeps for a long time. Easy money next to a chai.',
    tipTe: 'అన్నింటికంటే వేగంగా అయ్యేది, చాలా సేపు చెడిపోదు. చాయ్ పక్కన సులభమైన సంపాదన.',
    tipHi: 'सबसे जल्दी बनने वाली चीज़, और देर तक ठीक रहती है। चाय के साथ आसान कमाई।',
  }),
});

export const RECIPE_LANGS = Object.freeze(['en', 'te', 'hi']);

/** The recipe of a dish, or null. */
export const recipeFor = (dishId) => (Object.hasOwn(RECIPES, dishId) ? RECIPES[dishId] : null);

/** The recipe steps of a dish in a language ('en' | 'te' | 'hi'; anything else is English). */
export function recipeSteps(dishId, lang = 'en') {
  const r = recipeFor(dishId);
  if (!r) return [];
  return (lang === 'te' ? r.te : lang === 'hi' ? r.hi : r.steps).slice();
}

/** The one-line tip of a dish in a language. */
export function recipeTip(dishId, lang = 'en') {
  const r = recipeFor(dishId);
  if (!r) return '';
  return (lang === 'te' ? r.tipTe : lang === 'hi' ? r.tipHi : r.tip) || r.tip;
}
