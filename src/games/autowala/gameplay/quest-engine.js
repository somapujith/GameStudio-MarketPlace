// OWNER: quests agent. The mission state machine. PURE (no three.js, no DOM, no ctx): a "plan" (see quest-defs.js) goes in,
// a "run" comes out; `tickRun` advances it with the player's sample, `feedRun` takes bus events, both return the events to
// publish ({ type: 'step' | 'complete' | 'fail' | 'incident' }). Also the saved progress (profile.data.quests.board) helpers.
//
//   plan = { id, defId, title, te, blurb, kind, diff 1..3, reward {cash, rep}, timeLimit|null, mult?,
//            rules { noCrash?, noHit?: ['cow','ped'...], meter?: { id, label, te, start, decay, crash, hit, land, failAtZero } },
//            steps: [ { type, label, te?, hint?, timeLimit?, ...params } ], props: { ... } }
//
// Guardrail contacts (`crash` with guard: true) are SOFT: they never count as an incident. Only real crashes (no guard) and
// traffic hits (`traffic:hit`) do.
import { eventStep, initStep, tickStep, targetsOf, hudOf } from './quest-steps.js';
import { rankFor } from './quest-math.js';

const NONE = Object.freeze([]);
const INCIDENT_GAP = 0.5; // s: one bump reported by two systems (crash + traffic:hit) counts once
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createRun(plan) {
  const run = {
    plan,
    status: plan.steps.length ? 'active' : 'done',
    stepIndex: 0,
    states: plan.steps.map(initStep),
    elapsed: 0,
    timeLeft: plan.timeLimit > 0 ? plan.timeLimit : null,
    stepTimeLeft: null,
    stepFracs: [],
    meter: plan.rules?.meter ? plan.rules.meter.start ?? 1 : null,
    stats: { incidents: 0, crashes: 0, hits: 0, lands: 0 },
    sinceIncident: 99,
    failReason: null,
    payout: null,
  };
  beginStep(run);
  return run;
}

function beginStep(run) {
  const def = run.plan.steps[run.stepIndex];
  run.stepTimeLeft = def?.timeLimit > 0 ? def.timeLimit : null;
}

export const currentStep = (run) => run.plan.steps[run.stepIndex] || null;
export const currentState = (run) => run.states[run.stepIndex] || null;

/** Seconds left on whatever clock is running (the step's own timer wins over the mission's), or null. */
export function clockLeft(run) {
  if (run.stepTimeLeft != null) return run.stepTimeLeft;
  return run.timeLeft;
}
/** The total seconds of the clock shown by clockLeft (for a bar). */
export function clockTotal(run) {
  const def = currentStep(run);
  if (run.stepTimeLeft != null && def?.timeLimit) return def.timeLimit;
  return run.plan.timeLimit || null;
}

function fail(run, reason, out) {
  if (run.status !== 'active') return;
  run.status = 'failed';
  run.failReason = reason;
  out.push({ type: 'fail', reason, id: run.plan.id });
}

function finishStep(run, out) {
  const def = currentStep(run);
  if (def?.timeLimit > 0 && run.stepTimeLeft != null) run.stepFracs.push(clamp(run.stepTimeLeft / def.timeLimit, 0, 1));
  out.push({ type: 'step', index: run.stepIndex, label: def?.label || '', id: run.plan.id });
  run.stepIndex++;
  if (run.stepIndex >= run.plan.steps.length) {
    run.status = 'done';
    run.payout = payout(run.plan, run);
    out.push({ type: 'complete', payout: run.payout, id: run.plan.id });
  } else {
    beginStep(run);
  }
}

const settle = (run, res, out) => {
  if (!res) return false;
  if (res === 'done') finishStep(run, out);
  else if (res.fail) fail(run, res.fail, out);
  return true;
};

