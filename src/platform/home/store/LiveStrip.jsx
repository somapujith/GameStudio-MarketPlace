import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { gameById } from '../catalog.js';
import { themeVars } from '../gameTheme.js';
import { plural } from '@/components/shell/home/homeModel.js';

function jump(e) {
  const el = typeof document !== 'undefined' ? document.getElementById('sh-open') : null;
  if (!el) return;
  e.preventDefault();
  const reduced = document.documentElement.dataset.motion === 'reduced';
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/**
 * The live strip under the spotlight: compact pulse chips for what is happening right now. Every number is real
 * (open tables, friends online, your running table); an unknown number hides its chip, and the whole strip
 * disappears when there is nothing to say. Offline shows one calm "unavailable" chip with a retry.
 */
export default function LiveStrip({ live }) {
  if (!live) return null;
  const { booting, offline, tables, friendsOnline, resume, retry, gamesLive, open } = live;
  const loading = booting || (gamesLive.status === 'loading' && open.status === 'loading');

  if (loading) {
    return (
      <div className="cj-home-live" aria-hidden="true">
        <span className="cj-home-skel cj-home-live__skel" />
        <span className="cj-home-skel cj-home-live__skel" style={{ width: 120 }} />
      </div>
    );
  }

  if (offline) {
    return (
      <div className="cj-home-live" role="status">
        <span className="cj-chip cj-home-pulse is-off">
          <HubIcon name="wifiOff" size={15} /> Live tables unavailable
        </span>
        <button type="button" className="cj-chip cj-home-pulse" onClick={retry}>
          <HubIcon name="refresh" size={14} /> Retry
        </button>
      </div>
    );
  }

  const rGame = resume ? gameById(resume.room.gameId) : null;
  const chips = [];
  if (resume) {
    const playing = resume.kind === 'playing';
    const to = playing ? paths.online(resume.room.gameId || rGame?.id || '', resume.room.code) : paths.lobby(resume.room.code);
    chips.push(
      <Link key="resume" to={to} className="cj-chip cj-home-pulse cj-home-pulse--resume" style={themeVars(rGame)}>
        <i className="cj-live-dot" aria-hidden="true" />
        <span>
          {playing ? 'Your game is running' : 'Your table is open'}
          <b> · {resume.room.code}</b>
        </span>
        <span className="cj-home-pulse__go">
          {playing ? 'Rejoin' : 'Open lobby'} <HubIcon name="arrowR" size={14} strokeWidth={2.6} />
        </span>
      </Link>,
    );
  }
  if (tables > 0) {
    chips.push(
      <a key="tables" href="#sh-open" onClick={jump} className="cj-chip cj-home-pulse">
        <i className="cj-live-dot" aria-hidden="true" />
        <b>{plural(tables, 'table')}</b> open to join
      </a>,
    );
  }
  if (friendsOnline > 0) {
    chips.push(
      <Link key="friends" to={paths.friends()} className="cj-chip cj-home-pulse">
        <i className="cj-live-dot" aria-hidden="true" />
        <b>{friendsOnline}</b> friend{friendsOnline === 1 ? '' : 's'} online
      </Link>,
    );
  }
  if (!chips.length) return null;
  return (
    <div className="cj-home-live" aria-label="Happening now">
      {chips}
    </div>
  );
}
