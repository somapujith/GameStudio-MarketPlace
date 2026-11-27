import { describe, it, expect } from 'vitest';
import {
  formatClock, dayPhase, fuelTone, fuelSegments, speedFraction, speedFx, groupIndian, formatRupees, formatDistance, formatEta,
  formatCountdown, easeCount, kindInfo, turnDirection, normalizeTrip, moodColor, timerTone, promptAction, driftTier, rageView, crashFlash,
  rulesView, careerView, fareMultiplier, weatherView, SIGNAL_SHOW_M, touchPromptText,
} from './hudLogic.js';

describe('formatClock (12-hour, AM/PM)', () => {
  it('midnight and noon', () => {
    expect(formatClock(0).label).toBe('12:00 AM');
    expect(formatClock(12).label).toBe('12:00 PM');
    expect(formatClock(24).label).toBe('12:00 AM');
    expect(formatClock(12.5).label).toBe('12:30 PM');
    expect(formatClock(0.25).label).toBe('12:15 AM');
  });
  it('morning, afternoon and the last minute of the day', () => {
    expect(formatClock(1).label).toBe('1:00 AM');
    expect(formatClock(9.75).label).toBe('9:45 AM');
    expect(formatClock(13).label).toBe('1:00 PM');
    expect(formatClock(17.4).label).toBe('5:24 PM');
    expect(formatClock(23.999).label).toBe('11:59 PM');
    expect(formatClock(23.9999999).label).toBe('11:59 PM');
  });
  it('never shows 60 minutes and wraps / survives bad input', () => {
    expect(formatClock(6.9999).mm).toBe('59');
    expect(formatClock(30).label).toBe('6:00 AM');
    expect(formatClock(-1).label).toBe('11:00 PM');
    expect(formatClock(NaN).label).toBe('12:00 AM');
    expect(formatClock(undefined).ampm).toBe('AM');
    expect(formatClock(5.5)).toMatchObject({ h12: 5, minutes: 30, time: '5:30', ampm: 'AM' });
  });
});

describe('dayPhase', () => {
  it('splits the day', () => {
    expect(dayPhase(6)).toBe('dawn');
    expect(dayPhase(12)).toBe('day');
    expect(dayPhase(17.4)).toBe('dusk');
    expect(dayPhase(21)).toBe('night');
    expect(dayPhase(2)).toBe('night');
    expect(dayPhase(24)).toBe('night');
  });
});

describe('fuel gauge', () => {
  it('colours by threshold', () => {
    expect(fuelTone(1).tone).toBe('ok');
    expect(fuelTone(0.35).tone).toBe('ok');
    expect(fuelTone(0.34).tone).toBe('warn');
    expect(fuelTone(0.15).tone).toBe('warn');
    expect(fuelTone(0.149).tone).toBe('low');
    expect(fuelTone(0.149).pulse).toBe(true);
    expect(fuelTone(0.02).tone).toBe('empty');
    expect(fuelTone(0).pulse).toBe(true);
    expect(fuelTone(0.5).pulse).toBe(false);
  });
  it('clamps and defaults', () => {
    expect(fuelTone(-3).tone).toBe('empty');
    expect(fuelTone(7).tone).toBe('ok');
    expect(fuelTone(undefined).tone).toBe('ok');
    expect(fuelTone(NaN).tone).toBe('ok');
  });
  it('lights segments, never zero while fuel remains', () => {
    expect(fuelSegments(1)).toBe(10);
    expect(fuelSegments(0.5)).toBe(5);
    expect(fuelSegments(0.01)).toBe(1);
    expect(fuelSegments(0)).toBe(0);
    expect(fuelSegments(0.91)).toBe(10);
  });
});

