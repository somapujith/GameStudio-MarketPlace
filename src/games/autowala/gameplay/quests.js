// OWNER: quests agent. Missions, the tutorial "Mama's First Day", the job board at Mama's Garage, reputation.
//
// The pieces (all in gameplay/quest-*.js): quest-defs.js (the missions as data + plan builders), quest-engine.js (the pure state
// machine + saved progress), quest-steps.js (step types), quest-math/places/ramps (pure helpers), quest-props.js + quest-world.js
// (what a running mission shows in the 3D world). The UI is ui/QuestLog.jsx + ui/quests/*.
//
// ctx.quests = {
//   active:      the live mission as plain data (runView) or null; never the tutorial        { id, title, te, steps:[{label,te,done,current}], stepIndex, timeLeft, timeTotal, progress, note, meter, reward, ... }
//   tutorial:    the live tutorial as plain data or null (same shape)
//   available:   the job board: [{ id, defId, title, te, blurb, diff 1..3, kind, reward {cash, rep}, timeLimit|null, locked, minRep, done, best, daily, unavailable, plan }]
//   done:        [defId...] missions finished at least once
//   reputation:  points (number)     rank: { index, title, te, floor, next }
//   accept(id), abandon(), board() (opens the job board menu), log() (opens the quest log), skipTutorial(), startTutorial(), run (the live engine run, for tests)
// }
// Events: quest:offer {id} (board opened), quest:accept {id,title}, quest:step {id,index,label}, quest:complete {id,title,payout}, quest:fail {id,title,reason}.
// Snapshot key `quest`: { active, tutorial, last, rep, rank, completed, offers (slim), boardNear, canAccept }.
// Rewards pay through ctx.economy.add(n, 'quest', 'bonus'). Menus: 'jobs' (the board) and 'quests' (the log), both drawn by ui/QuestLog.jsx.
import { hashString, makeRng } from '../game/rng.js';
import { createRouter } from '../world/routing.js';
import { randomLook } from '../sim/autoModel.js';
import { clearPassengers, seatPassengers } from './customers.js';
import { DEFS, DEF_BY_ID, dailyJob, replayOf, tutorialPlan } from './quest-defs.js';
import { abandonRun, createRun, currentStep, feedRun, isUnlocked, normalizeSave, rankOf, recordComplete, runView, tickRun } from './quest-engine.js';
import { dateKey, shouldRebuildOffers } from './quest-math.js';
import { createBoardSign } from './quest-props.js';
import { createQuestWorld } from './quest-world.js';

const BOARD_RADIUS = 8; // m from the sign
const BOARD_SPEED = 6; // m/s: slower than this to use it
const OFFERS_STALE = 25; // s of play before the board is re-rolled
const RESULT_SECONDS = 9;

const slim = (o) => ({
  id: o.id, defId: o.defId, title: o.title, te: o.te, blurb: o.blurb, diff: o.diff, kind: o.kind, reward: o.reward,
  timeLimit: o.timeLimit, locked: o.locked, minRep: o.minRep, done: o.done, best: o.best, daily: o.daily, unavailable: o.unavailable, doneToday: o.doneToday, steps: o.steps,
  stepList: o.plan ? o.plan.steps.map((s) => ({ label: s.label, te: s.te || '' })) : [],
});

/** The sign's spot: on the pavement a few metres along the road from the garage, away from the workshop's entry ring. */
function pickBoardSpot(world) {
  const garage = world.city?.poiById?.garage;
  if (!garage?.front) return null;
  const f = garage.front;
  const e = world.city.edges?.[f.edge];
  const d = e ? { x: e.dx, z: e.dz } : { x: 1, z: 0 };
  let nx = garage.x - f.x;
  let nz = garage.z - f.z;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl;
  nz /= nl;
  const half = (e?.w || 8) / 2;
  for (const along of [18, -18, 21, -21, 16, -16, 25, -25]) {
    for (const off of [half + 1.8, half + 2.6, half + 1.1]) {
      const x = f.x + d.x * along + nx * off;
      const z = f.z + d.z * along + nz * off;
      if (world.colliders?.inside?.(x, z, 1.8)) continue;
      return { x, z, yaw: Math.atan2(-nx, -nz) };
    }
  }
  return { x: f.x + d.x * 18, z: f.z + d.z * 18, yaw: Math.atan2(-nx, -nz) };
}

