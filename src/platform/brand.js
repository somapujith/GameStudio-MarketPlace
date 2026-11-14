// One place for the platform's name and copy, so renaming the hub is a one-line change.
// Owned by H-SHELL.

export const BRAND = {
  name: 'GameHub',
  short: 'GameHub',
  tagline: 'Play together. Anywhere.',
  description: 'A little marketplace of multiplayer games. Pick a game, grab your friends, and play in seconds.',
  // The first game in the catalogue; used for the default hero and for old links.
  defaultGameId: 'hyderabad-tycoon',
  // Friend codes and room codes keep these shapes (see docs/MARKETPLACE.md).
  friendCodePrefix: 'HYD',
  // Browser chrome colour (<meta name="theme-color">) per resolved hub theme; game screens are always dark.
  // Mirrors --hub-bg of each palette (dark navy / light sandstone).
  themeColors: { dark: '#0a0f1f', light: '#f7f1e6' },
};

export default BRAND;