describe('speed dial and effects', () => {
  it('fraction is clamped', () => {
    expect(speedFraction(0)).toBe(0);
    expect(speedFraction(60)).toBe(0.5);
    expect(speedFraction(500)).toBe(1);
    expect(speedFraction(-5)).toBe(0);
    expect(speedFraction(NaN)).toBe(0);
  });
  it('effects grow with speed and boost', () => {
    expect(speedFx(0)).toEqual({ vignette: 0, lines: 0 });
    const a = speedFx(60);
    const b = speedFx(100);
    expect(b.vignette).toBeGreaterThan(a.vignette);
    expect(b.lines).toBeGreaterThan(a.lines);
    expect(speedFx(20, true).lines).toBeGreaterThan(speedFx(20, false).lines);
    const max = speedFx(400, true);
    expect(max.vignette).toBeLessThanOrEqual(1);
    expect(max.lines).toBeLessThanOrEqual(1);
  });
});

describe('number formats', () => {
  it('groups the Indian way', () => {
    expect(groupIndian(0)).toBe('0');
    expect(groupIndian(999)).toBe('999');
    expect(groupIndian(1000)).toBe('1,000');
    expect(groupIndian(123456)).toBe('1,23,456');
    expect(groupIndian(12345678)).toBe('1,23,45,678');
    expect(groupIndian(-45000)).toBe('-45,000');
    expect(groupIndian(NaN)).toBe('0');
    expect(formatRupees(1240)).toBe('Rs 1,240');
  });
  it('distance, eta and countdown', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(38)).toBe('40 m');
    expect(formatDistance(420)).toBe('420 m');
    expect(formatDistance(1480)).toBe('1.5 km');
    expect(formatDistance(12000)).toBe('12 km');
    expect(formatDistance(undefined)).toBe('0 m');
    expect(formatEta(10)).toBe('< 1 min');
    expect(formatEta(240)).toBe('4 min');
    expect(formatEta(3900)).toBe('1 h 05');
    expect(formatCountdown(42)).toBe('0:42');
    expect(formatCountdown(61.2)).toBe('1:02');
    expect(formatCountdown(-4)).toBe('0:00');
  });
  it('easeCount approaches and snaps', () => {
    let v = 0;
    for (let i = 0; i < 4; i++) v = easeCount(v, 100, 1 / 60);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
    for (let i = 0; i < 300; i++) v = easeCount(v, 100, 1 / 60);
    expect(v).toBe(100);
    expect(easeCount(100, 40, 0.5)).toBeLessThan(100);
    expect(easeCount(NaN, 7, 0.1)).toBe(7);
    expect(easeCount(5, 5.3, 0.1)).toBe(5.3);
  });
});

describe('trip normalisation', () => {
  it('returns null without a trip and never throws on junk', () => {
    expect(normalizeTrip(null, null)).toBeNull();
    expect(normalizeTrip(undefined)).toBeNull();
    expect(normalizeTrip('x')).toBeNull();
    const t = normalizeTrip({}, 5);
    expect(t.name).toBe('Passenger');
    expect(t.fare).toBe(0);
    expect(t.distance).toBeNull();
    expect(t.mood).toBeNull();
    expect(t.timeLeft).toBeNull();
    expect(t.turn).toBeNull();
  });
  it('maps the trip and route', () => {
    const t = normalizeTrip(
      { name: 'Salma Aapa', te: 'సల్మా ఆపా', kind: 'family', dest: { name: 'Charminar', te: 'చార్మినార్' }, fareNow: 83.6, distanceLeft: 900, timeLeft: 42, timeTotal: 120, mood: 1.4, pax: 2 },
      { length: 1480, eta: 260, nextTurn: 'left', turnDistance: 120 },
    );
    expect(t).toMatchObject({ name: 'Salma Aapa', te: 'సల్మా ఆపా', destName: 'Charminar', fare: 84, distance: 1480, eta: 260, mood: 1, timeLeft: 42, timeFrac: 0.35, pax: 2 });
    expect(t.kind).toEqual({ key: 'family', label: 'Family' });
    expect(t.turn).toEqual({ dir: 'left', text: 'Turn left', distance: 120 });
  });
  it('falls back to the trip distance when the route is absent', () => {
    expect(normalizeTrip({ distanceLeft: 640, fareNow: 20 }).distance).toBe(640);
    expect(normalizeTrip({ distanceLeft: 640 }, { length: 300 }).distance).toBe(300);
    expect(normalizeTrip({ fareEstimate: 90 }).fare).toBe(90);
  });
  it('kinds, turns, tones', () => {
    expect(kindInfo('mystery-guest')).toEqual({ key: 'generic', label: 'Mystery guest' });
    expect(kindInfo(null).label).toBe('Passenger');
    expect(turnDirection('slight-left')).toBe('left');
    expect(turnDirection({ dir: 'right' })).toBe('right');
    expect(turnDirection('u-turn')).toBe('uturn');
    expect(turnDirection('arrive')).toBe('arrive');
    expect(turnDirection(0.1)).toBe('straight');
    expect(turnDirection(-1)).toBe('left');
    expect(turnDirection(1)).toBe('right');
    expect(turnDirection(undefined)).toBeNull();
    expect(turnDirection('???')).toBeNull();
    expect(moodColor(0.1)).toBe('#ff4d5e');
    expect(moodColor(0.4)).toBe('#ffc857');
    expect(moodColor(0.9)).toBe('#a6ff3d');
    expect(timerTone(5)).toBe('urgent');
    expect(timerTone(20)).toBe('warn');
    expect(timerTone(90)).toBe('calm');
    expect(timerTone(null)).toBe('calm');
  });
});

