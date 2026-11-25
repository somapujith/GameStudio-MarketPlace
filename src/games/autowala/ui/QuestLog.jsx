// OWNER: quests agent. The mission HUD and menus: the tracker (left side), the tutorial card, the result card, the job board
// (menu 'jobs') and the quest log (menu 'quests', key Q). Props: { game, snap }. The data is snap.quest (see gameplay/quests.js);
// actions go through game.ctx.quests. The pieces live in ui/quests/.
import Tracker from './quests/Tracker.jsx';
import Coach from './quests/Coach.jsx';
import ResultCard from './quests/ResultCard.jsx';
import JobBoard from './quests/JobBoard.jsx';
import LogPanel from './quests/LogPanel.jsx';
import './quests/quests.css';

export default function QuestLog({ game, snap }) {
  const q = snap?.quest;
  if (!q) return null;
  if (snap.menu === 'jobs') return <JobBoard game={game} snap={snap} />;
  if (snap.menu === 'quests') return <LogPanel game={game} snap={snap} />;
  if (snap.menu) return null; // start, pause, workshop, summary: they own the screen
  return (
    <>
      <Tracker q={q} />
      <Coach q={q} onSkip={() => game.ctx.quests?.skipTutorial()} />
      <ResultCard q={q} />
    </>
  );
}
