// The chips under the trip panel: the ride's facts as plain data (pure, unit-tested). Rendered by FareChoice.jsx.
/** The ride's facts as chips: [{ key, tone, en, te? }]. Pure (no React), so it is easy to test. */
export function rideChips(trip) {
  if (!trip) return [];
  const out = [];
  const terms = trip.terms;
  if (terms?.mode === 'meter') out.push({ key: 'terms', tone: 'good', en: 'Meter', te: 'మీటర్' });
  else if (terms?.mode === 'fixed') out.push({ key: 'terms', tone: 'gold', en: `Fixed Rs ${terms.fixedFare}`, te: 'ఫిక్స్డ్' });
  for (const m of trip.modifiers || []) out.push({ key: m.id, tone: 'info', en: m.mul ? `${m.label} x${m.mul.toFixed(2).replace(/0$/, '')}` : `${m.label} +Rs ${m.flat}`, te: m.te });
  if (trip.urgent) out.push({ key: 'urgent', tone: 'bad', en: trip.urgent.en, te: trip.urgent.te });
  if (trip.shared) out.push({ key: 'shared', tone: 'violet', en: `Sharing with ${trip.shared.mate.name} to ${trip.shared.mateDest.name}`, te: trip.shared.mate.te });
  return out;
}