describe('road rage and crash flashes', () => {
  it('rage view is null unless active, and clamps everything', () => {
    expect(rageView(undefined)).toBeNull();
    expect(rageView({ active: false, heat: 1 })).toBeNull();
    expect(rageView({ active: true, heat: 3, escape: -1, caughtIn: 0.7, chasers: 2.6 })).toEqual({ heat: 1, escape: 0, caught: 0.7, chasers: 3, danger: true });
    expect(rageView({ active: true })).toEqual({ heat: 0, escape: 0, caught: 0, chasers: 0, danger: false });
    expect(rageView({ active: true, heat: 'x', caughtIn: NaN }).heat).toBe(0);
  });
  it('kerb and lake scrapes are soft, real crashes are not', () => {
    expect(crashFlash({ tag: 'kerb', strength: 0.8 }).soft).toBe(true);
    expect(crashFlash({ tag: 'building', strength: 0.5, guard: true }).soft).toBe(true); // a guardrail contact
    expect(crashFlash({ tag: 'lake' }).soft).toBe(true);
    expect(crashFlash({ tag: 'building', strength: 0.9 }).soft).toBe(false);
    expect(crashFlash({ tag: 'landmark' }).soft).toBe(false);
    expect(crashFlash({ tag: 'traffic' }).soft).toBe(false);
    expect(crashFlash({}).soft).toBe(false);
    expect(crashFlash(undefined).soft).toBe(false);
  });
  it('strength is bounded for the flash', () => {
    expect(crashFlash({ strength: 5 }).strength).toBe(1);
    expect(crashFlash({ strength: 0.01 }).strength).toBe(0.25);
    expect(crashFlash({ strength: 'x' }).strength).toBe(0.4);
  });
});

describe('prompt and drift', () => {
  it('maps prompt keys to input actions', () => {
    expect(promptAction('E')).toBe('interact');
    expect(promptAction('t')).toBe('talk');
    expect(promptAction(undefined)).toBe('interact');
    expect(promptAction('Z')).toBeNull();
  });
  it('drift tiers', () => {
    expect(driftTier(0).tier).toBe(0);
    expect(driftTier(0.4).label).toBe('NICE');
    expect(driftTier(0.7).label).toBe('GREAT');
    expect(driftTier(1).label).toBe('MAX');
    expect(driftTier(NaN).c).toBe(0);
  });
});

