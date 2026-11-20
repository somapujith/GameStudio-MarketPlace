import makeSoon from './make.js';

export default makeSoon({
  id: 'word-rush',
  name: 'Word Rush',
  tagline: 'Spell fast and outsmart your friends',
  description: 'Race the clock to build words from a shared set of letters. Longer words, bigger points.',
  category: 'word',
  players: { min: 2, max: 6 },
  duration: '5-10 min',
  theme: { accent: '#3ddc97', accent2: '#35d0ff', bg: '#0e2a2a' },
  features: ['Fast rounds', 'Online rooms'],
  tags: ['Words', 'Fast rounds', 'Letters', 'Online'],
  highlights: [
    { icon: 'bolt', title: 'Beat the clock', text: 'Short rounds of five to ten minutes.' },
    { icon: 'book', title: 'Shared letters', text: 'Build words from the same set as everyone else; longer words score more.' },
    { icon: 'door', title: 'Online rooms', text: 'Share a code and play together, no download needed.' },
  ],
});
