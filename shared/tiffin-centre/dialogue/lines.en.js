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
});
