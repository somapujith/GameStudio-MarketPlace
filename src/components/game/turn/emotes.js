// Quick reactions. The ids are the server's whitelist (worker/validate.js EMOTES, adapter `emotes`):
// emote_mass emote_cheer emote_shock emote_laugh emote_thanks emote_hurry emote_taunt.
// QUICK_EMOTES = the six buttons; EMOTE_INFO also knows emote_taunt so it renders when someone else sends it.
export const EMOTE_INFO = {
  emote_mass: { emoji: '🔥', label: 'Mass!' },
  emote_cheer: { emoji: '👏', label: 'Shabash!' },
  emote_laugh: { emoji: '😂', label: 'Haha' },
  emote_shock: { emoji: '😱', label: 'Arre!' },
  emote_thanks: { emoji: '🙏', label: 'Shukriya' },
  emote_hurry: { emoji: '⏰', label: 'Jaldi karo!' },
  emote_taunt: { emoji: '😏', label: 'Baigan!' },
};

export const QUICK_EMOTES = ['emote_mass', 'emote_cheer', 'emote_laugh', 'emote_shock', 'emote_thanks', 'emote_hurry']
  .map((id) => ({ id, ...EMOTE_INFO[id] }));

export const emoteInfo = (id) => EMOTE_INFO[id] || null;
