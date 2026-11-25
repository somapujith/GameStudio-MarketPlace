// OWNER: minimap agent. Keeps ctx.route up to date for ctx.fares.target() and draws the 3D route ribbon.
//
//   ctx.route = {
//     points:   [{x,z}]  polyline along the roads from the player (trimmed as they drive) to the target; [] with no target
//     length:   metres left on the route (same as `remaining`)           total: metres of the route when it was last planned
//     eta:      seconds left at ~11 m/s average
//     target:   the ctx.fares.target() object being routed to (or the debug one), null when idle
//     nextTurn: 'left'|'right'|'straight'|'uturn'|null,  turnDistance: metres to it
//     stamp:    increases whenever a new route is planned (consumers can cache on it)
//     debugTarget: {x,z}  set this by hand to test without the fares system (wins over ctx.fares.target())
//   }
// Snapshot (HUD): route: { length, eta, nextTurn, turnDistance } | null
import { createRouter, nextTurn as computeNextTurn } from '../world/routing.js';
import { createRouteRibbon } from './route-ribbon.js';
import { trimRoute, pathLength, etaFor, targetKey, withStubs } from './route-math.js';

const REROUTE_EVERY = 0.6; // s
const OFF_ROUTE = 25; // m: further than this from the path means plan again now
const KEEP_BETTER = 12; // m: a periodic re-plan only replaces the current path when it is clearly shorter
const ARRIVED = 4; // m

export function installRouteGuide(ctx) {
  const route = {
    points: [], length: 0, total: 0, remaining: 0, eta: 0, target: null,
    nextTurn: null, turnDistance: 0, stamp: 0, ok: true, debugTarget: null,
  };
  ctx.route = route;
  const city = ctx.world.city;
  const router = createRouter(city);
  const ribbon = createRouteRibbon(ctx.scene);
  const v = ctx.v;
  let key = '';
  let since = 99;
  let turnClock = 99;

  const currentTarget = () => {
    if (route.debugTarget && Number.isFinite(route.debugTarget.x) && Number.isFinite(route.debugTarget.z)) {
      const d = route.debugTarget;
      return { type: d.type || 'debug', id: d.id ?? 'debug', x: d.x, z: d.z, name: d.name || 'Target' };
    }
    try {
      const t = ctx.fares?.target?.();
      return t && Number.isFinite(t.x) && Number.isFinite(t.z) ? t : null;
    } catch {
      return null;
    }
  };

  const clear = () => {
    if (route.points.length) route.points = [];
    route.length = route.remaining = route.total = route.eta = 0;
    route.target = null;
    route.nextTurn = null;
    route.turnDistance = 0;
    route.ok = true;
    ribbon.hide();
  };

  const plan = (tgt, force) => {
    const from = { x: v.x, z: v.z };
    const raw = router.route(from, tgt);
    if (!raw.length) {
      route.points = [];
      route.length = route.remaining = route.total = route.eta = 0;
      route.target = tgt;
      route.ok = false;
      route.nextTurn = null;
      return;
    }
    const pts = withStubs(raw, from, tgt);
    const total = pathLength(pts);
    // periodic re-plans only swap the path when it is clearly better, so the line does not flicker between equal choices
    if (!force && route.ok && route.points.length > 1 && route.target && targetKey(route.target) === targetKey(tgt)) {
      if (total > route.remaining - KEEP_BETTER) return;
    }
    route.points = pts;
    route.total = total;
    route.remaining = route.length = total;
    route.eta = etaFor(total);
    route.target = tgt;
    route.ok = true;
    route.stamp++;
    turnClock = 99;
  };

  const system = {
    update(dt) {
      const tgt = currentTarget();
      if (!tgt) {
        if (key) {
          key = '';
          clear();
        }
        return;
      }
      since += dt;
      const k = targetKey(tgt);
      let force = false;
      if (k !== key) {
        key = k;
        force = true;
      } else if (route.ok && route.points.length > 1) {
        const r = trimRoute(route.points, v.x, v.z); // drops the part already driven
        if (r.off > OFF_ROUTE) force = true;
      }
      if (force || since >= REROUTE_EVERY) {
        since = 0;
        plan(tgt, force);
        route.target = tgt;
      }

      const pts = route.points;
      if (pts.length > 1) {
        route.remaining = route.length = pathLength(pts);
        route.eta = etaFor(route.remaining);
        turnClock += dt;
        if (turnClock > 0.15) {
          turnClock = 0;
          const t = computeNextTurn(pts, v.heading);
          route.nextTurn = t.dir;
          route.turnDistance = t.distance;
        }
        if (route.remaining < ARRIVED) ribbon.hide();
        else ribbon.update(pts, ctx.clock.time);
      } else {
        route.remaining = route.length = 0;
        ribbon.hide();
      }
    },
    dispose() {
      ribbon.dispose();
      route.points = [];
    },
  };
  ctx.addSystem(system);

  ctx.addSnapshot(() => ({
    route: route.target && route.ok && route.points.length > 1
      ? { length: Math.round(route.remaining), eta: Math.round(route.eta), nextTurn: route.nextTurn, turnDistance: Math.round(route.turnDistance) }
      : null,
  }));
}
