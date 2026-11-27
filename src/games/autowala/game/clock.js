// The game clock. `time` is wall-clock play time (animations, cooldowns, the sitting's length) and always runs. The calendar (`hour`, `day`)
// and `sim` (the time the world's own schedules use: metro trains, shader time) stand still while a menu is open: rent, rain, events,
// signals and the "beat the train" mission must not run behind the Start screen, the pause menu, the workshop or the job board.
export function advanceClock(clock, dt, frozen, secondsPerHour) {
  clock.time += dt;
  if (frozen) return;
  clock.sim += dt;
  clock.hour += dt / secondsPerHour;
  while (clock.hour >= 24) {
    clock.hour -= 24;
    clock.day++;
  }
}