describe('crashFlash ignores guardrail contacts', () => {
  it('guard: true is always soft, whatever the tag', () => {
    expect(crashFlash({ tag: 'building', strength: 1, guard: true }).soft).toBe(true);
    expect(crashFlash({ tag: 'prop', strength: 0.9, guard: true }).soft).toBe(true);
  });
  it('a real crash (traffic, no guard) is not soft', () => {
    expect(crashFlash({ tag: 'traffic', strength: 0.8 }).soft).toBe(false);
    expect(crashFlash({ tag: 'kerb', strength: 0.8 }).soft).toBe(true);
    expect(crashFlash(undefined)).toEqual({ soft: false, strength: 0.4 });
  });
});

describe('rulesView (snap.rules)', () => {
  const base = { limit: 40, zone: 'city', speeding: false, heat: 0.2, wanted: false, fines: 0, lastFine: null, signalAhead: null, cameraAhead: null, checkpoint: null };
  it('is null without rules and never throws on junk', () => {
    expect(rulesView(null)).toBeNull();
    expect(rulesView('x')).toBeNull();
    const v = rulesView({ limit: 'abc', signalAhead: 5, cameraAhead: [], checkpoint: 'x' });
    expect(v.sign).toBeNull();
    expect(v.signal).toBeNull();
    expect(v.checkpoint).toBeNull();
  });
  it('the limit sign carries the zone and the speeding flag', () => {
    const v = rulesView({ ...base, zone: 'school', limit: 20, speeding: true });
    expect(v.sign).toMatchObject({ limit: 20, zone: 'school', speeding: true, zoneEn: 'School zone' });
    expect(rulesView({ ...base, zone: 'weird' }).sign.zone).toBe('city');
  });
  it('a signal ahead: state, rounded-up countdown, distance, and it hides when far away or unknown', () => {
    const v = rulesView({ ...base, signalAhead: { state: 'red', dist: 62, left: 7.1, watched: true } });
    expect(v.signal).toMatchObject({ state: 'red', dist: 62, secs: 8, watched: true, en: 'STOP' });
    expect(rulesView({ ...base, signalAhead: { state: 'green', dist: 40, left: 0, watched: false } }).signal.te).toBeTruthy();
    expect(rulesView({ ...base, signalAhead: { state: 'red', dist: SIGNAL_SHOW_M + 1, left: 3 } }).signal).toBeNull();
    expect(rulesView({ ...base, signalAhead: { state: 'purple', dist: 10, left: 3 } }).signal).toBeNull();
  });
  it('a camera only turns red above its limit plus the 5 km/h tolerance', () => {
    const r = { ...base, cameraAhead: { dist: 180, limit: 40 } };
    expect(rulesView(r, 44).camera).toEqual({ dist: 180, limit: 40, over: false });
    expect(rulesView(r, 46).camera.over).toBe(true);
    expect(rulesView(base, 90).camera).toBeNull();
  });
  it('police check phases', () => {
    expect(rulesView({ ...base, checkpoint: { phase: 'near', dist: 31.4 } }).checkpoint).toMatchObject({ phase: 'near', dist: 31 });
    expect(rulesView({ ...base, checkpoint: { phase: 'checking', dist: 2 } }).checkpoint.en).toMatch(/checking/i);
    expect(rulesView({ ...base, checkpoint: { phase: 'idle', dist: 2 } }).checkpoint).toBeNull();
  });
  it('wanted, heat and fines are cleaned', () => {
    const v = rulesView({ ...base, wanted: true, heat: 3, fines: 2.6 });
    expect(v).toMatchObject({ wanted: true, heat: 1, fines: 3 });
  });
});