/** Advance a run by dt seconds. `sample` = { x, z, speed, airborne, jolt, distance }; `env` = { trains }. Returns events (maybe empty). */
export function tickRun(run, dt, sample, env) {
  if (run.status !== 'active' || !(dt > 0)) return NONE;
  const out = [];
  run.elapsed += dt;
  run.sinceIncident += dt;
  if (run.timeLeft != null) run.timeLeft -= dt;
  if (run.stepTimeLeft != null) run.stepTimeLeft -= dt;
  const m = run.plan.rules?.meter;
  if (m && run.meter != null && run.stepIndex >= (m.fromStep || 0)) {
    run.meter = Math.max(0, run.meter - (m.decay || 0) * dt);
    if (m.jolt && sample.jolt > 0.6) run.meter = Math.max(0, run.meter - m.jolt * dt);
    if (m.failAtZero && run.meter <= 0) {
      fail(run, 'meter', out);
      return out;
    }
  }
  if (run.stepTimeLeft != null && run.stepTimeLeft <= 0) {
    fail(run, 'time', out);
    return out;
  }
  if (run.timeLeft != null && run.timeLeft <= 0) {
    fail(run, 'time', out);
    return out;
  }
  const def = currentStep(run);
  if (def) settle(run, tickStep(def, currentState(run), dt, sample, env), out);
  return out.length ? out : NONE;
}

/**
 * Feed a bus event ({ type, ...}). Real crashes and traffic hits are incidents; guardrail contacts (guard: true) are ignored.
 * Returns events to publish.
 */
export function feedRun(run, e) {
  if (run.status !== 'active' || !e) return NONE;
  const out = [];
  const rules = run.plan.rules || {};
  const m = rules.meter;
  let incident = null;
  if (e.type === 'crash' && !e.guard) incident = { kind: 'crash', strength: e.strength };
  else if (e.type === 'traffic:hit') incident = { kind: e.kind || 'hit', strength: e.severity };
  if (incident) {
    if (rules.noHit?.includes(incident.kind)) {
      fail(run, `hit:${incident.kind}`, out);
      return out;
    }
    if (run.sinceIncident >= INCIDENT_GAP) {
      run.sinceIncident = 0;
      run.stats.incidents++;
      if (e.type === 'crash') run.stats.crashes++;
      else run.stats.hits++;
      out.push({ type: 'incident', kind: incident.kind, id: run.plan.id });
      if (m && run.meter != null && run.stepIndex >= (m.fromStep || 0)) run.meter = Math.max(0, run.meter - (e.type === 'crash' ? m.crash : m.hit) * (0.5 + 0.5 * clamp(incident.strength ?? 0.5, 0, 1)));
      const isVehicleHit = e.type === 'traffic:hit' && !['ped', 'cow'].includes(incident.kind);
      if (rules.noCrash && (e.type === 'crash' || isVehicleHit)) {
        fail(run, 'crash', out);
        return out;
      }
    }
  }
  if (e.type === 'land') {
    run.stats.lands++;
    if (m && run.meter != null && (Number(e.impact) || 0) > 8) run.meter = Math.max(0, run.meter - (m.land || 0));
  }
  const def = currentStep(run);
  if (def) settle(run, eventStep(def, currentState(run), e), out);
  if (m?.failAtZero && run.status === 'active' && run.meter <= 0) fail(run, 'meter', out);
  return out.length ? out : NONE;
}

/** Give up. */
export function abandonRun(run) {
  if (run.status === 'active') {
    run.status = 'failed';
    run.failReason = 'abandoned';
  }
}

/** What the mission pays when it ends now: { cash, rep, parts: [{ label, amount }] }. */
export function payout(plan, run) {
  const base = plan.reward?.cash || 0;
  const parts = [{ label: 'Mission pay', amount: base }];
  if (run.stepFracs.length || (plan.timeLimit && run.timeLeft != null)) {
    const fracs = run.stepFracs.length ? run.stepFracs : [clamp(run.timeLeft / plan.timeLimit, 0, 1)];
    const f = fracs.reduce((a, b) => a + b, 0) / fracs.length;
    const amt = Math.round(base * 0.25 * f);
    if (amt > 0) parts.push({ label: 'Time bonus', amount: amt });
  }
  const meter = plan.rules?.meter;
  if (meter && run.meter != null) {
    const amt = Math.round(base * 0.3 * clamp(run.meter, 0, 1));
    if (amt > 0) parts.push({ label: `${meter.label} bonus`, amount: amt });
  }
  if (run.stats.incidents === 0 && plan.rules?.cleanBonus !== false) parts.push({ label: 'Clean drive', amount: Math.round(base * 0.1) });
  let air = 0;
  plan.steps.forEach((s, i) => {
    if (s.type === 'jumps') air += run.states[i]?.air || 0;
  });
  if (air > 0) parts.push({ label: 'Air time', amount: Math.round(Math.min(air, 6) * 45) });
  let cash = parts.reduce((a, p) => a + p.amount, 0);
  if (plan.mult > 1) {
    const extra = Math.round(cash * (plan.mult - 1));
    parts.push({ label: 'Daily job x' + plan.mult, amount: extra });
    cash += extra;
  }
  const rep = Math.round((plan.reward?.rep || 0) * (plan.mult > 1 ? 1.5 : 1) * (run.stats.incidents === 0 ? 1 : 0.8));
  return { cash, rep, parts };
}

