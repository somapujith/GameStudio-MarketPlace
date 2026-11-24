// The game page's "Maps" section: every map of a game that has maps (Nawabi Raj: Charminar Chaos and Andhra Aatalu), as a
// row of wide glass cards with the mini board, names (Telugu with lang="te"), tagline, blurb and three sample places.
import { MapCard } from '@/components/online/MapPicker.jsx';
import { mapIds } from '@/components/online/mapModel.js';
import { Section } from './DetailSections.jsx';
import { hasMaps } from './detailModel.js';

export default function MapsSection({ game, index = 0 }) {
  if (!hasMaps(game)) return null;
  const ids = mapIds();
  return (
    <Section id="gd-maps" title="Maps" eyebrow={typeof game.mapsLine === 'string' && game.mapsLine ? game.mapsLine : `${ids.length} maps`} index={index}>
      <p className="cj-detail-pad cj-detail-fine cj-detail-maps__note">
        The rules and the board are the same on every map: the places, collections, cards, festivals and tokens change. Pick the map when you start a table, or the
        host can switch it in the lobby.
      </p>
      <ul className="cj-row cj-detail-maps" aria-label="Maps">
        {ids.map((id) => (
          <li key={id}>
            <MapCard id={id} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
