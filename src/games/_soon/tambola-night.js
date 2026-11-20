import makeSoon from './make.js';

export default makeSoon({
  id: 'tambola-night',
  name: 'Tambola Night',
  tagline: 'Call the numbers and shout Housie',
  description: 'Housie for the whole group chat: tickets, numbers, and a lot of noise at the end.',
  category: 'social',
  players: { min: 2, max: 20 },
  duration: '20-30 min',
  theme: { accent: '#4cc9f0', accent2: '#7b6dff', bg: '#101c3d' },
  features: ['Big groups', 'Online rooms'],
  tags: ['Housie', 'Big groups', 'Party', 'Online'],
  highlights: [
    { icon: 'users', title: 'Big groups', text: 'Up to twenty players in one room, built for the family group chat.' },
    { icon: 'sparkle', title: 'Tickets and numbers', text: 'Numbers are called, tickets fill up, and the first to shout wins.' },
    { icon: 'door', title: 'Online rooms', text: 'Share a code and play together, no download needed.' },
  ],
});
