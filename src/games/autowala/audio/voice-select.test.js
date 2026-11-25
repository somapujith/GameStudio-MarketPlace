import { describe, expect, it } from 'vitest';
import { LINES, KINDS } from './voiceLines.js';
import { COOLDOWNS, createPicker, createScheduler, genderHint, personaForKind, priorityOf, HAIL_PERSONAS } from './voice-select.js';

const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('persona mapping', () => {
  it('maps every customer kind to a persona that has hail lines for it', () => {
    for (const kind of KINDS) {
      for (const r of [0, 0.3, 0.6, 0.99]) {
        for (const name of ['', 'Lakshmi Amma', 'Ramaiah Thatha', 'Salma Aapa', 'Ravi Anna']) {
          const p = personaForKind(kind, name, () => r);
          expect(HAIL_PERSONAS[kind], `${kind}/${name}/${r}`).toContain(p);
        }
      }
    }
  });

  it('uses name hints and the fixed kinds', () => {
    expect(genderHint('Lakshmi Amma')).toBe('f');
    expect(genderHint('Ramaiah Thatha')).toBe('m');
    expect(genderHint('Kiran')).toBe(null);
    expect(personaForKind('elder', 'Lakshmi Amma')).toBe('elder_woman');
    expect(personaForKind('elder', 'Ramaiah Thatha')).toBe('elder_man');
    expect(personaForKind('rusher', 'x')).toBe('man_rusher');
    expect(personaForKind('tourist')).toBe('tourist');
    expect(personaForKind('student')).toBe('student');
    expect(personaForKind('regular', 'Salma Aapa')).toBe('woman_mid');
    expect(personaForKind('regular', 'Ravi Anna')).toBe('man_rusher');
    expect(['woman_young', 'woman_mid']).toContain(personaForKind('women', 'Anita', () => 0.1));
    expect(personaForKind('women', 'Padma Aunty')).toBe('woman_mid');
    expect(personaForKind('???')).toMatch(/woman_mid|man_rusher/); // unknown kinds fall back to regular
  });
});

