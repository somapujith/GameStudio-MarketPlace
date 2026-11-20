// The words of the ACTIVE map for the game screens: the chai token and the corners, the card decks, the place name.
//
// shared/maps.js `applyMap` rewrites the tile and collection names the board shows; the words that live in sentences (the
// log, the deed sheet, the rules, the tour) read them from here, at the moment they are built, so they follow the table's map:
// Hyderabad Hustle says "chai token" / "Chai Adda", Andhra Aatalu says "festival token" / "Sankranti Fair".
// The default map returns exactly the old words, so every Hyderabad string stays byte for byte the same.
import { DEFAULT_MAP, activeMapId, deckName, mapIdOf, termsOf } from '@shared/maps.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The words of a map (a map id, a cfg or a state; the active client map when omitted). */
export function wordsOf(x = activeMapId()) {
  const id = mapIdOf(x);
  const t = termsOf(id);
  return {
    id,
    isDefault: id === DEFAULT_MAP,
    chai: t.chai, // "chai" | "festival token" (the object of "use ...")
    chaiToken: t.chaiToken,
    chaiTokens: t.chaiTokens,
    ChaiToken: cap(t.chaiToken),
    chaiCorner: t.chaiCorner,
    trafficCorner: t.trafficCorner,
    municipalCorner: t.municipalCorner,
    auctionTile: t.auctionTile,
    startCorner: t.startCorner,
    transportStops: t.transportStops,
    place: t.place || 'Hyderabad',
    luck: deckName(id, 'luck'),
    drama: deckName(id, 'drama'),
  };
}
