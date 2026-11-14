// Snatch was removed with the Hyderabad Hustle rules (docs/HUSTLE_PLAN.md: no snatch / shield / traps).
// These inert exports stay only so older imports keep compiling until their callers drop them: there is never an
// open snatch window, so every caller takes its "no window" branch.

/** Always null: there is no snatch window any more. */
export function snatchInfo() {
  return null;
}

/** No-op (kept for old callers). */
export function recordSnatch() {}

/** Always null: no countdown to show. */
export function useSnatchClock() {
  return null;
}