describe('line picker', () => {
  it('only returns lines of the requested category / persona / kind', () => {
    const p = createPicker({ rng: Math.random });
    for (let i = 0; i < 40; i++) {
      p.reset();
      const l = p.pick({ category: 'hail', persona: 'elder_man', kind: 'elder' }, 1e6 + i * 1e5);
      expect(l.category).toBe('hail');
      expect(l.persona).toBe('elder_man');
      expect(l.kind).toBe('elder');
    }
    expect(createPicker().pick({ category: 'hail', persona: 'man_rusher', kind: 'tourist' }, 1e6)).toBeNull();
  });

  it('never repeats any of the last 3 lines', () => {
    const p = createPicker({ rng: Math.random });
    let t = 1e6;
    const got = [];
    for (let i = 0; i < 60; i++) {
      t += 20000;
      const l = p.pick({ category: 'chatter' }, t); // any persona: 13 lines
      expect(l).toBeTruthy();
      const lastThree = got.slice(-3);
      expect(lastThree, `pick ${i}`).not.toContain(l.id);
      got.push(l.id);
      p.commit(l, t);
    }
    expect(new Set(got).size).toBeGreaterThan(8);
  });

  it('with only 2 candidates it still answers, least recently used first', () => {
    const p = createPicker({ rng: () => 0 });
    let t = 1e6;
    const a = p.pick({ category: 'hero_first_fare', persona: 'mega_hero' }, t);
    p.commit(a, t);
    t += 20000;
    const b = p.pick({ category: 'hero_first_fare', persona: 'mega_hero' }, t);
    expect(b.id).not.toBe(a.id);
    p.commit(b, t);
    t += 20000;
    expect(p.pick({ category: 'hero_first_fare', persona: 'mega_hero' }, t).id).toBe(a.id);
  });

  it('keeps a per-persona cooldown, a global passenger cooldown and a hero cooldown', () => {
    const p = createPicker({ rng: () => 0.5 });
    const t0 = 1e6;
    const first = p.pick({ category: 'thanks', persona: 'woman_mid' }, t0);
    p.commit(first, t0);
    // same persona, too soon
    expect(p.pick({ category: 'chatter', persona: 'woman_mid' }, t0 + 2000)).toBeNull();
    // a different persona is held by the (shorter) global gap, then free
    expect(p.pick({ category: 'chatter', persona: 'elder_man' }, t0 + COOLDOWNS.passengerGlobalMs - 100)).toBeNull();
    expect(p.pick({ category: 'chatter', persona: 'elder_man' }, t0 + COOLDOWNS.passengerGlobalMs + 100)).toBeTruthy();
    // the same persona is free after its gap
    expect(p.pick({ category: 'chatter', persona: 'woman_mid' }, t0 + COOLDOWNS.personaMs + 100)).toBeTruthy();
    // a crash reaction may come soon after, and `force` bypasses cooldowns
    expect(p.pick({ category: 'complaint_crash', persona: 'woman_mid' }, t0 + COOLDOWNS.personaCrashMs + 50)).toBeTruthy();
    expect(p.pick({ category: 'chatter', persona: 'woman_mid', force: true }, t0 + 10)).toBeTruthy();

    const h = p.pick({ category: 'hero_drift', persona: 'mega_hero' }, t0);
    p.commit(h, t0);
    expect(p.pick({ category: 'hero_jump', persona: 'mega_hero' }, t0 + 3000)).toBeNull();
    expect(p.pick({ category: 'hero_jump', persona: 'mega_hero' }, t0 + COOLDOWNS.heroGlobalMs + 10)).toBeTruthy();
    // a hero line does not block a passenger line (different cooldown lane)
    expect(p.pick({ category: 'chatter', persona: 'student' }, t0 + 5000)).toBeTruthy();
  });

  it('prefers a destination line when the trip has one, else a generic boarding line', () => {
    const p = createPicker({ rng: () => 0.1 });
    expect(p.pick({ category: 'boarding', persona: 'man_rusher', dest: 'charminar' }, 1e6).dest).toBe('charminar');
    const generic = createPicker({ rng: () => 0.1 }).pick({ category: 'boarding', persona: 'elder_man', dest: 'charminar' }, 1e6);
    expect(generic.dest).toBeUndefined();
    const noDest = createPicker({ rng: () => 0.99 }).pick({ category: 'boarding', persona: 'man_rusher', dest: 'charminar' }, 1e6);
    expect(noDest.dest).toBeUndefined(); // 25% of the time the generic line
  });

  it('honours weights', () => {
    const lines = [
      { id: 'a', persona: 'student', category: 'chatter', weight: 1, te: 'అ', roman: 'a', en: 'a' },
      { id: 'b', persona: 'student', category: 'chatter', weight: 9, te: 'అ', roman: 'a', en: 'a' },
    ];
    expect(createPicker({ lines, rng: seq(0.05) }).pick({ category: 'chatter' }, 1e6).id).toBe('a');
    expect(createPicker({ lines, rng: seq(0.5) }).pick({ category: 'chatter' }, 1e6).id).toBe('b');
  });
});

