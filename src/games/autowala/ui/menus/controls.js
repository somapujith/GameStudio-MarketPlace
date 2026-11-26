// The controls reference shown on the start screen and in the pause menu (OPTIONS > CONTROLS). Mirrors game/input.js.
export const KEYBOARD = [
  { keys: ['W', 'Up'], what: 'Gas' },
  { keys: ['S', 'Down'], what: 'Brake / reverse' },
  { keys: ['A', 'D'], what: 'Steer left / right' },
  { keys: ['Space'], what: 'Handbrake (drift)' },
  { keys: ['Shift'], what: 'Boost' },
  { keys: ['H'], what: 'Horn' },
  { keys: ['E'], what: 'Pick up / drop off / interact' },
  { keys: ['C'], what: 'Change camera' },
  { keys: ['M'], what: 'City map' },
  { keys: ['T'], what: 'Talk' },
  { keys: ['Q'], what: 'Quests' },
  { keys: ['R'], what: 'Radio' },
  { keys: ['Esc', 'P'], what: 'Pause' },
];
export const GAMEPAD = [
  { keys: ['Left stick'], what: 'Steer' },
  { keys: ['RT', 'A'], what: 'Gas' },
  { keys: ['LT', 'B'], what: 'Brake / reverse' },
  { keys: ['LB'], what: 'Handbrake (drift)' },
  { keys: ['RB'], what: 'Boost' },
  { keys: ['X'], what: 'Horn' },
  { keys: ['Y'], what: 'Interact' },
  { keys: ['Start'], what: 'Pause' },
];
export const TOUCH = [
  { keys: ['Wheel'], what: 'Steer: drag the wheel on the left' },
  { keys: ['Pedals'], what: 'Gas and brake on the right' },
  { keys: ['Horn'], what: 'Honk' },
  { keys: ['Drift'], what: 'Handbrake' },
  { keys: ['Boost'], what: 'Boost' },
  { keys: ['E'], what: 'Interact: pick up, drop off, talk' },
  { keys: ['Cam'], what: 'Change camera' },
  { keys: ['Map'], what: 'City map (tap the little map)' },
];
/** The three lines the start screen shows on a touch screen. */
export const START_TOUCH = [
  { who: 'Wheel on the left', what: 'steer' },
  { who: 'Pedals on the right', what: 'gas and brake' },
  { who: 'Buttons', what: 'horn, drift, boost, interact' },
];
/** The few lines the start screen shows (the full list is in the pause menu). */
export const START_KEYS = [
  { keys: ['W', 'A', 'S', 'D'], what: 'Drive' },
  { keys: ['Space'], what: 'Drift' },
  { keys: ['Shift'], what: 'Boost' },
  { keys: ['E'], what: 'Interact' },
  { keys: ['H'], what: 'Horn' },
  { keys: ['M'], what: 'Map' },
  { keys: ['Esc'], what: 'Pause' },
];
