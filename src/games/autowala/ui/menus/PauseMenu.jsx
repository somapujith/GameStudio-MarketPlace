// The pause screen: a full-screen neon backdrop (the world keeps rendering behind it, the auto is held by ctx.openMenu('pause')),
// a big italic PAUSE title, a vertical list on the left (RESUME, BRIEF, MAP, STATS, OPTIONS, CLOCK OUT, QUIT TO HUB) and the
// matching panel on the right. Original styling; navigation lives in useMenuInput (keys, gamepad) and the rows (mouse, touch).
import { useEffect, useRef, useState } from 'react';
import { CycleRow, NavRow, SliderRow, ToggleRow } from './MenuControls.jsx';
import { BriefPanel, ControlsPanel, NotePanel, SideCard, StatsPanel } from './PausePanels.jsx';
import { OPTION_ITEMS, ROOT_ITEMS, backPath, qualityLabel } from './menuNav.js';
import { nextQuality, readSettings, saveSettings } from './settings.js';
import { focusFirst, useMenuInput } from './useMenuInput.js';

const BACK = { label: 'BACK', te: 'వెనుకకు' };
const TITLES = { '': 'PAUSE', brief: 'BRIEF', stats: 'STATS', options: 'OPTIONS', 'options/audio': 'AUDIO', 'options/display': 'DISPLAY', 'options/controls': 'CONTROLS', 'options/language': 'LANGUAGE', quit: 'QUIT' };

