// The full-screen states before and around the game: the loading bar, "this browser cannot run it" / "it could not start", and "the
// graphics card paused the game" (WebGL context lost). Styles live in ui/autowala.css (.aw-loading / .aw-failure / .aw-loadbox).
// Every dead end offers a way out: reload (the usual cure) and back to the game page.
import { Link } from 'react-router-dom';
import { isNativeApp, webglFailureText } from '@/platform/gfx/webgl.js';

const reload = () => window.location.reload();

export function LoadingScreen({ text = 'Loading', pct = 0 }) {
  return (
    <div className="aw-loading" role="status" aria-live="polite">
      <div className="aw-loadbox">
        <span>
          AUTOWALA <i lang="te">ఆటోవాలా</i>
        </span>
        <div className="aw-loadbar" role="progressbar" aria-label="Loading the city" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <b style={{ width: `${pct}%` }} />
        </div>
        <small>
          {text}&hellip; <span className="aw-loadpct">{pct}%</span>
        </small>
      </div>
    </div>
  );
}

/** kind: 'webgl' (no WebGL 2 / no hardware acceleration) | anything else (the build threw). `native`: inside the Android app (no hardware-acceleration switch to point at). */
export function FailureScreen({ kind, native = isNativeApp() }) {
  const webgl = kind === 'webgl';
  const text = webglFailureText({ native }, 'Autowala');
  return (
    <div className="aw-loading aw-failure" role="alert">
      <div>
        <b>{webgl ? text.title : 'Autowala couldn’t start'}</b>
        <p>{webgl ? text.body : 'Something went wrong while building the city. Reload the page; if it keeps happening, try another browser.'}</p>
        <div className="aw-failure-acts">
          {!webgl && (
            <button type="button" className="aw-failure-btn" onClick={reload}>
              Reload
            </button>
          )}
          <Link to="/games/autowala" className={`aw-failure-btn${webgl ? '' : ' is-quiet'}`}>
            Back to the game page
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The GPU context was lost (driver reset, too many tabs, mobile backgrounding). The renderer rebuilds itself when it comes back. */
export function GpuLostScreen() {
  return (
    <div className="aw-loading aw-failure" role="alert">
      <div>
        <b>The graphics card paused the game</b>
        <p>Waiting for it to come back&hellip; Switching tabs or low memory can cause this. If nothing happens, reload the page.</p>
        <div className="aw-failure-acts">
          <button type="button" className="aw-failure-btn is-quiet" onClick={reload}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
