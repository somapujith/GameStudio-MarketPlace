import '@/styles/x-shell.css';

/*
 * Route-shaped loading placeholders for hub pages (the Suspense fallback inside AppShell), so a lazy page
 * swaps in without the layout jumping. Full-screen game routes keep PageLoading.
 */

/** 'home' | 'list' | 'profile' | 'shop' | 'game' | 'page' for a hub pathname. */
export function skeletonKind(pathname = '/') {
  const p = String(pathname || '/');
  if (p === '/' || p === '') return 'home';
  if (p.startsWith('/friends') || p.startsWith('/leaderboard')) return 'list';
  if (p.startsWith('/profile')) return 'profile';
  if (p.startsWith('/shop')) return 'shop';
  if (p.startsWith('/games/')) return 'game';
  return 'page';
}

const S = ({ className = '', style }) => <span className={`hub-skel ${className}`.trim()} style={style} />;

function Head() {
  return (
    <div className="xs-sk-head">
      <S className="xs-sk-title" />
      <S className="hub-skel--line xs-sk-w40" />
    </div>
  );
}

function Rows({ n = 6 }) {
  return (
    <div className="xs-sk-rows">
      {Array.from({ length: n }, (_, i) => (
        <div className="xs-sk-row" key={i}>
          <S className="hub-skel--dot" />
          <div className="xs-sk-col">
            <S className="hub-skel--line" style={{ width: `${62 - (i % 3) * 12}%` }} />
            <S className="hub-skel--line xs-sk-w30" />
          </div>
          <S className="xs-sk-pill" />
        </div>
      ))}
    </div>
  );
}

function Home() {
  return (
    <>
      <S className="xs-sk-hero" />
      <div className="xs-sk-strip">
        {Array.from({ length: 5 }, (_, i) => (
          <S key={i} className="xs-sk-ava" />
        ))}
      </div>
      <div className="xs-sk-chips">
        {Array.from({ length: 4 }, (_, i) => (
          <S key={i} className="xs-sk-chip" />
        ))}
      </div>
      <div className="xs-sk-cards">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="xs-sk-card" key={i}>
            <S className="xs-sk-cover" />
            <S className="hub-skel--line xs-sk-w70" />
            <S className="hub-skel--line xs-sk-w40" />
          </div>
        ))}
      </div>
    </>
  );
}

function Profile() {
  return (
    <>
      <div className="xs-sk-panel xs-sk-profile">
        <S className="xs-sk-avatar" />
        <div className="xs-sk-col">
          <S className="xs-sk-title" />
          <S className="hub-skel--line xs-sk-w40" />
          <S className="xs-sk-bar" />
        </div>
      </div>
      <div className="xs-sk-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <S key={i} className="xs-sk-tile" />
        ))}
      </div>
      <S className="xs-sk-block" />
    </>
  );
}

function Shop() {
  return (
    <>
      <Head />
      <div className="xs-sk-chips">
        {Array.from({ length: 3 }, (_, i) => (
          <S key={i} className="xs-sk-chip" />
        ))}
      </div>
      <div className="xs-sk-grid xs-sk-grid--shop">
        {Array.from({ length: 6 }, (_, i) => (
          <S key={i} className="xs-sk-tile xs-sk-tile--tall" />
        ))}
      </div>
    </>
  );
}

function Game() {
  return (
    <div className="xs-sk-panel xs-sk-game">
      <S className="xs-sk-icon" />
      <S className="xs-sk-title" />
      <S className="hub-skel--line xs-sk-w70" />
      <div className="xs-sk-chips">
        {Array.from({ length: 5 }, (_, i) => (
          <S key={i} className="xs-sk-seat" />
        ))}
      </div>
      <S className="xs-sk-btn" />
    </div>
  );
}

/** Suspense fallback for a hub route. */
export default function RouteSkeleton({ pathname = '/', label = 'Loading…' }) {
  const kind = skeletonKind(pathname);
  return (
    <div className={`hub-page xs-sk xs-sk--${kind}`} role="status" aria-live="polite" aria-busy="true">
      <span className="hub-sr">{label}</span>
      {kind === 'home' && <Home />}
      {kind === 'list' && (
        <>
          <Head />
          <Rows />
        </>
      )}
      {kind === 'profile' && <Profile />}
      {kind === 'shop' && <Shop />}
      {kind === 'game' && <Game />}
      {kind === 'page' && (
        <>
          <Head />
          <S className="xs-sk-block" />
          <S className="xs-sk-block xs-sk-block--short" />
        </>
      )}
    </div>
  );
}
