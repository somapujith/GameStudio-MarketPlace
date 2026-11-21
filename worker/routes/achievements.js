// GET /api/achievements (docs/ENGAGEMENT.md section 1): the catalogue, with progress and unlock state when signed in.
import { Hono } from 'hono';
import { limit } from '../ratelimit.js';
import { loadMetrics } from '../achievements.js';
import { ACHIEVEMENTS, progressOf, rewardOf } from '../../shared/achievements.js';

/** The Achievement shape for one viewer (`m` = their loaded metrics, or null when signed out). */
export function achievementView(a, m) {
  const at = m ? m.unlocked.get(a.id) : undefined;
  const unlocked = at !== undefined;
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon,
    category: a.category,
    goal: a.goal,
    reward: rewardOf(a),
    progress: m ? progressOf(a, m.metrics, unlocked) : null,
    unlocked,
    unlockedAt: unlocked ? at || null : null,
  };
}

const achievements = new Hono();

// GET /api/achievements -> { achievements: Achievement[], unlocked, total }   session optional
achievements.get('/', limit('achievements', 60, 60), async (c) => {
  const session = c.get('session');
  const [m = null] = session ? await loadMetrics(c.env, [session.uid]) : [];
  const list = ACHIEVEMENTS.map((a) => achievementView(a, m));
  return c.json({ achievements: list, unlocked: list.filter((a) => a.unlocked).length, total: list.length });
});

export default achievements;
