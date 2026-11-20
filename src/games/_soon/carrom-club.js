import makeSoon from './make.js';

export default makeSoon({
  id: 'carrom-club',
  name: 'Carrom Club',
  tagline: 'Flick, pocket and clear the board',
  description: 'A pocket-sized carrom board for two or four: line up the strike and sink the queen.',
  category: 'sports',
  players: { min: 2, max: 4 },
  duration: '10-20 min',
  theme: { accent: '#f5b83d', accent2: '#e0792b', bg: '#2b1c10' },
  features: ['Online rooms', 'Pass and play'],
  tags: ['Carrom', 'Flick', 'Classic', 'Online'],
  highlights: [
    { icon: 'target', title: 'Line up the strike', text: 'Aim, flick and sink the queen.' },
    { icon: 'users', title: 'Singles or doubles', text: 'Two or four players around one board.' },
    { icon: 'door', title: 'Online rooms', text: 'Share a code and play together, no download needed.' },
  ],
});
