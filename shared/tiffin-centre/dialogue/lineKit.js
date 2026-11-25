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
  // ---- the operations layer (docs/TIFFIN_CENTRE_PLAN.md section 3b): weather, events, requests, regulars, complaints ----
  'rain-start': 8, // people duck in out of the rain for chai and bajji
  'rain-ongoing': 8,
  'rain-end': 4,
  'power-cut': 8, // lights out, 'current poyindi', phone torches (said when the cut starts and now and then while it lasts)
  'power-back': 4,
  'cricket-night': 10, // India match chatter, groups, cheering
  'festival-greeting': 8, // Sankranti, Ugadi, Dasara, Eid, Diwali and plain 'happy festival', nobody excluded
  'inspector-arrival': 6, // whispers: the GHMC food-safety people have come
  'inspector-pass': 4,
  'inspector-fail': 4,
  'sold-out-polite': 14, // told 'ayipoyindi' / 'khatam ho gaya': tags swap (takes another dish), leave (goes home politely), drop (skips that dish)
  'stock-out-apology': 4, // the stall ran out of something: customers console the cook
  'delivery-boy-hurry': 8, // the tiffin delivery boy: parcels, 'order late ayithe rating pothundi'
  'parcel-request': 8,
  'extra-request-chutney': 8,
  'extra-request-sambar': 8,
  'spice-request-less': 8,
  'spice-request-more': 8,
  'regular-named': 10, // a regular recognised by the cook; tags low (loyalty 0-1) and high (loyalty 2+)
  'regular-loyal': 6, // a loyal regular tips and blesses on the way out
  'big-office-order': 8, // a huge parcel order, the boss is waiting
  'broken-dish-complaint': 8, // torn or stuck dosa, half price
  'sour-batter-complaint': 6, // 'dosa pulla ga undi'
  'gas-out-chatter': 6, // waiting while the cylinder is swapped
  'thanks-fast-service': 4,
};

/** Tags a situation uses (a tag narrows the pool, the director chooses it): 'late' on serve-complain, and these. */
export const SIT_TAGS = {
  'serve-complain': ['late'],
  'sold-out-polite': ['swap', 'leave', 'drop'],
  'regular-named': ['low', 'high'],
};
/** Minimum lines of each tag, in each language. */
export const MIN_PER_TAG = {
  'sold-out-polite': { swap: 5, leave: 4, drop: 3 },
  'regular-named': { low: 4, high: 4 },
};
/** Situations whose lines may use {dish}: the director has a dish to name there. ({dish2}: order-multi and sold-out-polite 'swap'.) */
export const NO_DISH_SITS = [
  'angry-leave', 'unpaid-leave', 'pay-hurry', 'pay-change-keep', 'pay-haggle', 'apology', 'turned-away', 'combo-praise', 'morning', 'noon', 'evening', 'night', 'festival', 'greet',
  'rain-start', 'rain-ongoing', 'rain-end', 'power-cut', 'power-back', 'cricket-night', 'festival-greeting', 'inspector-arrival', 'inspector-pass', 'inspector-fail',
  'stock-out-apology', 'extra-request-chutney', 'extra-request-sambar', 'regular-loyal', 'gas-out-chatter',
];
/** Situations where {n} is filled: the count of dishes ordered (order), the bill (pay-ready), the parcels of the order (big-office-order, delivery-boy-hurry). */
export const N_SITS = ['order', 'pay-ready', 'big-office-order', 'delivery-boy-hurry'];

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