/** Everything the HUD and the log need about a live run, as plain data (no references into the run). */
export function runView(run, sample) {
  const plan = run.plan;
  const def = currentStep(run);
  const left = clockLeft(run);
  return {
    id: plan.id,
    defId: plan.defId,
    title: plan.title,
    te: plan.te,
    kind: plan.kind,
    blurb: plan.blurb,
    diff: plan.diff,
    reward: plan.reward,
    status: run.status,
    stepIndex: run.stepIndex,
    steps: plan.steps.map((s, i) => ({ label: s.label, te: s.te || '', done: i < run.stepIndex, current: i === run.stepIndex && run.status === 'active' })),
    hint: def?.hint || '',
    progress: def ? hudOf(def, currentState(run), sample || {}) : '',
    note: currentState(run)?.note || '',
    timeLeft: left == null ? null : Math.max(0, left),
    timeTotal: clockTotal(run),
    meter: run.meter == null ? null : { label: plan.rules.meter.label, te: plan.rules.meter.te, value: clamp(run.meter, 0, 1) },
    incidents: run.stats.incidents,
    failReason: run.failReason,
  };
}

export { targetsOf };

// ---------------------------------------------------------------------------------------------------------------------------------
// Saved progress. Stored in profile.data.quests.board (the profile keeps `quests` as an opaque object, so we sanitise our part).

export const SAVE_VERSION = 1;
export const defaultSave = () => ({ v: SAVE_VERSION, rep: 0, completed: 0, failed: 0, done: {}, best: {}, tutorial: null, daily: { key: '', id: '', done: false }, earned: 0 });

const idOk = (k) => typeof k === 'string' && /^[\w:.-]{1,40}$/.test(k);
const num = (v, max = 1e9) => (Number.isFinite(Number(v)) ? clamp(Math.floor(Number(v)), 0, max) : 0);

export function normalizeSave(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const done = {};
  if (raw.done && typeof raw.done === 'object') for (const [k, v] of Object.entries(raw.done)) if (idOk(k) && num(v) > 0) done[k] = num(v, 99999);
  const best = {};
  if (raw.best && typeof raw.best === 'object') for (const [k, v] of Object.entries(raw.best)) if (idOk(k) && Number(v) > 0) best[k] = Math.min(99999, Number(v));
  const dl = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
  return {
    ...d,
    rep: num(raw.rep),
    completed: num(raw.completed),
    failed: num(raw.failed),
    earned: num(raw.earned),
    done,
    best,
    tutorial: raw.tutorial === 'done' || raw.tutorial === 'skipped' ? raw.tutorial : null,
    daily: { key: typeof dl.key === 'string' ? dl.key.slice(0, 12) : '', id: idOk(dl.id) ? dl.id : '', done: dl.done === true },
  };
}

/** Record a finished mission in the save (mutates and returns it). `pay` = the payout. */
export function recordComplete(save, plan, pay, elapsed) {
  save.rep += pay.rep;
  save.completed++;
  save.earned += pay.cash;
  save.done[plan.defId] = (save.done[plan.defId] || 0) + 1;
  const prev = save.best[plan.defId];
  if (!(prev > 0) || elapsed < prev) save.best[plan.defId] = Math.round(elapsed * 10) / 10;
  return save;
}

export const isUnlocked = (def, save) => (save.rep || 0) >= (def.minRep || 0);
export const rankOf = (save) => rankFor(save.rep);
