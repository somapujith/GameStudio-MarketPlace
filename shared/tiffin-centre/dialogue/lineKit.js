// Tiffin Centre dialogue: the shared vocabulary of the line files (situations, moods, the line builder, the minimum
// line counts per situation and language that the tests enforce). Pure data and one tiny pure function.

export const LANGS = ['te', 'hi', 'dk'];

/** Expressions the 3D faces understand (docs/TIFFIN_CENTRE_PLAN.md section 2c). */
export const MOODS = [
  'neutral', 'bored', 'impatient', 'angry', 'happy', 'delighted', 'eating', 'paying', 'sheepish', 'surprised', 'laughing', 'sad',
];

/** Minimum number of lines per situation, in EACH language. More is better; the tests fail below these. */
export const MIN_PER_SIT = {
  greet: 14,
  order: 18,
  'order-multi': 8,
  extra: 8, // extra chutney / sambar / ghee
  'waiting-polite': 14,
  'waiting-hurry': 14,
  'waiting-angry': 14,
  'serve-thanks': 14,
  'serve-praise': 14,
  'serve-complain': 14, // tag 'late' = too slow, no tag = the dish itself (cold, burnt, small, spicy, no salt)
  'eating-compliment': 12,
  'eating-chat': 16, // small talk: cricket, traffic, rain, prices, office, exams, cinema, weather
  'pay-ready': 14,
  'pay-hurry': 8, // money is out and the cook is slow to take it
  'pay-change-keep': 10,
  'pay-haggle': 8,
  'unpaid-leave': 8,
  'angry-leave': 10,
  'turned-away': 6,
  'regular-greet': 10,
  'elder-blessing': 10,
  'kid-demand': 10,
  'phone-call': 10,
  'student-broke': 8,
  'autowala-chat': 8,
  festival: 8,
  morning: 6,
  noon: 6,
  evening: 6,
  night: 6,
  'combo-praise': 6,
  apology: 6,
};

export const SITUATIONS = Object.keys(MIN_PER_SIT);

/** Placeholders a line may contain. {dish} / {dish2}: dish names in the line's own language. {n}: a count (order) or the bill in rupees (pay). */
export const PLACEHOLDER_RE = /\{([a-z0-9]+)\}/g;
export const ALLOWED_PLACEHOLDERS = ['dish', 'dish2', 'n'];

/**
 * Turn a compact data table into line objects.
 * data = { [sit]: [ [mood, text, rom, en, ...extras], ... ] } where extras are an array of customer kind ids (kinds)
 * and/or a string (the `tag`, e.g. 'late' for serve-complain). Ids are `${lang}-${sit}-${NN}` by position: APPEND new
 * lines at the end of a situation so existing ids stay stable.
 */
export function buildLines(lang, data) {
  const out = [];
  for (const sit of Object.keys(data)) {
    data[sit].forEach((row, i) => {
      const [mood, text, rom, en, ...extras] = row;
      const line = { id: `${lang}-${sit}-${String(i + 1).padStart(2, '0')}`, lang, sit, mood, text, rom, en };
      for (const x of extras) {
        if (Array.isArray(x)) line.kinds = x.slice();
        else if (typeof x === 'string') line.tag = x;
      }
      if (text.includes('{dish}')) line.dish = true;
      if (text.includes('{dish2}')) line.dish2 = true;
      if (text.includes('{n}')) line.n = true;
      out.push(Object.freeze(line));
    });
  }
  return Object.freeze(out);
}