describe('fareMultiplier (the capped fare multiplier, not the raw demand)', () => {
  it('matches 1 + (demand - 1) * 0.4, capped at 1.3', () => {
    expect(fareMultiplier(1)).toBe(1);
    expect(fareMultiplier(1.5)).toBeCloseTo(1.2, 5);
    expect(fareMultiplier({ mult: 1.7 })).toBeCloseTo(1.28, 5);
    expect(fareMultiplier(2.5)).toBe(1.3);
    expect(fareMultiplier({ mult: 3 })).toBe(1.3);
  });
  it('a lull is below 1 (the chip hides it) and junk is 1', () => {
    expect(fareMultiplier(0.2)).toBeCloseTo(0.68, 5);
    expect(fareMultiplier(undefined)).toBe(1);
    expect(fareMultiplier('abc')).toBe(1);
  });
});

describe('careerView (snap.career)', () => {
  const career = {
    damage: 0.35, repairCost: 130, fatigue: 0.75, fatigueName: { en: 'Tired', te: 'అలసట' },
    chai: { price: 15, cooldown: 0, canBuy: true }, demand: { mult: 1.7, label: 'Evening rush', te: 'సాయంత్రం రష్', peak: true },
    today: { earned: 840.4 }, rent: { due: 120, owned: false, debt: 0 },
  };
  it('is null without career', () => {
    expect(careerView(undefined)).toBeNull();
    expect(careerView(7)).toBeNull();
  });
  it('bars, tones, chai and the capped demand', () => {
    const v = careerView(career);
    expect(v.damage).toMatchObject({ pct: 35, show: true, repair: 130 });
    expect(v.fatigue).toMatchObject({ pct: 75, tone: 'warn', name: 'Tired' });
    expect(v.chai).toMatchObject({ price: 15, canBuy: true, urgent: true, cooldown: 0 });
    expect(v.demand).toMatchObject({ label: 'Evening rush', mult: 1.28, show: true, peak: true });
    expect(v.earned).toBe(840);
    expect(v.rent).toMatchObject({ due: 120, owned: false });
  });
  it('a quiet hour shows no multiplier; no damage hides the dent bar; cooldown rounds up', () => {
    const v = careerView({ ...career, damage: 0, demand: { mult: 1.0, label: 'Lunch hour' }, chai: { price: 15, cooldown: 12.2, canBuy: false } });
    expect(v.demand.show).toBe(false);
    expect(v.damage.show).toBe(false);
    expect(v.chai).toMatchObject({ cooldown: 13, canBuy: false });
  });
  it('survives an empty object', () => {
    const v = careerView({});
    expect(v.damage.pct).toBe(0);
    expect(v.earned).toBe(0);
    expect(v.chai.canBuy).toBe(false);
  });
});

describe('weatherView (snap.weather)', () => {
  it('hides in clear, dry weather and while it is only cloudy', () => {
    expect(weatherView(undefined)).toBeNull();
    expect(weatherView({ state: 'clear', wet: 0 })).toBeNull();
    expect(weatherView({ state: 'cloudy', wet: 0.01, rain: 0 })).toBeNull();
  });
  it('rain and storm show their name, Telugu and the soak', () => {
    const v = weatherView({ state: 'rain', rain: 0.6, wet: 0.45 });
    expect(v).toMatchObject({ state: 'rain', en: 'Rain', wetPct: 45, showName: true });
    expect(v.te).toBeTruthy();
    expect(weatherView({ state: 'storm', wet: 2 }).wetPct).toBe(100);
  });
  it('after the rain you are still wet for a while', () => {
    const v = weatherView({ state: 'clear', wet: 0.3, rain: 0 });
    expect(v).toMatchObject({ state: 'clear', en: 'Drying off', showName: false, wetPct: 30 });
  });
});

describe('touchPromptText', () => {
  it('turns "Press E to ..." into "Tap to ..." and leaves other prompts alone', () => {
    expect(touchPromptText("Press E to enter Mama's Garage")).toBe("Tap to enter Mama's Garage");
    expect(touchPromptText('press e to talk')).toBe('Tap to talk');
    expect(touchPromptText('Hold Space to drift')).toBe('Tap to drift');
    expect(touchPromptText('Pick up Salma Aapa')).toBe('Pick up Salma Aapa');
    expect(touchPromptText(null)).toBe('');
  });
});
