// The words on the "turn your phone" screen: English and Telugu, both always shown (the hub has no language setting and these games are bilingual).
// Pure data + one function, so the copy is tested and reviewed without rendering anything.

const COPY = {
  landscape: {
    en: {
      title: 'Turn your phone sideways',
      body: (name) => `${name || 'This game'} plays best in landscape, so the controls sit under your thumbs.`,
      hint: 'Screen rotation locked? Switch it off in your quick settings.',
      play: 'Tap to play in landscape',
    },
    te: {
      title: 'ఫోన్‌ను అడ్డంగా తిప్పండి',
      body: () => 'కంట్రోల్స్ మీ బొటనవేళ్ల కింద ఉండేలా ఈ గేమ్‌ను అడ్డంగా (ల్యాండ్‌స్కేప్‌లో) ఆడండి.',
      hint: 'స్క్రీన్ రొటేషన్ లాక్ ఉందా? క్విక్ సెట్టింగ్స్‌లో దాన్ని ఆఫ్ చేయండి.',
      play: 'ల్యాండ్‌స్కేప్‌లో ఆడటానికి నొక్కండి',
    },
  },
  portrait: {
    en: {
      title: 'Hold your phone upright',
      body: (name) => `${name || 'This game'} plays best held upright.`,
      hint: 'Screen rotation locked? Switch it off in your quick settings.',
      play: 'Tap to play upright',
    },
    te: {
      title: 'ఫోన్‌ను నిలువుగా పట్టుకోండి',
      body: () => 'ఈ గేమ్‌ను ఫోన్‌ను నిలువుగా పట్టుకుని ఆడండి.',
      hint: 'స్క్రీన్ రొటేషన్ లాక్ ఉందా? క్విక్ సెట్టింగ్స్‌లో దాన్ని ఆఫ్ చేయండి.',
      play: 'నిలువుగా ఆడటానికి నొక్కండి',
    },
  },
};

const BACK = { en: 'Back to the game page', te: 'గేమ్ పేజీకి తిరిగి వెళ్ళండి' };

/** The strings for a policy ('landscape' | 'portrait'; anything else gets the landscape copy) and an optional game name. */
export function gateCopy(policy, gameName) {
  const c = COPY[policy] || COPY.landscape;
  return {
    en: { title: c.en.title, body: c.en.body(gameName), hint: c.en.hint, play: c.en.play, back: BACK.en },
    te: { title: c.te.title, body: c.te.body(gameName), hint: c.te.hint, play: c.te.play, back: BACK.te },
  };
}
