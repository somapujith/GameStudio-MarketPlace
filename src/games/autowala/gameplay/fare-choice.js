// The one small multiple-choice question the fares system may have open at a time (price talk at pickup, a counter-offer, small talk).
// It never pauses or blocks the auto: a question that is not answered in time takes its default (or just goes away).
//   keyboard 1 / 2 / 3, gamepad D-pad left / up / right, touch buttons (ui/fares/FareChoice.jsx calls ctx.fares.choose(n)).
// Without the panel mounted, the hint falls back to the HUD's prompt chip ("1 Meter · 2 Fixed · 3 Bargain").
const PAD_BUTTONS = [14, 12, 15]; // D-pad left, up, right  ->  option 1, 2, 3 (A / B / X are gas, brake and horn)

export function createChoices(ctx) {
  let cur = null;
  let seq = 0;
  let promptShown = false;
  const padHeld = [false, false, false];

  const clearPrompt = () => {
    if (promptShown) ctx.setPrompt?.('farechoice', null);
    promptShown = false;
  };

  const close = () => {
    const c = cur;
    cur = null;
    clearPrompt();
    return c;
  };

  const api = {
    get current() {
      return cur;
    },
    /**
     * Open a question. spec = { id, kind, title:{en,te}, say?:{who,en,te}, note?, options:[{ id, label, te?, sub?, tone? }] (1..3),
     * seconds, defaultId?, quiet?, onPick(optId, index), onTimeout?() }. Replaces whatever was open (without calling its callbacks).
     */
    open(spec) {
      close();
      cur = { ...spec, key: ++seq, left: spec.seconds, total: spec.seconds };
      for (let i = 0; i < 3; i++) padHeld[i] = true; // a button held from before must not answer it
      return cur.key;
    },
    /** Answer with option n (1-based). Returns true when a question was open and n existed. */
    choose(n) {
      const c = cur;
      if (!c || ctx.state?.menu) return false;
      const o = c.options[n - 1];
      if (!o) return false;
      close();
      c.onPick?.(o.id, n - 1);
      return true;
    },
    /** Close the question (if it is the one named, or any when `id` is omitted) without calling anything. */
    cancel(id) {
      if (cur && (id == null || cur.id === id)) close();
    },
    update(dt) {
      if (!cur) return;
      // gamepad D-pad
      try {
        const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null;
        const p = pads && [...pads].find(Boolean);
        for (let i = 0; i < 3; i++) {
          const on = !!p?.buttons?.[PAD_BUTTONS[i]]?.pressed;
          if (on && !padHeld[i]) {
            padHeld[i] = true;
            if (api.choose(i + 1)) return;
          } else if (!on) padHeld[i] = false;
        }
      } catch {
        /* no gamepad API: the keyboard and the touch buttons still work */
      }
      if (!cur) return;
      cur.left -= dt;
      if (cur.left <= 0) {
        const c = close();
        if (c.defaultId != null) {
          const i = c.options.findIndex((o) => o.id === c.defaultId);
          if (i >= 0) {
            c.onPick?.(c.defaultId, i);
            return;
          }
        }
        c.onTimeout?.();
        return;
      }
      // the prompt chip stands in for the panel when the panel is not mounted
      if (!ctx.fares?.uiMounted && !cur.quiet) {
        if (!promptShown) {
          promptShown = true;
          ctx.setPrompt?.('farechoice', cur.options.map((o, i) => `${i + 1} ${o.label.en || o.label}`).join('  ·  '), '1-3');
        }
      } else clearPrompt();
    },
    /** A plain, serialisable view for the HUD snapshot (10 Hz). */
    snapshot() {
      const c = cur;
      if (!c) return null;
      return {
        key: c.key, id: c.id, kind: c.kind, quiet: !!c.quiet, title: c.title, say: c.say || null, note: c.note || null,
        options: c.options.map((o, i) => ({ n: i + 1, id: o.id, label: o.label, sub: o.sub || null, tone: o.tone || null })),
        timeLeft: Math.max(0, c.left), total: c.total,
      };
    },
    dispose() {
      close();
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
    },
  };

  const onKey = (e) => {
    if (!cur || e.repeat || ctx.state?.menu) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
    const n = e.key === '1' || e.key === '2' || e.key === '3' ? Number(e.key) : 0;
    if (n) api.choose(n);
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  return api;
}
