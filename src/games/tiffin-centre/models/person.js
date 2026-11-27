// A person: sculpted head (face.js) + hair/headwear (hair.js) + body with IK limbs (bodies.js) + clothes (clothes.js),
// with one update loop. Customers, the cook avatar and the first-person viewmodel are built on this (or on its parts).
import { Color, Group, Vector3 } from 'three';
import { buildHead } from './face.js';
import { buildHair } from './hair.js';
import { buildBody, CH } from './bodies.js';
import { dress } from './clothes.js';
import { disposeObject } from './util.js';
import { tierOf } from './charquality.js';

/** Darken (k < 1) or lighten (k > 1) a colour, returns '#rrggbb'. */
export function shade(c, k) {
  const col = new Color(c);
  col.multiplyScalar(k);
  return `#${col.getHexString()}`;
}

const _t = new Vector3();

/**
 * buildPerson(spec) -> { group, head, hair, body, clothes, setExpression, setSpeaking, lookAt, update(dt, t), dispose }
 * spec: { kind, seed, face (param overrides), gender, height, belly, shoulders, hips, child,
 *         hair: { style, headwear, color, grey, clothColor, clothColor2, pattern, gajra }, outfit, quality }
 */
export function buildPerson(spec) {
  return runSteps(buildPersonSteps(spec));
}

/** Drives a generator of build steps to the end and returns its value (the synchronous way to use a `*...Steps` builder). */
export function runSteps(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/**
 * The same build as buildPerson, as a generator that yields between its stages (head, body, hair, clothes): a caller that must not drop a frame (a customer
 * walking up mid-shift) runs one stage per frame; `yield*` it from a bigger builder, or use buildPerson / runSteps for the one-shot build.
 */
export function* buildPersonSteps(spec) {
  const tier = tierOf(spec.quality);
  const group = new Group();
  group.name = `person-${spec.kind || 'x'}`;
  const head = buildHead({ kind: spec.kind, seed: spec.seed, face: spec.face, params: spec.params, quality: tier.id });
  yield;
  const P = head.params;
  const child = P.child;
  const body = buildBody({
    gender: P.gender,
    height: spec.height,
    belly: spec.belly,
    shoulders: spec.shoulders,
    hips: spec.hips,
    child,
    skin: head.skin,
    quality: tier.id,
  });
  group.add(body.group);
  body.attachHead(head, body.S * (1 + child * 0.32));
  yield;
  const h = spec.hair || {};
  const hair = buildHair({ shape: head.shape, quality: tier.id, ...h, style: h.style ?? 'short' });
  head.group.add(hair.group);
  yield;
  const clothes = dress(body, spec.outfit || {});
  const pose = body.pose;
  const api = {
    group,
    head,
    hair,
    body,
    clothes,
    params: P,
    height: body.S * 1.7,
    setExpression: (n, w, ms) => head.setExpression(n, w, ms),
    setSpeaking: (ms, i) => head.setSpeaking(ms, i),
    lookAt(v) {
      head.lookAt(v);
    },
    /** Head posture offsets (radians) added on top of the expression, set by the owner (body language). */
    headBias: { pitch: 0, yaw: 0, roll: 0 },
    update(dt, t) {
      head.update(dt, t);
      const e = head.expr;
      const g = head.gaze;
      const follow = 0.5;
      pose.tgt[CH.hdPitch] = e.headPitch + e.nodPitch + api.headBias.pitch - g.pitch * follow;
      pose.tgt[CH.hdYaw] = e.headYaw + e.nodYaw + api.headBias.yaw + g.yaw * follow;
      pose.tgt[CH.hdRoll] = e.headRoll + api.headBias.roll;
      body.update(dt);
      clothes.update(dt, t);
    },
    dispose() {
      hair.dispose();
      head.dispose();
      body.dispose();
      clothes.dispose();
      disposeObject(group);
    },
  };
  void _t;
  return api;
}

export { CH };
