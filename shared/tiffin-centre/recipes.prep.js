// Tiffin Centre: the back counter's recipes: what goes INTO each prepared ingredient and how it is made (INGREDIENTS[id].prep).
// Re-exported by recipes.js. Pure data. The Telugu and Hindi lines are street-stall wording, not word for word, and are flagged for
// native-speaker review (RECIPE_REVIEW in recipes.js).
//
//   PREP_RECIPES[ingredientId] = {
//     item, station: 'prep1', needs: null | 'power' | 'gas',
//     goes / goesTe / goesHi         [2-3 lines] what goes INTO it (the ingredient list)
//     steps / te / hi                [3 lines]   how it is made, the same index is the same line in each language
//     tip, tipTe, tipHi              one line
//   }
import { INGREDIENTS, PREP_STATION } from './catalog.js';

const P = (item, def) => Object.freeze({ item, station: PREP_STATION, needs: INGREDIENTS[item].prep.needs, ...def });

export const PREP_RECIPES = Object.freeze({
  batter_dosa: P('batter_dosa', {
    goes: ['3 parts raw rice and 1 part urad dal', 'A spoon of methi seeds', 'Salt, and water for a flowing batter'],
    goesTe: ['3 భాగాలు బియ్యం, 1 భాగం మినప్పప్పు', 'ఒక చెంచా మెంతులు', 'ఉప్పు, జారుగా ఉండేలా నీళ్లు'],
    goesHi: ['3 हिस्से चावल और 1 हिस्सा उड़द दाल', 'एक चम्मच मेथी दाना', 'नमक और बहने वाले घोल जितना पानी'],
    steps: ['Soak the rice and dal for four hours', 'Grind them smooth in the wet grinder', 'Mix in the salt and let it ferment overnight'],
    te: ['బియ్యం, పప్పు నాలుగు గంటలు నానబెట్టండి', 'వెట్ గ్రైండర్‌లో మెత్తగా రుబ్బండి', 'ఉప్పు కలిపి రాత్రంతా పులియనివ్వండి'],
    hi: ['चावल और दाल चार घंटे भिगोएँ', 'वेट ग्राइंडर में चिकना पीसें', 'नमक मिलाकर रात भर खमीर उठने दें'],
    tip: 'Good batter bubbles and smells a little sour. Left too long it turns bitter: use the oldest batter first.',
    tipTe: 'మంచి పిండి బుడగలతో, కొద్దిగా పులుపు వాసనతో ఉంటుంది. ఎక్కువసేపు ఉంటే చేదు: పాత పిండి ముందు వాడండి.',
    tipHi: 'अच्छा घोल बुलबुलेदार और हल्का खट्टा महकता है। ज़्यादा देर रहे तो कड़वा हो जाता है: पुराना घोल पहले इस्तेमाल करें।',
  }),
  batter_idly: P('batter_idly', {
    goes: ['2 parts idly rava and 1 part urad dal', 'A pinch of methi seeds', 'Salt and water'],
    goesTe: ['2 భాగాలు ఇడ్లీ రవ్వ, 1 భాగం మినప్పప్పు', 'చిటికెడు మెంతులు', 'ఉప్పు, నీళ్లు'],
    goesHi: ['2 हिस्से इडली रवा और 1 हिस्सा उड़द दाल', 'चुटकी भर मेथी दाना', 'नमक और पानी'],
    steps: ['Soak the dal and rinse the rava', 'Grind the dal fluffy and fold in the rava', 'Add salt and let it rise through the night'],
    te: ['పప్పు నానబెట్టి, రవ్వను కడగండి', 'పప్పును మెత్తగా రుబ్బి రవ్వ కలపండి', 'ఉప్పు వేసి రాత్రంతా పొంగనివ్వండి'],
    hi: ['दाल भिगोएँ और रवा धो लें', 'दाल को फूला-फूला पीसें और रवा मिलाएँ', 'नमक डालकर रात भर फूलने दें'],
    tip: 'Risen, fluffy batter makes soft idlis. Do not stir it hard once it has risen.',
    tipTe: 'పొంగిన, తేలికైన పిండితో ఇడ్లీ మెత్తగా వస్తాయి. పొంగాక గట్టిగా కలపకండి.',
    tipHi: 'फूला हुआ हल्का घोल नरम इडली बनाता है। फूलने के बाद ज़ोर से न चलाएँ।',
  }),
  batter_pesarattu: P('batter_pesarattu', {
    goes: ['Whole green moong, soaked', 'A handful of rice for crispness', 'Green chilli, ginger and jeera'],
    goesTe: ['నానబెట్టిన పెసలు', 'కరకరలాడడానికి కొద్దిగా బియ్యం', 'పచ్చిమిర్చి, అల్లం, జీలకర్ర'],
    goesHi: ['भिगोई हुई साबुत हरी मूंग', 'कुरकुरेपन के लिए मुट्ठी भर चावल', 'हरी मिर्च, अदरक और जीरा'],
    steps: ['Soak the green moong and rice for four hours', 'Grind with the chilli, ginger and jeera', 'Add salt and water to a pouring thickness'],
    te: ['పెసలు, బియ్యం నాలుగు గంటలు నానబెట్టండి', 'మిర్చి, అల్లం, జీలకర్రతో రుబ్బండి', 'ఉప్పు, నీళ్లు కలిపి పోసే పదునుకు తీసుకురండి'],
    hi: ['मूंग और चावल चार घंटे भिगोएँ', 'मिर्च, अदरक और जीरे के साथ पीसें', 'नमक और पानी मिलाकर डालने लायक गाढ़ा करें'],
    tip: 'It settles, so stir before every ladle. In the heat it goes off within the day.',
    tipTe: 'పిండి అడుగున కూరుకుపోతుంది, ప్రతి గరిటెకు ముందు కలపండి. ఎండలో ఒక్క రోజులోనే పాడవుతుంది.',
    tipHi: 'घोल नीचे बैठ जाता है, हर कलछी से पहले चलाएँ। गरमी में एक दिन में खराब हो जाता है।',
  }),
  potato_masala: P('potato_masala', {
    goes: ['Boiled and mashed potatoes', 'Onion, green chilli and curry leaves', 'Mustard, turmeric and a spoon of oil'],
    goesTe: ['ఉడికించి మెదిపిన బంగాళాదుంపలు', 'ఉల్లిపాయ, పచ్చిమిర్చి, కరివేపాకు', 'ఆవాలు, పసుపు, ఒక చెంచా నూనె'],
    goesHi: ['उबले और मसले हुए आलू', 'प्याज़, हरी मिर्च और करी पत्ता', 'सरसों, हल्दी और एक चम्मच तेल'],
    steps: ['Boil, peel and mash the potatoes', 'Temper mustard, curry leaves, onion and chilli in oil', 'Add turmeric and salt, then mix in the potato'],
    te: ['బంగాళాదుంపలు ఉడికించి, తొక్క తీసి మెదపండి', 'నూనెలో ఆవాలు, కరివేపాకు, ఉల్లి, మిర్చి పోపు వేయండి', 'పసుపు, ఉప్పు వేసి బంగాళాదుంప కలపండి'],
    hi: ['आलू उबालें, छीलें और मसलें', 'तेल में सरसों, करी पत्ता, प्याज़ और मिर्च का तड़का लगाएँ', 'हल्दी और नमक डालकर आलू मिलाएँ'],
    tip: 'Dry and fluffy, not mushy, so it stays inside the dosa. The tadka needs the gas stove.',
    tipTe: 'పొడిగా, మెత్తగా ఉండాలి, ముద్దగా కాదు, అప్పుడే దోశలో నిలుస్తుంది. పోపుకు గ్యాస్ కావాలి.',
    tipHi: 'सूखा और भुरभुरा हो, लसलसा नहीं, तभी डोसे के अंदर टिकेगा। तड़के के लिए गैस चाहिए।',
  }),
  coconut_chutney: P('coconut_chutney', {
    goes: ['Fresh grated coconut', 'Green chilli and roasted chana dal', 'Salt, a little tamarind and water'],
    goesTe: ['తాజా కొబ్బరి తురుము', 'పచ్చిమిర్చి, వేయించిన పుట్నాల పప్పు', 'ఉప్పు, కొద్దిగా చింతపండు, నీళ్లు'],
    goesHi: ['ताज़ा कसा नारियल', 'हरी मिर्च और भुनी चने की दाल', 'नमक, थोड़ी इमली और पानी'],
    steps: ['Put the coconut, chilli and dal on the grinding stone', 'Grind with a little water into a smooth paste', 'Finish with a mustard and curry-leaf tadka'],
    te: ['కొబ్బరి, మిర్చి, పప్పు రుబ్బురాయిపై వేయండి', 'కొద్దిగా నీళ్లతో మెత్తని ముద్దగా రుబ్బండి', 'ఆవాలు, కరివేపాకు పోపు పెట్టండి'],
    hi: ['नारियल, मिर्च और दाल सिल पर रखें', 'थोड़े पानी के साथ चिकना पीस लें', 'सरसों और करी पत्ते का तड़का लगाएँ'],
    tip: 'Made fresh every day, and it is the cheapest thing on the plate. It is also what customers ask extra of.',
    tipTe: 'ప్రతి రోజూ తాజాగా చేయాలి, ప్లేటులో అన్నింటికంటే చవక. కస్టమర్లు ఎక్కువగా అడిగేది కూడా ఇదే.',
    tipHi: 'हर दिन ताज़ा बनाएँ, प्लेट की सबसे सस्ती चीज़ है। ग्राहक सबसे ज़्यादा यही एक्स्ट्रा माँगते हैं।',
  }),
  sambar: P('sambar', {
    goes: ['Toor dal, boiled soft', 'Drumstick, brinjal and tomato', 'Sambar powder, tamarind and a mustard tadka'],
    goesTe: ['మెత్తగా ఉడికించిన కందిపప్పు', 'మునగకాయ, వంకాయ, టమాటా', 'సాంబార్ పొడి, చింతపండు, ఆవాల పోపు'],
    goesHi: ['नरम उबली अरहर की दाल', 'सहजन, बैंगन और टमाटर', 'सांभर मसाला, इमली और सरसों का तड़का'],
    steps: ['Boil the toor dal until it mashes', 'Add the vegetables, tamarind water and sambar powder and simmer', 'Finish with a mustard and curry-leaf tadka'],
    te: ['కందిపప్పు మెత్తగా మెదిగే వరకు ఉడికించండి', 'కూరగాయలు, చింతపండు నీళ్లు, సాంబార్ పొడి వేసి మరిగించండి', 'ఆవాలు, కరివేపాకు పోపు పెట్టండి'],
    hi: ['अरहर की दाल मसलने लायक होने तक उबालें', 'सब्ज़ियाँ, इमली का पानी और सांभर मसाला डालकर पकाएँ', 'सरसों और करी पत्ते का तड़का लगाएँ'],
    tip: 'The pot needs gas: an empty cylinder stops it. Make plenty before the idly rush.',
    tipTe: 'గిన్నెకు గ్యాస్ కావాలి, సిలిండర్ ఖాళీ అయితే ఆగిపోతుంది. ఇడ్లీ రద్దీకి ముందే ఎక్కువ చేయండి.',
    tipHi: 'बर्तन को गैस चाहिए: सिलेंडर खाली तो रुक जाएगा। इडली की भीड़ से पहले ज़्यादा बना लें।',
  }),
  podi_ghee: P('podi_ghee', {
    goes: ['Gunpowder (podi): chana dal, urad dal, red chilli', 'Pure ghee', 'A pinch of salt'],
    goesTe: ['కారప్పొడి: శనగపప్పు, మినప్పప్పు, ఎండు మిర్చి', 'స్వచ్ఛమైన నెయ్యి', 'చిటికెడు ఉప్పు'],
    goesHi: ['गनपाउडर पोडी: चने की दाल, उड़द दाल, लाल मिर्च', 'शुद्ध घी', 'चुटकी भर नमक'],
    steps: ['Roast the dals and red chilli and grind to a coarse powder', 'Warm the ghee gently', 'Mix the podi into the ghee until it is a paste'],
    te: ['పప్పులు, ఎండు మిర్చి వేయించి కచ్చాపచ్చాగా రుబ్బండి', 'నెయ్యిని కొద్దిగా వెచ్చ చేయండి', 'పొడిని నెయ్యిలో పేస్టులా కలపండి'],
    hi: ['दालें और लाल मिर्च भूनकर दरदरा पीस लें', 'घी को हल्का गरम करें', 'पोडी को घी में पेस्ट जैसा मिलाएँ'],
    tip: 'The dearest topping on the menu. Spread it thin, it goes a long way.',
    tipTe: 'మెనూలో అన్నింటికంటే ఖరీదైన టాపింగ్. పలుచగా రాయండి, చాలా వస్తుంది.',
    tipHi: 'मेनू की सबसे महँगी टॉपिंग है। पतली लगाएँ, बहुत चलती है।',
  }),
  poori_dough: P('poori_dough', {
    goes: ['Wheat flour (atta)', 'A pinch of salt and a spoon of oil', 'Water to knead a stiff dough'],
    goesTe: ['గోధుమ పిండి', 'చిటికెడు ఉప్పు, ఒక చెంచా నూనె', 'గట్టి ముద్దకు సరిపడా నీళ్లు'],
    goesHi: ['गेहूँ का आटा', 'चुटकी भर नमक और एक चम्मच तेल', 'सख्त आटा गूँधने जितना पानी'],
    steps: ['Mix the atta, salt and oil', 'Knead with water into a stiff dough', 'Rest it under a wet cloth, then make small balls'],
    te: ['పిండి, ఉప్పు, నూనె కలపండి', 'నీళ్లతో గట్టి ముద్దగా కలపండి', 'తడి గుడ్డ కింద నానబెట్టి చిన్న ఉండలు చేయండి'],
    hi: ['आटा, नमक और तेल मिलाएँ', 'पानी से सख्त आटा गूँधें', 'गीले कपड़े के नीचे रखकर छोटी लोइयाँ बनाएँ'],
    tip: 'A stiff dough puffs up in hot oil. A soft one just soaks the oil.',
    tipTe: 'గట్టి పిండి వేడి నూనెలో పొంగుతుంది. మెత్తగా ఉంటే నూనె పీల్చేస్తుంది.',
    tipHi: 'सख्त आटा गरम तेल में फूलता है। नरम आटा बस तेल पी जाता है।',
  }),
  vada_batter: P('vada_batter', {
    goes: ['Urad dal, soaked', 'Green chilli, ginger, curry leaves and pepper', 'Salt and very little water'],
    goesTe: ['నానబెట్టిన మినప్పప్పు', 'పచ్చిమిర్చి, అల్లం, కరివేపాకు, మిరియాలు', 'ఉప్పు, చాలా కొద్దిగా నీళ్లు'],
    goesHi: ['भिगोई हुई उड़द दाल', 'हरी मिर्च, अदरक, करी पत्ता और काली मिर्च', 'नमक और बहुत थोड़ा पानी'],
    steps: ['Soak the urad dal for three hours', 'Grind with very little water into a thick, fluffy batter', 'Mix in the chilli, ginger, curry leaf and pepper'],
    te: ['మినప్పప్పు మూడు గంటలు నానబెట్టండి', 'కొద్దిగా నీళ్లతో మందంగా, తేలికగా రుబ్బండి', 'మిర్చి, అల్లం, కరివేపాకు, మిరియాలు కలపండి'],
    hi: ['उड़द दाल तीन घंटे भिगोएँ', 'बहुत कम पानी से गाढ़ा और फूला पीसें', 'मिर्च, अदरक, करी पत्ता और काली मिर्च मिलाएँ'],
    tip: 'Thick batter holds the hole in the vada. Wet your hand before you shape it.',
    tipTe: 'మందపాటి పిండి వడలో రంధ్రాన్ని నిలబెడుతుంది. ఆకారం ఇచ్చే ముందు చేయి తడి చేసుకోండి.',
    tipHi: 'गाढ़ा घोल वड़े का छेद बनाए रखता है। आकार देने से पहले हाथ गीला कर लें।',
  }),
  besan_batter: P('besan_batter', {
    goes: ['Besan (gram flour)', 'Ajwain, salt and red chilli powder', 'A pinch of soda and water'],
    goesTe: ['సెనగపిండి', 'వాము, ఉప్పు, కారం', 'చిటికెడు సోడా, నీళ్లు'],
    goesHi: ['बेसन', 'अजवाइन, नमक और लाल मिर्च पाउडर', 'चुटकी भर सोडा और पानी'],
    steps: ['Sift the besan into a bowl', 'Add the ajwain, salt, chilli and soda', 'Whisk with water until thick and smooth'],
    te: ['సెనగపిండిని జల్లెడ పట్టి గిన్నెలో వేయండి', 'వాము, ఉప్పు, కారం, సోడా కలపండి', 'నీళ్లతో మందంగా, మెత్తగా గిలకొట్టండి'],
    hi: ['बेसन छानकर कटोरे में डालें', 'अजवाइन, नमक, मिर्च और सोडा मिलाएँ', 'पानी के साथ गाढ़ा और चिकना फेंटें'],
    tip: 'It should coat the back of a spoon. Too thin and the bajji goes soggy.',
    tipTe: 'చెంచా వెనుక అంటుకునేంత ఉండాలి. పలచగా ఉంటే బజ్జీ తడిగా అవుతుంది.',
    tipHi: 'चम्मच के पीछे चिपकने जितना गाढ़ा हो। पतला हुआ तो बज्जी गीली हो जाएगी।',
  }),
  mirchi: P('mirchi', {
    goes: ['Fat green bajji chillies', 'Tamarind and salt for the stuffing', 'Roasted sesame and jeera'],
    goesTe: ['లావుపాటి బజ్జీ మిరపకాయలు', 'కూరడానికి చింతపండు, ఉప్పు', 'వేయించిన నువ్వులు, జీలకర్ర'],
    goesHi: ['मोटी हरी बज्जी मिर्च', 'भरने के लिए इमली और नमक', 'भुने तिल और जीरा'],
    steps: ['Wash the chillies and slit them lengthways', 'Take out the seeds and stuff in the tamarind mix', 'Keep them ready to dip in the besan'],
    te: ['మిరపకాయలు కడిగి పొడవుగా చీల్చండి', 'గింజలు తీసి చింతపండు మిశ్రమం కూరండి', 'సెనగపిండిలో ముంచడానికి సిద్ధంగా ఉంచండి'],
    hi: ['मिर्च धोकर लंबाई में चीरें', 'बीज निकालकर इमली का मसाला भरें', 'बेसन में डुबोने के लिए तैयार रखें'],
    tip: 'Pick the fat, mild chillies. The seeds are what make it hot.',
    tipTe: 'లావుగా, ఘాటు తక్కువగా ఉండే మిరపకాయలు తీసుకోండి. గింజలే కారం.',
    tipHi: 'मोटी और कम तीखी मिर्च चुनें। तीखापन बीजों में होता है।',
  }),
  tea_decoction_milk: P('tea_decoction_milk', {
    goes: ['Strong tea decoction', 'Full-cream milk and sugar', 'A crushed cardamom'],
    goesTe: ['గాఢమైన టీ డికాషన్', 'చిక్కని పాలు, చక్కెర', 'చితక్కొట్టిన యాలకి'],
    goesHi: ['कड़क चाय का काढ़ा', 'फुल-क्रीम दूध और चीनी', 'कुटी हुई इलायची'],
    steps: ['Boil the tea leaves into a dark decoction', 'Add the milk and sugar and bring to the boil', 'Keep it simmering on a low flame'],
    te: ['టీ ఆకులను ముదురు డికాషన్‌గా మరిగించండి', 'పాలు, చక్కెర వేసి పొంగే వరకు మరిగించండి', 'తక్కువ మంటపై ఉడుకుతూ ఉండనివ్వండి'],
    hi: ['चाय की पत्ती उबालकर गाढ़ा काढ़ा बनाएँ', 'दूध और चीनी डालकर उबाल आने दें', 'धीमी आँच पर पकते रहने दें'],
    tip: 'Irani chai is slow-simmered, so it needs the gas. Fill the pot before the evening crowd.',
    tipTe: 'ఇరానీ చాయ్ నెమ్మదిగా ఉడకాలి, గ్యాస్ కావాలి. సాయంత్రం రద్దీకి ముందే గిన్నె నింపండి.',
    tipHi: 'ईरानी चाय धीमी आँच पर पकती है, इसलिए गैस चाहिए। शाम की भीड़ से पहले पतीला भर लें।',
  }),
  coffee_decoction: P('coffee_decoction', {
    goes: ['Filter coffee powder with chicory', 'Boiling water', 'Hot milk and sugar'],
    goesTe: ['షికోరీ కలిపిన ఫిల్టర్ కాఫీ పొడి', 'మరుగుతున్న నీళ్లు', 'వేడి పాలు, చక్కెర'],
    goesHi: ['चिकोरी मिला फ़िल्टर कॉफ़ी पाउडर', 'खौलता पानी', 'गरम दूध और चीनी'],
    steps: ['Put the coffee powder in the top of the filter', 'Pour in boiling water and let the decoction drip down', 'Boil the milk and keep both ready'],
    te: ['ఫిల్టర్ పై భాగంలో కాఫీ పొడి వేయండి', 'మరిగే నీళ్లు పోసి డికాషన్ కిందకు దిగనివ్వండి', 'పాలు మరిగించి రెండూ సిద్ధంగా ఉంచండి'],
    hi: ['फ़िल्टर के ऊपर कॉफ़ी पाउडर डालें', 'खौलता पानी डालकर डिकॉक्शन टपकने दें', 'दूध उबालकर दोनों तैयार रखें'],
    tip: 'The first decoction is the strongest. Do not rush the drip.',
    tipTe: 'మొదటి డికాషన్ అన్నింటికంటే గాఢంగా ఉంటుంది. చుక్కలు పడే వరకు తొందరపడకండి.',
    tipHi: 'पहला डिकॉक्शन सबसे कड़क होता है। टपकने में जल्दबाज़ी न करें।',
  }),
  biscuits: P('biscuits', {
    goes: ['A carton of Osmania biscuits', 'A glass jar with a lid'],
    goesTe: ['ఉస్మానియా బిస్కెట్ల డబ్బా', 'మూతతో ఉన్న గాజు జాడీ'],
    goesHi: ['उस्मानिया बिस्कुट का डिब्बा', 'ढक्कन वाली काँच की बरनी'],
    steps: ['Open the carton of Osmania biscuits', 'Fill the glass jar and shut the lid', 'Keep the jar next to the chai counter'],
    te: ['ఉస్మానియా బిస్కెట్ల డబ్బా తెరవండి', 'గాజు జాడీ నింపి మూత పెట్టండి', 'జాడీని చాయ్ కౌంటర్ పక్కన ఉంచండి'],
    hi: ['उस्मानिया बिस्कुट का डिब्बा खोलें', 'काँच की बरनी भरकर ढक्कन बंद करें', 'बरनी को चाय काउंटर के पास रखें'],
    tip: 'Keep the lid shut in the rain or they go soft.',
    tipTe: 'వానలో మూత గట్టిగా పెట్టండి, లేకపోతే మెత్తబడతాయి.',
    tipHi: 'बारिश में ढक्कन बंद रखें, नहीं तो बिस्कुट नरम पड़ जाते हैं।',
  }),
  oil: P('oil', {
    goes: ['A tin of groundnut oil', 'A steel oil can with a spout'],
    goesTe: ['వేరుశనగ నూనె డబ్బా', 'చిమ్ము ఉన్న స్టీలు నూనె డబ్బా'],
    goesHi: ['मूँगफली के तेल का डिब्बा', 'टोंटी वाला स्टील का तेल कैन'],
    steps: ['Open the tin of cooking oil', 'Pour it into the oil can', 'Wipe the can and keep it beside the stoves'],
    te: ['నూనె డబ్బా తెరవండి', 'నూనె డబ్బాలో పోయండి', 'డబ్బా తుడిచి పొయ్యిల పక్కన ఉంచండి'],
    hi: ['तेल का डिब्बा खोलें', 'तेल कैन में उँडेलें', 'कैन पोंछकर चूल्हों के पास रखें'],
    tip: 'The dearest thing per portion: waste it and the profit goes. Never top up beside a hot pan.',
    tipTe: 'ఒక్కో భాగానికి అన్నింటికంటే ఖరీదైనది: వృథా చేస్తే లాభం పోతుంది. వేడి పెనం పక్కన నూనె పోయకండి.',
    tipHi: 'हर हिस्से में सबसे महँगी चीज़ है: बर्बाद की तो मुनाफ़ा गया। गरम तवे के पास तेल न डालें।',
  }),
});

/** The prep recipe of an ingredient, or null. */
export const prepRecipeFor = (item) => (Object.hasOwn(PREP_RECIPES, item) ? PREP_RECIPES[item] : null);

const pick = (r, lang, en, te, hi) => (lang === 'te' ? r[te] : lang === 'hi' ? r[hi] : r[en]);

/** The steps of a prep recipe in a language ('en' | 'te' | 'hi'; anything else is English). */
export function prepRecipeSteps(item, lang = 'en') {
  const r = prepRecipeFor(item);
  return r ? pick(r, lang, 'steps', 'te', 'hi').slice() : [];
}

/** What goes INTO a prepared ingredient, in a language. */
export function prepRecipeGoes(item, lang = 'en') {
  const r = prepRecipeFor(item);
  return r ? pick(r, lang, 'goes', 'goesTe', 'goesHi').slice() : [];
}

/** The one-line tip of a prep recipe in a language. */
export function prepRecipeTip(item, lang = 'en') {
  const r = prepRecipeFor(item);
  return r ? pick(r, lang, 'tip', 'tipTe', 'tipHi') || r.tip : '';
}
