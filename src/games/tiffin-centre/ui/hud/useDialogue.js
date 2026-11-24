// useDialogue(session, audio, opts?): runs the customer-dialogue director on every session notification and returns what to show.
//
//   const { active, gloss } = useDialogue(session, audio, { scene });
//     active  [{ u (Utterance), born, until, leaving }]  the live speech lines (one per customer, newest wins)
//     gloss   [{ id, text }]                              English glosses for the aria-live region
//
// Side effects, each guarded so a missing piece never breaks the game: `audio.speak(u)` when voices are on and the shift is playing,
// `scene.setSpeaking(customerId, ttlMs)` (or the scene's `speak(customerId, ttlMs)`) to move that customer's mouth, `audio.setSpeechEnabled(bool)` kept in step with the Voices setting.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createDialogueRunner, loadDirectorFactory, spokenGloss } from './dialogue.js';
import { usePrefs } from './prefs.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const GLOSS_MS = 8000;

export function useDialogue(session, audio, { scene = null, createDirector = loadDirectorFactory(), prefs: given = null } = {}) {
  const [stored] = usePrefs();
  const prefs = given || stored;
  const [, bump] = useReducer((n) => (n + 1) % 1e9, 0);
  const [gloss, setGloss] = useState([]);
  const cfg = useRef({});
  cfg.current = { audio, scene, voices: prefs.voices };
  const ids = useRef(0);

  const runner = useMemo(() => {
    const director = createDirector ? createDirector({ lang: prefs.lang, seed: session?.state?.seed ?? 1, subtitles: prefs.subs }) : null;
    return createDialogueRunner({
      director,
      speak: (u) => cfg.current.audio?.speak?.(u),
      speaking: (id, ms) => {
        const sc = cfg.current.scene;
        if (typeof sc?.setSpeaking === 'function') sc.setSpeaking(id, ms);
        else sc?.speak?.(id, ms);
      },
      canSpeak: () => cfg.current.voices !== false && session?.status === 'playing',
    });
    // the director is rebuilt only when the language or the session changes; the subtitle style is applied at draw time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, prefs.lang, createDirector]);

  useEffect(() => {
    audio?.setSpeechEnabled?.(prefs.voices);
  }, [audio, prefs.voices]);

  useEffect(() => {
    if (!session?.subscribe) return undefined;
    let timer = 0;
    const timers = new Set();
    const arm = (t) => {
      clearTimeout(timer);
      const d = runner.nextDeadline(t);
      if (d !== null) {
        timer = setTimeout(() => {
          bump();
          arm(nowMs());
        }, Math.max(30, d - t + 12));
      }
    };
    const take = (state, events) => {
      const t = nowMs();
      const fresh = runner.ingest(state, events, t);
      if (fresh.length) {
        const add = fresh.map((u) => ({ id: ++ids.current, text: spokenGloss(u, state) }));
        setGloss((g) => [...g.slice(-2), ...add]);
        for (const m of add) {
          const x = setTimeout(() => {
            timers.delete(x);
            setGloss((g) => g.filter((q) => q.id !== m.id));
          }, GLOSS_MS);
          timers.add(x);
        }
        bump();
      }
      arm(t);
    };
    const off = session.subscribe(({ state, events }) => state && take(state, events));
    if (session.state) take(session.state, []);
    return () => {
      off?.();
      clearTimeout(timer);
      timers.forEach((x) => clearTimeout(x));
      runner.reset();
    };
  }, [session, runner]);

  return { active: runner.active(nowMs()), gloss };
}

export default useDialogue;
