// People of Tiffin Centre: re-export these from models/index.js (the models index is owned by someone else):
//
//   export * from './characters-index.js';
//
// (it replaces the old `export { buildCustomer, MOODS } from './customers.js'` and `export { buildAvatar, POSES } from './avatar.js'` lines)
export { buildCustomer, MOODS, CUSTOMER_KIND_IDS } from './customers.js';
export { buildAvatar, POSES } from './avatar.js';
export { buildViewmodel, VIEW_ACTIONS, ACTION_MS } from './viewmodel.js';
export { buildPerson } from './person.js';
export { buildHead } from './face.js';
export { makeFaceParams } from './facegen.js';
export { buildHair, HAIR_STYLES, HEADWEAR } from './hair.js';
export { AU_NAMES, EXPRESSION_NAMES, EXPRESSIONS, ExpressionState, expressionForMood } from './expressions.js';
export { SKIN_TONES } from './skin.js';
export { setCharacterQuality, getCharacterQuality } from './charquality.js';