export function installQuests(ctx) {
  const { world, v, state, profile, input, economy } = ctx;
  const city = world.city;
  const q = profile.data.quests && typeof profile.data.quests === 'object' ? profile.data.quests : (profile.data.quests = {});
  const save = (q.board = normalizeSave(q.board));
  const persist = () => profile.save();

  const router = createRouter(city);
  const route = (a, b) => router.route(a, b);
  const spot = pickBoardSpot(world);
  const qworld = createQuestWorld(ctx, spot);
  const sign = spot ? createBoardSign(ctx.scene, spot.x, (world.heightAt?.(spot.x, spot.z) || 0), spot.z, spot.yaw) : null;
  const boardTarget = spot ? { x: spot.x, z: spot.z } : null;

  // ---- state --------------------------------------------------------------------------------------------------------------------
  let run = null; // the live engine run (a mission or the tutorial)
  let tutorial = false;
  let offers = [];
  let offersAt = -999;
  let offersDirty = true;
  let rollSeed = 1;
  let last = null; // { ok, title, te, payout?, reason?, until }
  let ourTarget = null;
  let boardNear = false;
  let tutorialTimer = -1;
  let sinceView = 99;
  let activeView = null;
  let tutView = null;
  const sample = { x: 0, z: 0, speed: 0, airborne: false, jolt: 0, distance: 0, time: 0 };
  const env = { trains: world.metro?.trains || null };
  const rnd = makeRng(hashString(`autowala-quests-${profile.data.rides || 0}`) ^ 0x51ed);

  // ---- the live metro trains' velocity (for "beat the train") -------------------------------------------------------------
  const trains = world.metro?.trains || [];
  const tracks = trains.map((t) => ({ x: t.x, z: t.z, vx: 0, vz: 0, t: 0 }));
  let trackClock = 0;
  const trackTrains = (dt) => {
    trackClock += dt;
    if (trackClock < 0.5) return;
    for (let i = 0; i < trains.length; i++) {
      const t = trains[i];
      const k = tracks[i];
      k.vx = (t.x - k.x) / trackClock;
      k.vz = (t.z - k.z) / trackClock;
      k.x = t.x;
      k.z = t.z;
    }
    trackClock = 0;
  };

  // ---- the job board -------------------------------------------------------------------------------------------------------------
  const makeEnv = (seed) => ({
    city,
    route,
    rng: makeRng(seed),
    player: { x: v.x, z: v.z },
    metro: world.metro?.stations?.length
      ? { stations: world.metro.stations, trains: trains.map((t, i) => ({ x: t.x, z: t.z, speed: t.speed, line: t.line, vx: tracks[i].vx, vz: tracks[i].vz })) }
      : null,
  });

  const offerTime = (plan) => plan.timeLimit || plan.steps.reduce((a, s) => a + (s.timeLimit || 0), 0) || null;

  function buildOffers() {
    const key = dateKey();
    if (save.daily.key !== key) save.daily = { key, id: '', done: false };
    rollSeed++;
    const out = [];
    const mk = (def, plan, extra = {}) => ({
      id: extra.daily ? 'daily' : def.id,
      defId: def.id,
      title: plan?.title || def.title,
      te: def.te,
      blurb: def.blurb,
      diff: def.diff,
      kind: def.kind,
      reward: plan ? { cash: Math.round(plan.reward.cash * (plan.mult || 1)), rep: Math.round(plan.reward.rep * (plan.mult > 1 ? 1.5 : 1)) } : { ...def.reward },
      timeLimit: plan ? offerTime(plan) : null,
      steps: plan ? plan.steps.length : 0,
      locked: !isUnlocked(def, save),
      minRep: def.minRep || 0,
      done: save.done[def.id] || 0,
      best: save.best[def.id] || 0,
      daily: !!extra.daily,
      doneToday: !!extra.daily && save.daily.done,
      unavailable: !plan,
      plan,
    });
    try {
      const dj = dailyJob(makeEnv(hashString(key)), key);
      if (dj) {
        save.daily.id = dj.defId;
        out.push(mk(DEF_BY_ID[dj.defId], dj.plan, { daily: true }));
      }
    } catch (err) {
      console.error('[autowala] daily job failed', err);
    }
    for (const def of DEFS) {
      let plan = null;
      try {
        plan = def.plan(makeEnv(hashString(def.id) + rollSeed * 7919));
      } catch (err) {
        console.error(`[autowala] mission ${def.id} could not be planned`, err);
      }
      out.push(mk(def, plan));
    }
    offers = out;
    offersAt = ctx.clock.time;
    offersDirty = false;
    api.available = offers;
  }

  const ensureOffers = (force) => {
    const boardOpen = state.menu === 'jobs'; // on the board the player accepts what they are looking at: never re-roll it under them
    if (shouldRebuildOffers({ force, dirty: offersDirty, age: ctx.clock.time - offersAt, stale: OFFERS_STALE, empty: !offers.length, boardOpen })) buildOffers();
  };

  // ---- starting and ending missions ----------------------------------------------------------------------------------------------
  const riding = () => ctx.fares?.trip?.status === 'riding';

  function startRun(plan, isTutorial) {
    if (run && run.status === 'active') return false;
    run = createRun(plan);
    tutorial = !!isTutorial;
    last = null;
    qworld.setRun(run);
    sinceView = 99;
    ctx.emit('quest:accept', { id: plan.id, defId: plan.defId, title: plan.title, tutorial });
    if (!isTutorial) ctx.toast(`Mission: ${plan.title}`, { tone: 'gold', ms: 3200 });
    return true;
  }

  function endRun(ok, info) {
    const plan = run.plan;
    last = { ok, title: plan.title, te: plan.te, tutorial, until: ctx.clock.time + RESULT_SECONDS, ...info };
    if (!(ctx.fares?.trip?.status === 'riding')) clearPassengers(ctx.auto);
    qworld.setRun(null);
    ctx.setPrompt('quest-hint', null);
    if (ourTarget && ctx.route && ctx.route.debugTarget === ourTarget) ctx.route.debugTarget = null;
    ourTarget = null;
    run = null;
    tutorial = false;
    offersDirty = true;
    activeView = null;
    tutView = null;
  }

  function onComplete(e) {
    const plan = run.plan;
    const pay = e.payout;
    if (pay.cash > 0) economy.add(pay.cash, `quest:${plan.defId}`, 'bonus');
    const elapsed = run.elapsed;
    if (plan.tutorial) {
      save.tutorial = 'done';
      save.rep += pay.rep;
      save.earned += pay.cash;
    } else {
      recordComplete(save, plan, pay, elapsed);
      if (plan.daily) {
        save.daily = { key: plan.dailyKey || dateKey(), id: plan.defId, done: true };
        save.done.daily = (save.done.daily || 0) + 1;
      }
    }
    persist();
    ctx.toast(plan.replay ? 'Tutorial done again. Good practice!' : plan.tutorial ? `First day done! +Rs ${pay.cash}` : `Mission complete! +Rs ${pay.cash}`, { tone: 'gold', ms: 4200 });
    if (pay.rep > 0) ctx.toast(`+${pay.rep} reputation`, { tone: 'info', ms: 3000 });
    const before = rankOf({ rep: save.rep - pay.rep }).index;
    if (rankOf(save).index > before) ctx.toast(`New rank: ${rankOf(save).title}`, { tone: 'gold', ms: 4200 });
    ctx.emit('quest:complete', { id: plan.id, defId: plan.defId, title: plan.title, payout: pay, tutorial: !!plan.tutorial });
    endRun(true, { payout: pay, elapsed });
  }

  function onFail(e) {
    const plan = run.plan;
    save.failed++;
    persist();
    ctx.toast(failText(e.reason), { tone: 'bad', ms: 3600 });
    ctx.emit('quest:fail', { id: plan.id, defId: plan.defId, title: plan.title, reason: e.reason, tutorial: !!plan.tutorial });
    endRun(false, { reason: e.reason });
  }

  function handle(events) {
    if (!events.length || !run) return;
    for (const e of events) {
      if (!run) return;
      if (e.type === 'step') {
        const def = run.plan.steps[e.index];
        ctx.emit('quest:step', { id: run.plan.id, index: e.index, label: e.label });
        if (def?.seat) seatPassengers(ctx.auto, { pax: 1, look: randomLook(rnd) });
        const next = run.plan.steps[e.index + 1];
        if (next && !tutorial) ctx.toast(next.label, { tone: 'info', ms: 3200 });
      } else if (e.type === 'complete') onComplete(e);
      else if (e.type === 'fail') onFail(e);
      else if (e.type === 'incident' && !tutorial) ctx.toast(run.plan.rules?.meter ? 'Bump! It is cooling down' : 'Careful!', { tone: 'bad', ms: 1100 });
    }
  }

  // ---- the public API --------------------------------------------------------------------------------------------------------------
  const api = {
    active: null,
    tutorial: null,
    available: offers,
    get done() {
      return Object.keys(save.done);
    },
    get reputation() {
      return save.rep;
    },
    get rank() {
      return rankOf(save);
    },
    get run() {
      return run;
    },
    boardAt: spot ? { x: spot.x, z: spot.z } : null,
    get saved() {
      return save;
    },
    accept(id) {
      if (run && run.status === 'active') {
        ctx.toast('Finish or abandon your current mission first', { tone: 'bad' });
        return false;
      }
      ensureOffers(false);
      if (id === 'metro') buildOffers(); // the trains move: plan against where they are now, not where they were when the board opened
      const o = offers.find((x) => x.id === id);
      if (!o || !o.plan) {
        ctx.toast('That job is not available right now', { tone: 'bad' });
        return false;
      }
      if (o.locked) {
        ctx.toast(`Needs ${o.minRep} reputation (you have ${save.rep})`, { tone: 'bad' });
        return false;
      }
      if (o.doneToday) {
        ctx.toast('Daily job already done. Come back tomorrow', { tone: 'info' });
        return false;
      }
      if (riding()) {
        ctx.toast('Finish your fare first', { tone: 'bad' });
        return false;
      }
      if (state.menu === 'jobs') ctx.closeMenu();
      return startRun(o.plan, false);
    },
    abandon() {
      if (!run || run.status !== 'active') return false;
      if (tutorial) return api.skipTutorial();
      const plan = run.plan;
      abandonRun(run);
      ctx.toast('Mission abandoned', { tone: 'info' });
      ctx.emit('quest:fail', { id: plan.id, defId: plan.defId, title: plan.title, reason: 'abandoned' });
      endRun(false, { reason: 'abandoned' });
      return true;
    },
    board() {
      if (state.menu && state.menu !== 'jobs') return false;
      ensureOffers(true);
      ctx.emit('quest:offer', { count: offers.length });
      if (state.menu !== 'jobs') ctx.openMenu('jobs');
      return true;
    },
    log() {
      if (!state.menu) ctx.openMenu('quests');
      else if (state.menu === 'quests') ctx.closeMenu();
    },
    startTutorial() {
      if (run) return false;
      const first = tutorialPlan({ city, route, rng: makeRng(7), player: { x: v.x, z: v.z } });
      if (!first) return false;
      const plan = save.tutorial === 'done' ? replayOf(first) : first; // the pay is for the first time only
      return startRun(plan, true);
    },
    skipTutorial() {
      if (save.tutorial == null || (run && tutorial && save.tutorial !== 'done')) save.tutorial = 'skipped'; // skipping a replay must not undo 'done'
      persist();
      if (run && tutorial) {
        const plan = run.plan;
        abandonRun(run);
        ctx.emit('quest:fail', { id: plan.id, defId: plan.defId, title: plan.title, reason: 'skipped', tutorial: true });
        ctx.toast('Tutorial skipped. You can still ask Mama at the garage', { tone: 'info' });
        endRun(false, { reason: 'skipped' });
      }
      return true;
    },
  };
  ctx.quests = api;

  // ---- events --------------------------------------------------------------------------------------------------------------------
  const off = ctx.game.on((e) => {
    if (e.type === 'menu' && e.name === null && e.was === 'start' && save.tutorial == null && tutorialTimer < 0) tutorialTimer = 1.5;
    if (!run || run.status !== 'active' || e.type.startsWith('quest:')) return;
    handle(feedRun(run, e));
  });

  // the tutorial skip key (N) while the tutorial runs
  const onKey = (e) => {
    if (e.key?.toLowerCase() === 'n' && run && tutorial && !state.menu && !e.repeat) api.skipTutorial();
  };
  window.addEventListener('keydown', onKey);

  // a profile that already has a career does not need the first-day tutorial
  if (save.tutorial == null && (profile.data.rides || 0) >= 3) {
    save.tutorial = 'skipped';
    persist();
  }

  // ---- per frame ----------------------------------------------------------------------------------------------------------------
  const system = {
    update(dt) {
      sample.x = v.x;
      sample.z = v.z;
      sample.speed = v.speed;
      sample.airborne = v.airborne;
      sample.jolt = v.jolt || 0;
      sample.distance = v.distance;
      sample.time = ctx.clock.time;
      if (trains.length) trackTrains(dt);

      // the quest-log key (Q / the touch button / gamepad Back)
      if (input.pressed('quests')) {
        if (!state.menu) ctx.openMenu('quests');
        else if (state.menu === 'quests') ctx.closeMenu();
      }

      // the job board
      boardNear = false;
      if (boardTarget && !state.menu && !state.paused) {
        const d = Math.hypot(v.x - boardTarget.x, v.z - boardTarget.z);
        if (d < BOARD_RADIUS && v.speed < BOARD_SPEED && !v.airborne) {
          boardNear = true;
          ctx.setPrompt('quest-board', run && !tutorial ? 'Press E for the job board (a mission is running)' : 'Press E for the job board', 'E');
          if (input.pressed('interact')) api.board();
        } else ctx.setPrompt('quest-board', null);
      } else if (boardTarget) ctx.setPrompt('quest-board', null);
      if (state.menu === 'jobs') input.pressed('interact');

      // the tutorial starts a moment after the start screen closes, on a first launch
      if (tutorialTimer >= 0 && !state.menu) {
        tutorialTimer -= dt;
        if (tutorialTimer < 0 && !run && save.tutorial == null) api.startTutorial();
      }

      // the running mission
      const playing = run && run.status === 'active' && !state.menu && !state.paused;
      if (playing) handle(tickRun(run, dt, sample, env));
      const cowHit = qworld.update(dt, ctx.clock.time, run, sample);
      if (cowHit && run && run.status === 'active' && !state.menu) {
        ctx.rig?.kick?.(0.35);
        v.jolt = Math.min(1, (v.jolt || 0) + 0.3);
        handle(feedRun(run, { type: 'traffic:hit', kind: 'cow', severity: 0.4 }));
      }

      // route / minimap waypoint: the mission's current target, unless a fare is on board (its route wins then)
      if (ctx.route) {
        const wp = run && run.status === 'active' && !riding() ? qworld.waypoint : null;
        if (wp) {
          if (!ourTarget) ourTarget = { type: 'quest', id: 'quest', name: run.plan.title };
          ourTarget.x = wp.x;
          ourTarget.z = wp.z;
          if (ctx.route.debugTarget !== ourTarget) ctx.route.debugTarget = ourTarget;
        } else if (ourTarget && ctx.route.debugTarget === ourTarget) {
          ctx.route.debugTarget = null;
        }
      }

      // the plain-data views (10 Hz)
      sinceView += dt;
      if (sinceView > 0.1) {
        sinceView = 0;
        if (run) {
          const view = runView(run, sample);
          const def = currentStep(run);
          if (tutorial) {
            view.key = def?.key || '';
            tutView = view;
            activeView = null;
          } else {
            activeView = view;
            tutView = null;
          }
        } else {
          activeView = tutView = null;
        }
        api.active = activeView;
        api.tutorial = tutView;
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      off();
      ctx.setPrompt('quest-board', null);
      ctx.setPrompt('quest-hint', null);
      if (ourTarget && ctx.route?.debugTarget === ourTarget) ctx.route.debugTarget = null;
      if (run && !(ctx.fares?.trip?.status === 'riding')) clearPassengers(ctx.auto);
      qworld.dispose();
      sign?.dispose();
      profile.flush?.();
    },
  };
  ctx.addSystem(system);

  let slimCache = null;
  let slimFor = null;
  ctx.addSnapshot(() => {
    if (slimFor !== offers) {
      slimFor = offers;
      slimCache = offers.map(slim);
    }
    const lastOut = last && ctx.clock.time < last.until ? last : null;
    return {
      quest: {
        active: activeView,
        tutorial: tutView,
        last: lastOut,
        rep: save.rep,
        rank: rankOf(save),
        completed: save.completed,
        offers: slimCache || [],
        boardNear,
        canAccept: !run && !riding(),
        dailyDone: save.daily.done,
        tutorialState: save.tutorial,
      },
    };
  });
}

const FAIL_TEXT = {
  time: 'Out of time. Mission failed',
  crash: 'You crashed. Mission failed',
  meter: 'It went cold. Mission failed',
  rival: 'The rival won the race',
  lost: 'You lost the baraat',
  overtake: 'You overtook the baraat. Mission failed',
  train: 'The train left without them',
  abandoned: 'Mission abandoned',
  skipped: 'Tutorial skipped',
};
export const failText = (reason) => FAIL_TEXT[reason] || (String(reason).startsWith('hit:') ? `You hit a ${String(reason).slice(4)}. Mission failed` : 'Mission failed');
