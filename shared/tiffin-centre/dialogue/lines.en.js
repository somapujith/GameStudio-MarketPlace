// Tiffin Centre dialogue: ENGLISH UI strings only. The English meaning of every spoken line lives inside the line itself
// (`en`), so this file holds just the words around the dialogue (subtitle settings, language names, speech toggle).
// Drafted for review by a native speaker before release.

export const SUBTITLE_MODES = ['native', 'roman', 'english', 'both'];

export const UI_EN = Object.freeze({
  subtitles: 'Subtitles',
  subtitleModes: Object.freeze({
    native: 'Native script',
    roman: 'Roman letters',
    english: 'English',
    both: 'Native + English',
  }),
  subtitleHint: Object.freeze({
    native: 'Shows the line as it is spoken, in Telugu or Hindi script.',
    roman: 'Shows how the line sounds, in English letters.',
    english: 'Shows what the line means in English.',
    both: 'Shows the spoken line and its English meaning.',
  }),
  language: 'Customers speak',
  languageModes: Object.freeze({
    auto: 'A mix, like a real street',
    te: 'Telugu',
    hi: 'Hindi',
    dk: 'Hyderabadi Dakhni',
    mixed: 'Switching mid-sentence',
  }),
  langNames: Object.freeze({
    te: Object.freeze({ native: 'తెలుగు', en: 'Telugu' }),
    hi: Object.freeze({ native: 'हिन्दी', en: 'Hindi' }),
    dk: Object.freeze({ native: 'हैदराबादी दक्खनी', en: 'Hyderabadi Dakhni' }),
  }),
  speech: 'Spoken voices',
  speechHint: 'Uses your device\'s built-in voices. Nothing is sent over the network.',
  speechUnavailable: 'No voice for this language on this device, subtitles only.',
  reviewNote: 'Lines are drafts waiting for a native-speaker check.',
  // the operations layer: what the HUD shows beside a customer (badges) and as a one-line ticker when something happens (captions)
  badges: Object.freeze({
    regular: 'Regular',
    loyal: 'Loyal regular',
    delivery: 'Delivery boy',
    office: 'Office order',
    parcel: 'Parcel',
    extraChutney: 'Extra chutney',
    extraSambar: 'Extra sambar',
    spiceLess: 'Less spicy',
    spiceMore: 'Extra spicy',
    broken: 'Torn dish, half price',
  }),
  captions: Object.freeze({
    rain: 'It is raining: people are ducking in for chai and bajji.',
    cricket: 'Match night: the crowd comes in groups and cheers.',
    power: 'Power cut: lights, fan and steamer are down.',
    festival: 'Festival rush: more people, more tips.',
    inspector: 'The GHMC inspector is on his way.',
    delivery: 'The delivery boy is here for parcels.',
    inspectorPass: 'The inspector is happy with the stall.',
    inspectorFail: 'The inspector found a problem: a fine.',
    soldOut: 'Sold out: customers choose something else or leave politely.',
    gasOut: 'The cylinder is empty: change it.',
  }),
  languageNotes: Object.freeze({
    te: 'Telangana and Hyderabad street Telugu.',
    hi: 'Everyday spoken Hindi.',
    dk: 'Hyderabadi Dakhni (Hindi-Urdu of the Deccan), written in Devanagari.',
  }),
});
