// Tiffin Centre dialogue: the name of every dish in each voice. { text (script), rom (Roman letters), en (English) }.
// Telugu text comes straight from the catalogue (DISHES[id].te) so the two can never drift apart.
// Drafted for review by a native speaker before release.
import { DISHES, DISH_IDS } from '../catalog.js';

const ROM_TE = {
  idly: 'idly', dosa: 'dosa', masala_dosa: 'masala dosa', podi_dosa: 'neyyi podi dosa', set_dosa: 'set dosa', pesarattu: 'pesarattu',
  poori: 'poori', vada: 'medu vada', mysore_bonda: 'mysore bonda', mirchi_bajji: 'mirchi bajji', irani_chai: 'irani chai',
  filter_coffee: 'filter coffee', osmania: 'osmania biscuit',
};

const EN = {
  idly: 'idly', dosa: 'dosa', masala_dosa: 'masala dosa', podi_dosa: 'ghee podi dosa', set_dosa: 'set dosa', pesarattu: 'pesarattu',
  poori: 'poori aloo', vada: 'medu vada', mysore_bonda: 'mysore bonda', mirchi_bajji: 'mirchi bajji', irani_chai: 'Irani chai',
  filter_coffee: 'filter coffee', osmania: 'Osmania biscuit',
};

// Hindi (Devanagari), as a Hindi speaker says it at a tiffin stall.
const HI = {
  idly: ['इडली', 'idli'], dosa: ['डोसा', 'dosa'], masala_dosa: ['मसाला डोसा', 'masala dosa'], podi_dosa: ['घी पोडी डोसा', 'ghee podi dosa'],
  set_dosa: ['सेट डोसा', 'set dosa'], pesarattu: ['पेसरट्टू', 'pesarattu'], poori: ['पूरी आलू', 'poori aloo'], vada: ['मेदू वड़ा', 'medu vada'],
  mysore_bonda: ['मैसूर बोंडा', 'mysore bonda'], mirchi_bajji: ['मिर्ची बज्जी', 'mirchi bajji'], irani_chai: ['ईरानी चाय', 'irani chai'],
  filter_coffee: ['फ़िल्टर कॉफ़ी', 'filter coffee'], osmania: ['उस्मानिया बिस्किट', 'osmania biscuit'],
};

// Hyderabadi Dakhni, written in Devanagari (the Roman spelling is in `rom`).
const DK = {
  idly: ['इडली', 'idli'], dosa: ['दोसा', 'dosa'], masala_dosa: ['मसाला दोसा', 'masala dosa'], podi_dosa: ['घी पोडी दोसा', 'ghee podi dosa'],
  set_dosa: ['सेट दोसा', 'set dosa'], pesarattu: ['पेसरट्टू', 'pesarattu'], poori: ['पूरी आलू', 'poori aloo'], vada: ['मेदू वड़ा', 'medu vada'],
  mysore_bonda: ['मैसूर बोंडा', 'mysore bonda'], mirchi_bajji: ['मिरची बज्जी', 'mirchi bajji'], irani_chai: ['इरानी चाय', 'irani chai'],
  filter_coffee: ['फिल्टर कॉफी', 'filter coffee'], osmania: ['उस्मानिया बिस्कुट', 'osmania biscuit'],
};

const pack = (table) => {
  const out = {};
  for (const id of DISH_IDS) out[id] = Object.freeze({ text: table[id][0], rom: table[id][1], en: EN[id] });
  return Object.freeze(out);
};

const te = {};
for (const id of DISH_IDS) te[id] = Object.freeze({ text: DISHES[id].te, rom: ROM_TE[id], en: EN[id] });

export const DISH_NAMES = Object.freeze({ te: Object.freeze(te), hi: pack(HI), dk: pack(DK) });

/** The name of a dish in a language ('te' | 'hi' | 'dk'); an unknown dish or language falls back to the catalogue name. */
export function dishName(lang, id) {
  const table = DISH_NAMES[lang] || DISH_NAMES.te;
  if (Object.prototype.hasOwnProperty.call(table, id)) return table[id];
  const d = Object.prototype.hasOwnProperty.call(DISHES, id) ? DISHES[id] : null;
  const name = d ? d.name : String(id);
  return { text: name, rom: name, en: name };
}
