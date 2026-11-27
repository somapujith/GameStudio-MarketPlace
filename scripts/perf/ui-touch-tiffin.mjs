// Tiffin Centre half of scripts/perf/ui-touch.mjs: starts the tutorial (coach bar) or a practice level, forces a busy HUD, measures every HUD box.
// Exported: runTiffin(c, [w, h], { base, DPR, worst, level, shots, name }) -> { vw, vh, boxes, overlaps, clipped, ... }
import path from 'node:path';

/** In-page: visible HUD / coach / menu boxes by group, the pairs that overlap and the elements whose text is cut off. */
const MEASURE_TF = `(() => {
  const SEL = {
    banner: '.tc-hud-top .tc-hud-banner, .tc-hud-banner', takings: '.tc-hud-takings, .tc-hud-books', vitals: '.tc-hud-vitals', btns: '.tc-hud-btns .tc-hud-btn',
    rail: '.tc-hud-railbox', board: '.tc-hud-board', hands: '.tc-hud-hands', quick: '.tc-hud-quick, .tc-hud-quickbar', dock: '.tc-hud-dockwrap', pending: '.tc-hud-pending',
    coach: '.tc-menu-coachbar', toast: '.tc-hud-toast', subs: '.tc-hud-subs', help: '.tc-hud-help', sheet: '.tc-hud-sheet, .tc-hud-prepsheet, .tc-hud-boardsheet',
    status: '.tc-hud-stall, .tc-hud-status', coop: '.tc-hud-coop', pause: '.tc-menu-pause .tc-menu-panel', brief: '.tc-menu-brief__card',
  };
  const root = document.querySelector('.tc') || document.body;
  const vw = innerWidth, vh = innerHeight;
  const boxes = [];
  const seen = new Set();
  for (const [g, sel] of Object.entries(SEL)) {
    let i = 0;
    for (const el of root.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05 || el.closest('[hidden]')) continue;
      seen.add(el);
      boxes.push({ id: g + (i++ ? '#' + i : ''), g, x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) });
    }
  }
  const overlaps = [];
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const p = boxes[a], q = boxes[b];
    // a box inside another one (the dock inside its wrapper, a chip inside the rail) is nesting, not an overlap
    const inside = (u, v) => u.x >= v.x - 1 && u.y >= v.y - 1 && u.r <= v.r + 1 && u.b <= v.b + 1;
    if (inside(p, q) || inside(q, p)) continue;
    const w = Math.min(p.r, q.r) - Math.max(p.x, q.x), h = Math.min(p.b, q.b) - Math.max(p.y, q.y);
    if (w > 1 && h > 1) overlaps.push({ a: p.id, b: q.id, w, h });
  }
  const off = boxes.filter((b) => b.x < -1 || b.y < -1 || b.r > vw + 1 || b.b > vh + 1).map((b) => b.id);
  // text that does not fit: a box whose content is wider / taller than the box (overflow hidden or ellipsis) among the readable HUD text
  const clipped = [];
  for (const el of root.querySelectorAll('.tc-hud *, .tc-menu *')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
    const cutX = el.scrollWidth - el.clientWidth > 2 && cs.overflowX !== 'visible';
    const cutY = el.scrollHeight - el.clientHeight > 2 && cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll';
    if (cutX || cutY) clipped.push((el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ')[0] : el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + (cutX ? 'w' + el.scrollWidth + '>' + el.clientWidth : 'h' + el.scrollHeight + '>' + el.clientHeight));
  }
  const hostStyle = (root.getAttribute('style') || '').slice(0, 200);
  return { vw, vh, boxes, overlaps, off, clipped: clipped.slice(0, 20), host: hostStyle };
})()`;

const BOT = `(() => {
  if (window.__botTimer) return true;
  window.__botTimer = setInterval(() => { try { const t = window.__tiffin; const m = t.bot; const s = t.session; if (!m || !s || !s.state || s.status !== 'playing') return; const a = m(s.state, s.meId); if (a) s.dispatch(a); } catch (e) { window.__botErr = String(e); } }, 250);
  return true;
})()`;

export async function runTiffin(c, [w, h], { base, DPR, worst, level, shots, name }) {
  await c.viewport(w, h, DPR, true);
  const tag = `${level > 0 ? `level${level}` : 'tutorial'}${worst ? '-worst' : ''}`;
  if (level > 0) {
    // the tutorial is done, and every level up to 12 is open
    const best = {};
    for (let i = 1; i <= 11; i++) best[i] = { stars: 3, earned: 500 };
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jalebi.tutorial.v1.tiffin-centre', '1'); localStorage.setItem('jalebi.progress.v1.tiffin-centre', ${JSON.stringify(JSON.stringify({ best }))}); } catch {}` });
  }
  await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
  await c.waitFor(level > 0 ? "!!document.querySelector('.tc-menu-lvl__btn')" : "[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 120000);
  await c.ev("[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === 'low')?.click(); true"); // the lightest tier: layout and screenshots only
  await c.sleep(300);
  let brief = null;
  if (level > 0) {
    await c.ev(`[...document.querySelectorAll('.tc-menu-lvl__btn')][${level - 1}]?.click(); true`);
    await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Open the stall/.test(b.textContent))", 30000);
    await c.sleep(600);
    brief = await c.ev(MEASURE_TF);
    if (shots) await c.shot(path.join(shots, `${name}-tiffin-${w}x${h}-briefing.jpg`));
    await c.ev("[...document.querySelectorAll('button')].find((b) => /Open the stall/.test(b.textContent)).click(); true");
  } else await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
  await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug && document.querySelector(".tc-hud-top"))', 240000);
  await c.ev('(() => { const g = window.__tiffin.scene.debug.gfx; try { g.holdAdaptation(1e9); } catch {} return true; })()');
  await c.sleep(4000);
  if (worst && level > 0) {
    await c.ev(BOT); // the bot plays: orders pile up, toasts fire, hands fill
    await c.sleep(30000);
  }
  if (worst && level === 0) {
    // open the coach card (the bar's chevron) and, if the step waits for "Got it", leave it there: the widest the coach gets
    await c.ev("document.querySelector('.tc-menu-coachbar__line[aria-expanded=\"false\"]')?.click(); true");
    await c.sleep(600);
  }
  const out = await c.ev(MEASURE_TF);
  out.briefing = brief;
  if (shots) await c.shot(path.join(shots, `${name}-tiffin-${w}x${h}-${tag}.jpg`));
  // the pause card
  await c.ev("window.__tiffin.session.pause?.(); true");
  await c.sleep(700);
  out.pause = await c.ev(MEASURE_TF);
  if (shots) await c.shot(path.join(shots, `${name}-tiffin-${w}x${h}-${tag}-pause.jpg`));
  return out;
}
