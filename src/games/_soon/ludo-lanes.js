import makeSoon from './make.js';

export default makeSoon({
  id: 'ludo-lanes',
  name: 'Ludo Lanes',
  tagline: 'Race four tokens home before your friends',
  description: 'The classic dice race with quick rounds, bold lanes and plenty of friendly sabotage.',
  category: 'board',
  players: { min: 2, max: 4 },
  duration: '15-30 min',
  theme: { accent: '#ff5d73', accent2: '#ffb84d', bg: '#2a1030' },
  features: ['Online rooms', 'Quick rounds'],
  tags: ['Dice race', 'Classic', 'Play with friends', 'Online'],
  highlights: [
    { icon: 'users', title: 'Two to four players', text: 'Race four tokens each around the board against your friends.' },
    { icon: 'dice', title: 'Quick rounds', text: 'Built for a short sitting: roughly fifteen to thirty minutes.' },
    { icon: 'door', title: 'Online rooms', text: 'Share a code and play together, no download needed.' },
  ],
});
