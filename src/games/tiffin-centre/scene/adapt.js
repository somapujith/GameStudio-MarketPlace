// The small pure pieces between the stall's frame loop (index.js) and the shared frame governor (src/platform/gfx/governor.js). No WebGL, no DOM: unit-tested.
import { createCompileHold, minTier } from './quality.js';

/** The frame cap to hand the loop: the tier's own (lite is 30 fps) and the device hint's (battery / data saver: 30), the lower of whichever are set; 0 = uncapped. */
export const combineFpsCap = (tierCap = 0, hintCap = 0) => (tierCap > 0 && hintCap > 0 ? Math.min(tierCap, hintCap) : tierCap > 0 ? tierCap : hintCap > 0 ? hintCap : 0);

/**
 * The tier a session starts on. A player's explicit choice is final (`auto` false). On Auto the shared layer's choice (remembered result > calibration > GPU class) is
 * limited by the capability gate's own ceiling (phones, Safari, no float render targets: capabilities.chooseTier), so neither can be overridden by the other.
 */
export function startTier({ auto, initial, ceiling }) {
  return auto ? minTier(initial, ceiling) : ceiling;
}

/**
 * Is a start-up calibration result complete enough to move the start tier? An INCOMPLETE run (a test never got a slice: a busy machine, no timer queries; cancelled; or
 * flagged not confident) fills the units it could not measure with pessimistic sentinels (25 ns / pixel, 60 us / call): taken as a verdict it put a good laptop on `low`
 * (and, through tier memory, kept it there). Such a run says nothing: the GPU class decides the start and the governor corrects it from real frames.
 */
export function usableCalibration(cal) {
  if (!cal || cal.ok === false || cal.cancelled) return false;
  if (cal.partial || (cal.missing && cal.missing.length)) return false;
  if (!cal.units || !cal.recommended || cal.recommended.confident === false) return false;
  return true;
}

/**
 * What stands between the loop and the governor. A frame that is a compile stall (a shader program appeared within the last 0.6 s and the frame itself took more than
 * three budgets) says nothing about what the device can render: it is not shown to the governor, the normal frames in between still are. Everything else passes through.
 * `gov` needs frame(dtMs, cpuMs, calls, gpuMs), discontinuity(ms) and budgetMs; `programs()` returns the number of compiled programs now. Returns { frame, discontinuity, stalls }.
 */
export function createGovernorFeed(gov, programs, { none = 0, paused = () => false } = {}) {
  const hold = createCompileHold();
  let stalls = 0;
  return {
    frame(dtMs, cpuMs, calls, gpuMs) {
      if (paused()) return none; // a tier switch is compiling behind a held frame: frames that draw nothing are not evidence about the load
      if (hold.push(programs(), dtMs / 1000) && dtMs > 3 * gov.budgetMs) {
        stalls++;
        return none;
      }
      return gov.frame(dtMs, cpuMs, calls, gpuMs);
    },
    discontinuity: (ms) => gov.discontinuity?.(ms),
    /** How many frames were kept from the governor as compile stalls. */
    get stalls() {
      return stalls;
    },
  };
}
