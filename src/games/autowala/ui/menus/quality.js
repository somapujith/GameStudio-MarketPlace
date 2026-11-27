// What the QUALITY setting says to the player, kept pure so it can be tested. The renderer builds its tier once at start-up and a
// frame-time sampler may lower it later; changing the setting applies live only when the renderer offers `setQuality` (see settings.js),
// otherwise the choice is saved and used after a reload. This text must never promise more than that.
export const TIER_NAME = { low: 'Low', medium: 'Medium', high: 'High' };

/** 'low' | 'medium' | 'high' -> 'Low' ...; anything else -> '' (the renderer's tier is unknown). */
export const tierName = (t) => TIER_NAME[t] || '';

/**
 * setting  the saved choice: null (Auto) | 'low' | 'medium' | 'high'
 * running  the tier the renderer is on right now
 * live     the renderer can switch tier without a reload
 * booted   the choice the game was STARTED with (a reload is needed when the setting has moved away from it)
 * -> { running, headline, lines: string[], reload: boolean }
 */
export function describeQuality({ setting = null, running = null, live = false, booted = setting } = {}) {
  const now = tierName(running);
  const reload = !live && (setting ?? null) !== (booted ?? null);
  const lines = [];
  if (setting === null || setting === undefined) {
    lines.push(`Auto picks the picture quality for this device${now ? ` (${now} right now)` : ''} and lowers it by itself if the frame rate drops.`);
  } else {
    lines.push(`${tierName(setting)} is your choice: the game starts there and may still step down if the frame rate stays low.${now && now !== tierName(setting) ? ` Running at ${now} for now.` : ''}`);
  }
  lines.push(reload ? 'This applies after you reload the page.' : live ? 'Changes apply straight away.' : 'It is saved on this device and used the next time the game loads.');
  // the one-liner for the cramped start screen
  const note = reload
    ? 'Applies after you reload the page.'
    : setting
      ? `${tierName(setting)}: the game may still step down if the frame rate stays low.`
      : now
        ? `Auto picked ${now} for this device and lowers it if the frame rate drops.`
        : 'Auto picks for this device and lowers it if the frame rate drops.';
  return { running: now, headline: setting ? tierName(setting) : 'Auto', lines, note, reload };
}
