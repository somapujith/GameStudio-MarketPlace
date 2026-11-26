// Pure layout logic for the Autowala HUD on phones and tablets (no React, no DOM; unit-tested in layoutLogic.test.js).
// It decides WHICH layout the HUD uses (from the shared viewport class of src/lib/mobile.js), which secondary panels fold into the
// "More" sheet, how many toasts may stack, which live rule alerts get a chip, and the data-attributes written on the `.aw` root so the
// stylesheets (hud/phone.css, minimap.css, subtitles.css, hud/toasts.css) can key their rules on one source of truth.
//
// CONTROL-ZONE CONTRACT (the on-screen driving controls publish these on the `.aw` root, px, 0 when hidden):
//   --aw-ctl-left-w   width of the steering wheel area, left   --aw-ctl-right-w  width of the pedal area, right
//   --aw-ctl-h        height of both areas from the bottom edge
// The HUD reads them with the fallbacks below (CONTROL_FALLBACK) and keeps every panel out of those regions.

export const COLLAPSIBLE = ['rating', 'job', 'quest', 'weather', 'radio', 'rules'];

/** Fallback sizes of the control areas when the controls do not publish their own (only used on touch layouts). */
export const CONTROL_FALLBACK = {
  land: { left: '30vw', right: '32vw', h: '38dvh' },
  port: { left: '30vw', right: '32vw', h: '30dvh' },
  none: { left: '0px', right: '0px', h: '0px' },
};

export const DESKTOP_TOASTS = 4;

/**
 * viewport (viewportInfo / useViewport shape: { w, h, class, landscape, coarse }) + "is the player on a touch screen" -> the HUD layout.
 * kind: 'desktop' | 'phone-land' | 'phone-port' | 'tablet-land' | 'tablet-port'.
 * Anything that is not 'desktop' is `compact`: the one-strip HUD with the More sheet.
 */
export function hudLayout(vp, touch = false) {
  const v = vp || {};
  const w = Number(v.w) || 0;
  const h = Number(v.h) || 0;
  const cls = v.class === 'phone' || v.class === 'tablet' ? v.class : 'desktop';
  const land = v.landscape != null ? !!v.landscape : w > h;
  const compact = cls !== 'desktop';
  const kind = compact ? `${cls}-${land ? 'land' : 'port'}` : 'desktop';
  return {
    kind,
    compact,
    phone: cls === 'phone',
    tablet: cls === 'tablet',
    land,
    port: !land,
    touch: !!touch || !!v.coarse,
    w,
    h,
  };
}

/** Which panels are folded into the More sheet on this layout (all of them on phones and tablets, none on desktop). */
export function collapsedPanels(layout) {
  return layout && layout.compact ? COLLAPSIBLE.slice() : [];
}
export const isCollapsed = (layout, panel) => collapsedPanels(layout).includes(panel);

/** The control-area fallbacks for a layout: touch layouts reserve the wheel / pedal regions, everything else reserves nothing. */
export function controlFallback(layout) {
  if (!layout || !layout.compact || !layout.touch) return CONTROL_FALLBACK.none;
  return layout.land ? CONTROL_FALLBACK.land : CONTROL_FALLBACK.port;
}

/** Toast stack depth: 4 on desktop (unchanged), 3 on phones and tablets, 1 on a short portrait phone (under 700 px tall) where there is no room for a stack. */
export function toastCap(layout) {
  if (!layout || !layout.compact) return DESKTOP_TOASTS;
  if (layout.port && layout.h > 0 && layout.h < 700) return 1;
  return 3;
}

/** How many live alert chips fit on the road: 2 in landscape (a column over the wheel area), 2 in portrait, 1 on a short portrait phone. */
export function alertCap(layout) {
  if (!layout || !layout.compact) return 0;
  if (layout.land) return 2;
  return layout.h > 0 && layout.h < 700 ? 1 : 2;
}

/** Does the player have a Radio, a quest, etc. worth a section in the More sheet? Returns the section keys in display order. */
export function sheetSections({ rating = true, career = false, quest = false, weather = false, rules = false, radio = false } = {}) {
  const out = [];
  if (rating) out.push('rating');
  if (career) out.push('job');
  if (quest) out.push('quest');
  if (weather) out.push('weather');
  if (rules) out.push('rules');
  if (radio) out.push('radio');
  return out;
}

