// Cosmetics shop (docs/HUSTLE_PLAN.md section 4). Prices and kinds come from shared/cosmetics.js:
// the client's copy is for display only, the server never trusts a price or kind from the body.
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { requireUser } from '../auth.js';
import { getUserById, rowEquipped } from '../users.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { COSMETICS, EQUIPPABLE_KINDS, FREE_COSMETICS, cosmeticById } from '../../shared/cosmetics.js';

const shop = new Hono();

/** Item ids the user has bought. */
async function boughtItems(env, userId) {
  const rows = await query(env, 'SELECT item_id FROM user_items WHERE user_id = $1', [userId]);
  return rows.map((r) => r.item_id);
}

/** Free items + bought ones, catalogue order, unknown ids dropped. */
export function ownedList(bought) {
  const set = new Set([...FREE_COSMETICS, ...(bought || [])]);
  return COSMETICS.filter((c) => set.has(c.id)).map((c) => c.id);
}

/** The catalogue as the shop shows it to one viewer. */
export function shopItems(owned, equipped) {
  const own = new Set(owned);
  return COSMETICS.map((c) => {
    const item = { id: c.id, kind: c.kind, name: c.name, price: c.price, rarity: c.rarity };
    if (c.colors) item.colors = [...c.colors];
    // Voice lines (owned-only, played at the table): symbol, clip, length and speech-bubble caption.
    for (const k of ['icon', 'emoji', 'src', 'durationMs', 'caption']) if (c[k] !== undefined) item[k] = c[k];
    item.owned = own.has(c.id);
    item.equipped = equipped[c.kind] === c.id;
    return item;
  });
}

// GET /api/shop -> { items:[{ id, kind, name, price, rarity, colors?, icon?, emoji?, src?, durationMs?, caption?, owned, equipped }], coins, equipped }
// Voice lines (kind 'voice') carry icon/emoji/src/durationMs/caption and are never "equipped": they are owned-only.
// Session optional: signed out -> owned = free items only, coins null, equipped {}.
shop.get('/', limit('shop-list', 60, 60), async (c) => {
  const session = c.get('session');
  const user = session ? await getUserById(c.env, session.uid) : null;
  if (!user) return c.json({ items: shopItems(ownedList([]), {}), coins: null, equipped: {} });
  const owned = ownedList(await boughtItems(c.env, user.id));
  // Only show something as equipped when it is (still) owned.
  const equipped = Object.fromEntries(Object.entries(rowEquipped(user)).filter(([, id]) => owned.includes(id)));
  return c.json({ items: shopItems(owned, equipped), coins: user.coins, equipped });
});

// One atomic statement. `buyer` locks the users row (FOR UPDATE) while the balance is checked, so
// two parallel buys are serialised and the second re-checks the balance after the first commits;
// the item is inserted only when affordable and new (ON CONFLICT DO NOTHING), and coins are spent
// only for an inserted item. The coins >= 0 CHECK on users is a second safety net.
// bought_before = the items owned before this statement (CTE writes are invisible to the outer query).
export const BUY_SQL = `
WITH buyer AS (
  SELECT id FROM users WHERE id = $1::uuid AND coins >= $3::int FOR UPDATE
), ins AS (
  INSERT INTO user_items (user_id, item_id, price_paid)
  SELECT buyer.id, $2::text, $3::int FROM buyer
  ON CONFLICT (user_id, item_id) DO NOTHING
  RETURNING item_id
), spend AS (
  UPDATE users u SET coins = u.coins - $3::int
    FROM ins
   WHERE u.id = $1::uuid
  RETURNING u.coins
)
SELECT (SELECT coins FROM spend) AS coins,
       coalesce((SELECT json_agg(item_id) FROM user_items WHERE user_id = $1::uuid), '[]'::json) AS bought_before`;

// Why a buy did nothing (a fresh statement, so it sees a parallel purchase that just committed).
export const BUY_FAIL_SQL = `
SELECT EXISTS (SELECT 1 FROM user_items WHERE user_id = $1::uuid AND item_id = $2::text) AS had`;

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
};

// POST /api/shop/buy { itemId } -> { coins, owned: string[] }
//   400 unknown item, 402 Not enough coins., 409 Already owned.
shop.post('/buy', requireUser, limit('shop-buy', 20, 60), async (c) => {
  const user = c.get('user');
  const { itemId } = await readJson(c);
  const item = typeof itemId === 'string' ? cosmeticById(itemId) : null;
  if (!item) throw new HttpError(400, 'Unknown item.');
  if (FREE_COSMETICS.includes(item.id)) throw new HttpError(409, 'Already owned.');
  let row;
  try {
    [row] = await query(c.env, BUY_SQL, [user.id, item.id, item.price]);
  } catch (err) {
    if (err && err.code === '23514') throw new HttpError(402, 'Not enough coins.'); // coins >= 0 CHECK (race)
    throw err;
  }
  if (!row || row.coins == null) {
    const [why] = await query(c.env, BUY_FAIL_SQL, [user.id, item.id]);
    if (why && why.had) throw new HttpError(409, 'Already owned.');
    throw new HttpError(402, 'Not enough coins.');
  }
  return c.json({ coins: Number(row.coins), owned: ownedList([...parseList(row.bought_before), item.id]) });
});

// Equip: one UPDATE that only matches when the item is owned (free, or a user_items row).
export const EQUIP_SQL = `
UPDATE users SET equipped = coalesce(equipped, '{}'::jsonb) || jsonb_build_object($2::text, $3::text)
 WHERE id = $1::uuid
   AND ($4::boolean OR EXISTS (SELECT 1 FROM user_items i WHERE i.user_id = $1::uuid AND i.item_id = $3::text))
RETURNING equipped`;

export const UNEQUIP_SQL = `
UPDATE users SET equipped = coalesce(equipped, '{}'::jsonb) - $2::text
 WHERE id = $1::uuid
RETURNING equipped`;

// POST /api/shop/equip { kind, itemId|null } -> { equipped }
//   400 bad kind / unknown item / item of another kind, 403 not owned. itemId null = back to the default.
shop.post('/equip', requireUser, limit('shop-equip', 60, 60), async (c) => {
  const user = c.get('user');
  const { kind, itemId } = await readJson(c);
  if (kind === 'voice') throw new HttpError(400, 'Voice lines are not equipped: buy one, then play it at the table.');
  if (typeof kind !== 'string' || !EQUIPPABLE_KINDS.includes(kind)) throw new HttpError(400, 'Unknown cosmetic kind.');
  if (itemId === null || itemId === undefined) {
    const rows = await query(c.env, UNEQUIP_SQL, [user.id, kind]);
    return c.json({ equipped: rowEquipped(rows[0] || {}) });
  }
  const item = typeof itemId === 'string' ? cosmeticById(itemId) : null;
  if (!item) throw new HttpError(400, 'Unknown item.');
  if (item.kind !== kind) throw new HttpError(400, 'That item does not fit that slot.');
  const rows = await query(c.env, EQUIP_SQL, [user.id, kind, item.id, FREE_COSMETICS.includes(item.id)]);
  if (!rows[0]) throw new HttpError(403, 'You do not own that item.');
  return c.json({ equipped: rowEquipped(rows[0]) });
});

export default shop;
