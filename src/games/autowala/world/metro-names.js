// OWNER: metro agent. The three lines of the Hyderabad Metro and their station names (English + Telugu).
// The names are real stations of the real network, but the game map is a toy (1.4 km a side), so lines run in a different order and
// with fewer stops than the real ones: the names are ILLUSTRATIVE of the real network, a representative subset in the real order.
//
// A line's `pool` is its list of names in travel order. `pins` are the interchange stations, which must carry the same name on both
// lines that meet there. The planner picks the other stops from the gaps between the pins (evenly spread, in order).

export const LINE_COLORS = { red: '#e0262f', blue: '#1f66d1', green: '#14a24b' };

const R = (en, te) => ({ en, te });

export const LINE_NAMES = {
  red: {
    id: 'red',
    name: 'Red Line',
    te: 'ఎరుపు లైన్',
    from: 'Miyapur',
    to: 'LB Nagar',
    // Miyapur .. LB Nagar, the real order
    pool: [
      R('Miyapur', 'మియాపూర్'),
      R('JNTU College', 'జేఎన్‌టీయూ కాలేజ్'),
      R('KPHB Colony', 'కేపీహెచ్‌బీ కాలనీ'),
      R('Kukatpally', 'కూకట్‌పల్లి'),
      R('Balanagar', 'బాలానగర్'),
      R('Moosapet', 'మూసాపేట'),
      R('Bharat Nagar', 'భరత్ నగర్'),
      R('Erragadda', 'ఎర్రగడ్డ'),
      R('ESI Hospital', 'ఈఎస్ఐ హాస్పిటల్'),
      R('SR Nagar', 'ఎస్ఆర్ నగర్'),
      R('Ameerpet', 'అమీర్‌పేట్'),
      R('Punjagutta', 'పంజాగుట్ట'),
      R('Irrum Manzil', 'ఇర్రం మంజిల్'),
      R('Khairatabad', 'ఖైరతాబాద్'),
      R('Lakdi-ka-pul', 'లకడీకాపుల్'),
      R('Assembly', 'అసెంబ్లీ'),
      R('Nampally', 'నాంపల్లి'),
      R('Gandhi Bhavan', 'గాంధీ భవన్'),
      R('Osmania Medical College', 'ఉస్మానియా మెడికల్ కాలేజ్'),
      R('MG Bus Station', 'ఎంజీ బస్ స్టేషన్'),
      R('Malakpet', 'మలక్‌పేట'),
      R('New Market', 'న్యూ మార్కెట్'),
      R('Musarambagh', 'ముసారాంబాగ్'),
      R('Dilsukhnagar', 'దిల్‌సుఖ్‌నగర్'),
      R('Chaitanyapuri', 'చైతన్యపురి'),
      R('Victoria Memorial', 'విక్టోరియా మెమోరియల్'),
      R('LB Nagar', 'ఎల్‌బీ నగర్'),
    ],
    pins: { start: 'Miyapur', end: 'LB Nagar', Ameerpet: 'Ameerpet', 'MG Bus Station': 'MG Bus Station' },
  },
  blue: {
    id: 'blue',
    name: 'Blue Line',
    te: 'నీలం లైన్',
    from: 'Nagole',
    to: 'Raidurg',
    pool: [
      R('Nagole', 'నాగోల్'),
      R('Uppal', 'ఉప్పల్'),
      R('Stadium', 'స్టేడియం'),
      R('NGRI', 'ఎన్‌జీఆర్ఐ'),
      R('Habsiguda', 'హబ్సిగూడ'),
      R('Tarnaka', 'తార్నాక'),
      R('Mettuguda', 'మెట్టుగూడ'),
      R('Secunderabad East', 'సికింద్రాబాద్ ఈస్ట్'),
      R('Parade Grounds', 'పరేడ్ గ్రౌండ్స్'),
      R('Paradise', 'ప్యారడైజ్'),
      R('Rasoolpura', 'రసూల్‌పురా'),
      R('Prakash Nagar', 'ప్రకాష్ నగర్'),
      R('Begumpet', 'బేగంపేట'),
      R('Ameerpet', 'అమీర్‌పేట్'),
      R('Madhura Nagar', 'మధురా నగర్'),
      R('Yusufguda', 'యూసఫ్‌గూడ'),
      R('Jubilee Hills Check Post', 'జూబ్లీ హిల్స్ చెక్ పోస్ట్'),
      R('Peddamma Gudi', 'పెద్దమ్మ గుడి'),
      R('Madhapur', 'మాదాపూర్'),
      R('Durgam Cheruvu', 'దుర్గం చెరువు'),
      R('HITEC City', 'హైటెక్ సిటీ'),
      R('Raidurg', 'రాయదుర్గం'),
    ],
    pins: { start: 'Nagole', end: 'Raidurg', Ameerpet: 'Ameerpet' },
  },
  green: {
    id: 'green',
    name: 'Green Line',
    te: 'ఆకుపచ్చ లైన్',
    from: 'JBS Parade Ground',
    to: 'MG Bus Station',
    pool: [
      R('JBS Parade Ground', 'జేబీఎస్ పరేడ్ గ్రౌండ్'),
      R('Secunderabad West', 'సికింద్రాబాద్ వెస్ట్'),
      R('Gandhi Hospital', 'గాంధీ హాస్పిటల్'),
      R('Musheerabad', 'ముషీరాబాద్'),
      R('RTC X Roads', 'ఆర్టీసీ క్రాస్ రోడ్స్'),
      R('Chikkadpally', 'చిక్కడపల్లి'),
      R('Narayanguda', 'నారాయణగూడ'),
      R('Sultan Bazar', 'సుల్తాన్ బజార్'),
      R('MG Bus Station', 'ఎంజీ బస్ స్టేషన్'),
    ],
    pins: { start: 'JBS Parade Ground', end: 'MG Bus Station', 'MG Bus Station': 'MG Bus Station' },
  },
};

export const LINE_ORDER = ['red', 'blue', 'green'];

/** URL-safe slug of a station name: "Lakdi-ka-pul" -> "lakdi-ka-pul", "MG Bus Station" -> "mg-bus-station". */
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Pick `count` names from `pool` between pool indices (exclusive) `i0` and `i1`, evenly spread and in order.
 * Returns fewer when the gap holds fewer names.
 */
export function pickBetween(pool, i0, i1, count) {
  const avail = [];
  for (let i = i0 + 1; i < i1; i++) avail.push(i);
  if (count <= 0 || !avail.length) return [];
  if (count >= avail.length) return avail.map((i) => pool[i]);
  const out = [];
  for (let k = 0; k < count; k++) out.push(pool[avail[Math.round(((k + 0.5) * avail.length) / count - 0.5)]]);
  return out;
}

/** Index of a station name in a line's pool (or -1). */
export const poolIndex = (lineId, en) => LINE_NAMES[lineId].pool.findIndex((p) => p.en === en);