/** The dot on the More button: 'urgent' (red) when something in the sheet needs the player, 'info' (cyan) for a running mission, else null. */
export function moreBadge({ career = null, quest = null, rules = null } = {}) {
  if (career) {
    if (career.chai && career.chai.urgent) return 'urgent';
    if (career.damage && career.damage.show && career.damage.tone === 'bad') return 'urgent';
    if (career.rent && career.rent.due > 0 && career.rent.debt > 0) return 'urgent';
  }
  if (quest && quest.active) {
    const left = quest.active.timeLeft == null ? NaN : Number(quest.active.timeLeft);
    if (Number.isFinite(left) && left <= 20) return 'urgent';
    return 'info';
  }
  if (rules && rules.fines > 0) return 'info';
  return null;
}

/**
 * The live rule alerts that get a chip on the road (the rest is in the More sheet), most urgent first, at most `max`.
 * `view` is hudLogic.rulesView(...); `rage` is hudLogic.rageView(...); `mission` is a short label of the running mission or ''.
 * Returns [{ kind: 'checkpoint'|'wanted'|'camera'|'signal'|'rage'|'mission', urgent }].
 */
export function alertList(view, rage = null, mission = '', max = 3) {
  const out = [];
  if (view) {
    if (view.checkpoint) out.push({ kind: 'checkpoint', urgent: view.checkpoint.phase !== 'near' });
    else if (view.wanted) out.push({ kind: 'wanted', urgent: true });
    if (view.camera && view.camera.over) out.push({ kind: 'camera', urgent: true });
    if (view.signal && view.signal.state !== 'green') out.push({ kind: 'signal', urgent: view.signal.state === 'red' && view.signal.dist < 60 });
    if (view.camera && !view.camera.over) out.push({ kind: 'camera', urgent: false });
    if (view.signal && view.signal.state === 'green') out.push({ kind: 'signal', urgent: false });
  }
  if (rage) out.push({ kind: 'rage', urgent: !!rage.danger });
  if (mission) out.push({ kind: 'mission', urgent: false });
  // urgent ones first, keep the order inside each group
  const sorted = [...out.filter((a) => a.urgent), ...out.filter((a) => !a.urgent)];
  return sorted.slice(0, Math.max(0, max));
}

/** A rulesView with only the alert kinds in `kinds` kept (so the lane shows exactly what alertList chose); null when nothing is left. */
export function filterRules(view, kinds) {
  if (!view || !Array.isArray(kinds)) return null;
  const out = {
    sign: null,
    signal: kinds.includes('signal') ? view.signal : null,
    camera: kinds.includes('camera') ? view.camera : null,
    checkpoint: kinds.includes('checkpoint') ? view.checkpoint : null,
    wanted: kinds.includes('wanted') ? !!view.wanted : false,
    heat: view.heat,
    fines: view.fines,
  };
  return out.signal || out.camera || out.checkpoint || out.wanted ? out : null;
}

/** 'trip' | 'find' | '' for the strip: what the trip slot is showing (the portrait stack below the strip is taller for a trip). */
export const tripSlot = (hasTrip, showHint = true) => (hasTrip ? 'trip' : showHint ? 'find' : '');

/**
 * The data-attributes written on the `.aw` root. Stylesheets key on them:
 *   data-aw-layout   desktop | phone-land | phone-port | tablet-land | tablet-port
 *   data-aw-compact  '1' on every non-desktop layout       data-aw-touch  '1' | '0'
 *   data-aw-trip     'trip' | 'find' | ''                   data-aw-alerts  number of alert chips (0..n)
 *   data-aw-fare     '1' while a fare question is open      data-aw-sheet   '1' while the More sheet is open
 */
export function rootAttrs(layout, { trip = '', alerts = 0, fare = false, sheet = false } = {}) {
  const l = layout || hudLayout(null);
  return {
    'data-aw-layout': l.kind,
    'data-aw-compact': l.compact ? '1' : '0',
    'data-aw-touch': l.touch ? '1' : '0',
    'data-aw-trip': trip || '',
    'data-aw-alerts': String(Math.max(0, Math.round(alerts))),
    'data-aw-fare': fare ? '1' : '0',
    'data-aw-sheet': sheet ? '1' : '0',
  };
}

/** Simple axis-aligned rectangle helpers, used by the layout geometry tests and the measurement scripts. */
export const rectOverlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
