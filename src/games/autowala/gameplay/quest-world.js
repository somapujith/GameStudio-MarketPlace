// OWNER: quests agent. What a running mission shows and does in the 3D world: glowing waypoint markers (fare-markers.js kit, read-only),
// stunt ramps (+ a height wrapper on `world.heightAt` while they are out), standing cows, the baraat convoy and the rival auto.
// Created when a mission starts, disposed when it ends. Per frame it only writes into preallocated arrays.
import { createMarkerKit } from './fare-markers.js';
import { createCows, createConvoy, createRamps, createRival } from './quest-props.js';
import { pathAt } from './quest-math.js';
import { prepareRamps, rampsHeight } from './quest-ramps.js';
import { currentState, currentStep, targetsOf } from './quest-engine.js';

const COW_HIT = 2.25; // m between the auto's centre and a cow's centre
const KITE_COLORS = [[0.95, 0.25, 0.6], [0.25, 0.85, 0.95], [0.95, 0.75, 0.15], [0.55, 0.35, 0.98], [0.4, 0.95, 0.25], [0.98, 0.42, 0.15], [0.25, 0.55, 0.98]]; // <= 1: the bloom starts at ~1.05
const P = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };

export function createQuestWorld(ctx, boardSpot = null) {
  const { scene, world } = ctx;
  const kit = createMarkerKit(scene, { rings: 8, diamonds: 16, beams: 8 });
  let targets = [];
  let nextTargets = 0;
  let props = null; // { ramps, cows, convoy, rival, plan, raceIdx, escortIdx, cowList, rampList }

  // ---- stunt ramps: one wrapper on world.heightAt, a pass-through when no ramps are out ----------------------------------
  const baseHeight = world.heightAt;
  let rampList = [];
  const wrapped = baseHeight
    ? (x, z) => (rampList.length ? baseHeight(x, z) + rampsHeight(rampList, x, z) : baseHeight(x, z))
    : null;
  if (wrapped) world.heightAt = wrapped;

  const stop = () => {
    if (!props) return;
    props.ramps?.dispose();
    props.cows?.dispose();
    props.convoy?.dispose();
    props.rival?.dispose();
    props = null;
    rampList = [];
    targets = [];
  };

  kit.addPainter((k, time) => {
    if (boardSpot) {
      // a small cyan diamond over the job board sign, so it can be found from the street
      k.diamond(boardSpot.x, 5.4 + Math.sin(time * 2) * 0.3, boardSpot.z, 0.6, 0.9, time * 1.3, 0.2, 0.75, 0.95);
    }
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.kind === 'kite') {
        const c = KITE_COLORS[(t.i || 0) % KITE_COLORS.length];
        const bob = Math.sin(time * 2.2 + (t.i || 0) * 1.7) * 0.7;
        k.diamond(t.x, 5 + bob, t.z, 0.95, 1.4, time * 1.6 + (t.i || 0), c[0], c[1], c[2]);
        k.beam(t.x, 0.1, t.z, 0.1, 4.2 + bob, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
        k.ring(t.x, 0.12, t.z, 3.2, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      } else if (t.kind === 'convoy') {
        k.diamond(t.x, 6, t.z, 0.8, 1.2, time * 2, 0.55, 0.35, 0.95);
      } else {
        const pulse = 1 + 0.05 * Math.sin(time * (t.stop ? 5 : 3.2));
        const rr = Math.min(t.r, 9) * 0.82 * pulse;
        const finish = t.kind === 'finish';
        const r = finish ? 0.98 : t.stop ? 0.95 : 0.15;
        const g = finish ? 0.4 : t.stop ? 0.7 : 0.8;
        const b = finish ? 0.75 : t.stop ? 0.15 : 0.98;
        k.ring(t.x, 0.14, t.z, rr, r, g, b);
        k.beam(t.x, 0.1, t.z, 0.45, 26, r * 0.8, g * 0.8, b * 0.8);
        k.diamond(t.x, 6.2 + Math.sin(time * 2.4) * 0.35, t.z, 0.7, 1.05, time * 1.7, r, g, b);
      }
    }
  });

  return {
    /** The marker the minimap route should lead to right now ({x, z, name}) or null. */
    get waypoint() {
      return targets.find((t) => t.kind !== 'convoy') || null;
    },
    /** Build the props a plan needs (and drop the previous ones). `run` may be null to just clean up. */
    setRun(run) {
      stop();
      targets = [];
      nextTargets = 0;
      if (!run) return;
      const plan = run.plan;
      props = { plan, raceIdx: plan.steps.findIndex((s) => s.type === 'race'), escortIdx: plan.steps.findIndex((s) => s.type === 'escort') };
      if (plan.props?.ramps?.length) {
        rampList = prepareRamps(plan.props.ramps.map((r) => ({ ...r })));
        props.ramps = createRamps(scene, rampList);
      }
      if (plan.props?.cows?.length) {
        props.cowList = plan.props.cows;
        props.cows = createCows(scene, plan.props.cows);
      }
      if (plan.props?.convoy && props.escortIdx >= 0) props.convoy = createConvoy(scene);
      if (plan.props?.rival && props.raceIdx >= 0) props.rival = createRival(scene, plan.props.rival.color);
    },
    /**
     * Per-frame update while a mission runs. Returns true when the player touched a cow.
     * `run` may be null (then only the markers of nothing are drawn).
     */
    update(dt, time, run, sample) {
      let cowHit = false;
      if (run && props && run.status === 'active') {
        if (props.cowList) {
          const cl = props.cowList;
          for (let i = 0; i < cl.length; i++) {
            const dx = sample.x - cl[i].x;
            const dz = sample.z - cl[i].z;
            if (dx * dx + dz * dz < COW_HIT * COW_HIT) cowHit = true;
          }
        }
        if (props.convoy && props.escortIdx >= 0) {
          const st = run.states[props.escortIdx];
          const path = run.plan.steps[props.escortIdx].path;
          pathAt(path, st.u + 5.5, P);
          props.convoy.place(P.x, P.z, P.heading);
        }
        if (props.rival && props.raceIdx >= 0) {
          const st = run.states[props.raceIdx];
          const path = run.plan.steps[props.raceIdx].path;
          pathAt(path, st.rivalS, P);
          props.rival.place(P.x, P.z, P.heading, st.go && run.stepIndex === props.raceIdx ? 12 : 0, dt);
        }
      }
      nextTargets -= dt;
      if (nextTargets <= 0) {
        nextTargets = 0.15;
        if (run && run.status === 'active') {
          targets = [];
          const def = currentStep(run);
          if (def) targetsOf(def, currentState(run), targets);
        } else targets = [];
      }
      kit.frame(time);
      return cowHit;
    },
    dispose() {
      stop();
      if (wrapped && world.heightAt === wrapped) world.heightAt = baseHeight; // else someone wrapped us: we stay a pass-through
      rampList = [];
      kit.dispose();
    },
  };
}
