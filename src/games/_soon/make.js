// Builds a coming-soon teaser manifest. These are placeholders the owner can rename or delete: only
// id, name, tagline, category, status, players, duration, theme and art are required by the registry.
// The rest is optional store-listing copy (docs/STOREFRONT_REDESIGN.md section 6): the game page hides what is missing.
// Teasers promise only what the description already says, and never carry ratings, counts or release dates.
import { createElement } from 'react';
import { ComingSoonCover, ComingSoonIcon } from '@/platform/game/hubArt.jsx';

export default function makeSoon({ id, name, tagline, description, category, players, duration, theme, features = [], tags = [], highlights = [], gallery }) {
  return {
    id,
    name,
    tagline,
    description,
    category,
    status: 'coming_soon',
    players,
    duration,
    theme,
    features,
    publisher: 'Jalebi Games',
    tags,
    highlights,
    gallery: gallery || [
      { kind: 'cover', caption: 'Cover art' },
      { kind: 'scene', focus: 'right', caption: 'A closer look at the cover' },
    ],
    modes: { friends: false, open: false },
    art: {
      cover: (props) => createElement(ComingSoonCover, { id, ...props }),
      icon: (props) => createElement(ComingSoonIcon, { id, rounded: true, ...props }),
    },
  };
}