describe('scheduler (one voice at a time)', () => {
  const item = (id, persona, category, ms = 1500, extra = {}) => {
    const line = LINES.find((l) => l.id === id) || { id, persona, category };
    return { line, priority: priorityOf(line), ms, ...extra };
  };

  it('plays at once when idle, queues while busy, then plays the queue in priority order', () => {
    const s = createScheduler();
    const chat = item('chat_w1', 'woman_mid', 'chatter');
    const thanks = item('thx_w1', 'woman_mid', 'thanks');
    const hail = item('hail_reg_m1', 'man_rusher', 'hail');
    expect(s.submit(chat, 0).action).toBe('play');
    expect(s.submit(hail, 100).action).toBe('queued');
    expect(s.submit(thanks, 200).action).toBe('queued');
    expect(s.tick(500)).toBeNull(); // still talking
    expect(s.tick(chat.ms + 400)?.line.id).toBe('thx_w1'); // thanks (3) before hail (2)
    expect(s.tick(chat.ms + 400 + 1900)?.line.id).toBe('hail_reg_m1');
  });

  it('lets a crash reaction interrupt chatter but never a hero line', () => {
    const s = createScheduler();
    const chat = item('chat_w1', 'woman_mid', 'chatter', 3000);
    expect(s.submit(chat, 0).action).toBe('play');
    const crash = item('crash_w', 'woman_mid', 'complaint_crash');
    const r = s.submit(crash, 500);
    expect(r.action).toBe('play');
    expect(r.interrupted).toBe(chat);

    const s2 = createScheduler();
    const hero = item('hero_first_1', 'mega_hero', 'hero_first_fare', 3000);
    expect(s2.submit(hero, 0).action).toBe('play');
    expect(s2.submit(crash, 500).action).toBe('queued');
  });

  it('never overlaps a hero line with a passenger line or another hero line', () => {
    const s = createScheduler();
    const thanks = item('thx_w1', 'woman_mid', 'thanks', 2000);
    const hero = item('hero_first_1', 'mega_hero', 'hero_first_fare', 2500, { ttl: 12000 });
    const hero2 = item('hero_streak_1', 'mega_hero', 'hero_streak', 2500, { ttl: 12000 });
    expect(s.submit(thanks, 0).action).toBe('play');
    expect(s.submit(hero, 100).action).toBe('queued'); // waits for the passenger line (even though its priority is higher)
    expect(s.submit(hero2, 150).action).toBe('queued');
    expect(s.tick(1000)).toBeNull();
    const a = s.tick(2000 + 300);
    expect(a.line.persona).toBe('mega_hero');
    expect(s.playing(2600)).toBe(a);
    expect(s.tick(3000)).toBeNull(); // hero 1 still speaking
    const b = s.tick(2300 + 2500 + 300);
    expect(b.line.persona).toBe('mega_hero');
    expect(b).not.toBe(a);
  });

  it('drops queued lines that waited longer than their ttl, and caps the queue', () => {
    const s = createScheduler({ maxQueue: 2 });
    expect(s.submit(item('thx_w1', 'woman_mid', 'thanks', 5000), 0).action).toBe('play');
    const a = item('chat_w1', 'woman_mid', 'chatter', 1000, { ttl: 1000 });
    const b = item('hail_reg_m1', 'man_rusher', 'hail', 1000, { ttl: 8000 });
    const c = item('hail_reg_w1', 'woman_mid', 'hail', 1000, { ttl: 8000 });
    expect(s.submit(a, 100).action).toBe('queued');
    expect(s.submit(b, 200).action).toBe('queued');
    expect(s.submit(c, 300).action).toBe('queued'); // a (lowest priority) falls off
    expect(s.queued()).toBe(2);
    const next = s.tick(6000);
    expect(next.line.id).toBe('hail_reg_m1');
    s.finish(6100);
    expect(s.tick(6500).line.id).toBe('hail_reg_w1');
  });

  it('priorities: crash beats rest, hero sits at boarding level', () => {
    expect(priorityOf(LINES.find((l) => l.id === 'crash_w'))).toBeGreaterThan(priorityOf(LINES.find((l) => l.id === 'thx_w1')));
    expect(priorityOf(LINES.find((l) => l.id === 'chat_w1'))).toBeLessThan(priorityOf(LINES.find((l) => l.id === 'hail_reg_m1')));
  });
});

describe('hail lines that name a place', () => {
  it('use the place line only at that place, never elsewhere', () => {
    for (let i = 0; i < 30; i++) {
      const none = createPicker().pick({ category: 'hail', persona: 'man_rusher', kind: 'regular' }, 1e6);
      expect(none.place).toBeUndefined();
      const elsewhere = createPicker().pick({ category: 'hail', persona: 'man_rusher', kind: 'regular', place: 'oyo' }, 1e6);
      expect(elsewhere.place === undefined || elsewhere.place === 'oyo').toBe(true);
    }
    const here = createPicker({ rng: () => 0.1 }).pick({ category: 'hail', persona: 'man_rusher', kind: 'regular', place: 'bawarchi' }, 1e6);
    expect(here.roman).toBe('Bawarchi daggara auto babu!');
    // a persona without a line for that place falls back to a plain hail
    const plain = createPicker({ rng: () => 0.1 }).pick({ category: 'hail', persona: 'woman_mid', kind: 'regular', place: 'paradise' }, 1e6);
    expect(plain.place).toBeUndefined();
  });

  it('the angry driver and hero escape/caught lines are selectable', () => {
    const p = createPicker();
    expect(p.pick({ category: 'rage_shout', persona: 'driver_angry' }, 1e6).persona).toBe('driver_angry');
    expect(p.pick({ category: 'hero_escape', persona: 'mega_hero', force: true }, 1e6).persona).toBe('mega_hero');
    expect(p.pick({ category: 'hero_caught', persona: 'mega_hero', force: true }, 1e6).category).toBe('hero_caught');
    expect(p.pick({ category: 'traffic_hit', persona: 'driver_angry' }, 1e6).category).toBe('traffic_hit');
  });
});
