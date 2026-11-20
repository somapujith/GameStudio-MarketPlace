// One place for the platform's name and copy, so renaming the hub is a one-line change.
// Owned by H-SHELL.

export const BRAND = {
  name: 'Jalebi Games',
  short: 'Jalebi Games',
  tagline: 'Gully made. Game ready.',
  description: 'Multiplayer games with a Hyderabadi street spirit. Pick your game, bring your people, and go full on.',
  // The first game in the catalogue; used for the default hero and for old links.
  defaultGameId: 'hyderabad-tycoon',
  defaultGameSlug: 'nawabi-raj',
  // Friend codes and room codes keep these shapes (see docs/MARKETPLACE.md).
  friendCodePrefix: 'HYD',
  // Browser chrome colour (<meta name="theme-color">) per resolved hub theme; game screens are always dark.
  // Mirrors --hub-bg of each palette (Jalebi charcoal / light sandstone).
  themeColors: { dark: '#0b0908', light: '#f7f1e6' },
};

export default BRAND;