export default function PauseMenu({ game, snap, sitting, log, onResume, onClockOut, onQuit }) {
  const root = useRef(null);
  const [path, setPath] = useState([]);
  const [, bump] = useState(0);
  const view = path.join('/');
  const refresh = () => bump((n) => n + 1);
  const st = readSettings(game);

  const go = (id) => setPath((p) => [...p, id]);
  const pathRef = useRef(path);
  pathRef.current = path;
  // functional update: two quick Esc presses between renders still go up two levels
  const back = () => (pathRef.current.length ? setPath((p) => backPath(p)) : onResume());
  useMenuInput(root, { active: true, onBack: back, onResume });
  useEffect(() => {
    focusFirst(root.current, '[data-autofocus]');
  }, [view]);

  const openMap = () => {
    onResume();
    // the minimap listens for the M key (a one-shot on game.input); press it for the player once the menu is closed
    setTimeout(() => {
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'm' }));
    }, 90);
  };
  const act = { resume: onResume, map: openMap, clockout: onClockOut };
  const setAudio = (k) => (v) => {
    saveSettings(game, { audio: { [k]: v } });
    refresh();
  };

  let rows;
  let panel;
  switch (view) {
    case '':
      rows = ROOT_ITEMS.map((it, i) => (
        <NavRow key={it.id} index={i} label={it.label} te={it.te} autoFocus={i === 0} tone={it.id === 'quit' ? 'danger' : it.id === 'clockout' ? 'gold' : ''} onActivate={() => (act[it.id] ? act[it.id]() : go(it.id))} />
      ));
      panel = (
        <NotePanel title="PAUSED" te="విరామం">
          <p>The city keeps its engine running. Take your time.</p>
          <p className="aw-note__keys">
            <kbd className="aw-key">Esc</kbd> / <kbd className="aw-key">P</kbd> to jump back in
          </p>
        </NotePanel>
      );
      break;
    case 'brief':
      rows = [<NavRow key="b" index={0} {...BACK} autoFocus onActivate={back} />];
      panel = <BriefPanel snap={snap} log={log} />;
      break;
    case 'stats':
      rows = [<NavRow key="b" index={0} {...BACK} autoFocus onActivate={back} />];
      panel = <StatsPanel game={game} sitting={sitting} log={log} />;
      break;
    case 'options':
      rows = [
        ...OPTION_ITEMS.map((it, i) => <NavRow key={it.id} index={i} label={it.label} te={it.te} autoFocus={i === 0} onActivate={() => go(it.id)} />),
        <NavRow key="b" index={OPTION_ITEMS.length} {...BACK} onActivate={back} />,
      ];
      panel = (
        <NotePanel title="OPTIONS" te="ఎంపికలు">
          <p>Sound, picture quality, controls and language. Everything is saved on this device.</p>
        </NotePanel>
      );
      break;
    case 'options/audio':
      rows = [
        <SliderRow key="m" index={0} label="MASTER" te="మొత్తం" value={st.audio.master} onChange={setAudio('master')} disabled={!st.sound} />,
        <SliderRow key="f" index={1} label="EFFECTS" te="ప్రభావాలు" value={st.audio.fx} onChange={setAudio('fx')} disabled={!st.sound} />,
        <SliderRow key="v" index={2} label="VOICES" te="స్వరాలు" value={st.audio.voice} onChange={setAudio('voice')} disabled={!st.sound} />,
        <SliderRow key="u" index={3} label="MUSIC" te="సంగీతం" value={st.audio.music} onChange={setAudio('music')} disabled={!st.sound} />,
        <ToggleRow key="s" index={4} label="SOUND" te="శబ్దం" on={st.sound} onChange={(on) => { saveSettings(game, { sound: on }); refresh(); }} />,
        <NavRow key="b" index={5} {...BACK} onActivate={back} />,
      ];
      panel = (
        <NotePanel title="AUDIO" te="ధ్వని">
          <p>Master volume and the sound switch apply right away. Effects, voices and music levels are saved for the sound systems that support them.</p>
          <p className="aw-credit">
            Voices are AI-generated
            <span className="aw-te">స్వరాలు AI తో తయారు చేయబడ్డాయి</span>
          </p>
        </NotePanel>
      );
      break;
    case 'options/display': {
      const needsReload = st.quality !== null && st.quality !== snap.quality;
      rows = [
        <CycleRow key="q" index={0} label="QUALITY" te="నాణ్యత" value={qualityLabel(st.quality)} onCycle={(d) => { nextQuality(game, d); refresh(); }} />,
        needsReload && <NavRow key="r" index={1} label="RELOAD NOW" te="రీలోడ్" tone="gold" onActivate={() => window.location.reload()} />,
        <NavRow key="b" index={2} {...BACK} onActivate={back} />,
      ].filter(Boolean);
      panel = (
        <NotePanel title="DISPLAY" te="డిస్‌ప్లే">
          <p>
            Running at <b>{String(snap.quality || 'auto')}</b> quality. Auto picks the best setting for this device.
          </p>
          <p>A new quality setting is used after the page reloads.{needsReload ? ' Reload to see it now.' : ''}</p>
        </NotePanel>
      );
      break;
    }
    case 'options/controls':
      rows = [<NavRow key="b" index={0} {...BACK} autoFocus onActivate={back} />];
      panel = <ControlsPanel />;
      break;
    case 'options/language':
      rows = [
        <ToggleRow key="t" index={0} label="TELUGU LABELS" te="తెలుగు లేబుళ్ళు" on={st.teluguLabels} onChange={(on) => { saveSettings(game, { teluguLabels: on }); refresh(); }} />,
        <NavRow key="b" index={1} {...BACK} onActivate={back} />,
      ];
      panel = (
        <NotePanel title="LANGUAGE" te="భాష">
          <p>Show the Telugu names for customers, places and menus under the English ones.</p>
        </NotePanel>
      );
      break;
    case 'quit':
      rows = [
        <NavRow key="n" index={0} label="STAY" te="ఉండు" autoFocus onActivate={back} />,
        <NavRow key="y" index={1} label="LEAVE THE GAME" te="బయటకు వెళ్ళు" tone="danger" onActivate={onQuit} />,
      ];
      panel = (
        <NotePanel title="QUIT TO HUB" te="హబ్‌కు">
          <p>Your wallet, upgrades and stats are saved on this device. To save this shift's score online, use CLOCK OUT first.</p>
        </NotePanel>
      );
      break;
    default:
      rows = [<NavRow key="b" index={0} {...BACK} autoFocus onActivate={back} />];
      panel = null;
  }

  return (
    <div className="aw-menu aw-pm" ref={root} role="dialog" aria-modal="true" aria-label="Pause menu">
      <div className="aw-pm__bg" />
      <header className="aw-pm__head">
        <h1 key={view}>
          <span>{TITLES[view] || 'PAUSE'}</span>
        </h1>
        <p>
          AUTOWALA <span className="aw-te">ఆటోవాలా</span>
        </p>
      </header>
      <div className="aw-pm__body">
        <nav className="aw-pm__list" key={view} aria-label={TITLES[view] || 'Pause'}>
          {rows}
        </nav>
        <section className="aw-pm__right">
          <SideCard snap={snap} />
          {panel}
        </section>
      </div>
      <footer className="aw-pm__hints" aria-hidden="true">
        <span><kbd className="aw-key">W</kbd><kbd className="aw-key">S</kbd> Move</span>
        <span><kbd className="aw-key">Enter</kbd> Select</span>
        <span><kbd className="aw-key">Esc</kbd> {path.length ? 'Back' : 'Resume'}</span>
        <span><kbd className="aw-key">P</kbd> Resume</span>
      </footer>
    </div>
  );
}
