// The two-second card before a shift: a painted menu board with the day's dishes (NEW ones stickered), the hours on a sky chip,
// and one tip from Chotu. Calls onGo after `ms` (or when "Go" is pressed).
import { useEffect, useRef } from 'react';
import { DishGlyph, SkyGlyph } from './art.jsx';
import { briefingModel } from './menuModels.js';
import './menus.css';

/** Props: { level, pace, onGo(), ms? = 2000 (pass 0 to wait for the Go button) } */
export default function LevelBriefing({ level, pace = 'normal', onGo, ms = 2000 }) {
  const vm = briefingModel(level, pace);
  const go = useRef(onGo);
  go.current = onGo;
  useEffect(() => {
    if (!(ms > 0)) return undefined;
    const t = setTimeout(() => go.current?.(), ms);
    return () => clearTimeout(t);
  }, [ms, vm.level]);

  return (
    <div className="tc-menu tc-menu-brief" role="dialog" aria-modal="true" aria-labelledby="tc-brief-h" style={{ '--tc-brief-ms': `${ms}ms` }}>
      <div className="tc-menu-brief__card">
        <header className={`tc-menu-brief__sky tc-menu-sky--${vm.sky}`}>
          <SkyGlyph sky={vm.sky} />
          <span className="tc-menu-brief__hours">{vm.skyLabel} <span lang="te">{vm.skyTe}</span> <b>{vm.hours}</b></span>
        </header>
        <p className="tc-menu-eyebrow">{vm.level > 0 ? `Level ${vm.level}` : 'Training'} <span aria-hidden="true">{'·'}</span> {vm.paceLabel} <span aria-hidden="true">{'·'}</span> {vm.length} shift</p>
        <h2 id="tc-brief-h" className="tc-menu-banner tc-menu-banner--brief">
          <span className="tc-menu-banner__en">{vm.name}</span>
          <span className="tc-menu-banner__te" lang="te">{vm.te}</span>
        </h2>

        <section className="tc-menu-menuboard" aria-label="Today's menu">
          <h3 className="tc-menu-menuboard__h">Today's menu <small>{vm.menu.length} dishes</small></h3>
          <ul className="tc-menu-menuboard__list">
            {vm.menu.map((m) => (
              <li key={m.id} className={m.isNew ? 'is-new' : ''}>
                <DishGlyph station={m.station} size={24} />
                <span className="tc-menu-menuboard__name">{m.name}<span lang="te">{m.te}</span></span>
                {m.isNew && <span className="tc-menu-new">NEW</span>}
              </li>
            ))}
          </ul>
          {vm.stations.some((s) => s.isNew) && (
            <p className="tc-menu-menuboard__stations">
              New at the stall:{' '}
              {vm.stations.filter((s) => s.isNew).map((s, i) => (
                <span key={s.id} className="tc-menu-new tc-menu-new--inline">{i ? ', ' : ''}{s.name} NEW</span>
              ))}
            </p>
          )}
        </section>

        <p className="tc-menu-tip"><b>Chotu's tip</b> {vm.tip}</p>
        <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary" data-autofocus autoFocus onClick={() => onGo?.()}>
          Open the stall
        </button>
        {ms > 0 && <span className="tc-menu-brief__timer" aria-hidden="true" />}
      </div>
    </div>
  );
}
