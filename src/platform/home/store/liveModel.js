// Pure fold of the raw home loads into the live numbers (no React, no network). Covered by store.test.js.
import { joinableRooms, openTablesById, pickResume } from '@/components/shell/home/homeModel.js';

/** Pure: fold the raw loads into the numbers the UI shows. Exported for tests. */
export function summarizeLive({ gamesLive, open, mine, friends, account }) {
  const perGame = gamesLive?.status === 'ok' ? openTablesById(gamesLive.data?.games) : {};
  const rooms = open?.status === 'ok' ? joinableRooms(open.data?.rooms) : [];
  let tables = null;
  if (gamesLive?.status === 'ok') tables = Object.values(perGame).reduce((a, b) => a + b, 0);
  else if (open?.status === 'ok') tables = rooms.length;

  let friendsOnline = null;
  let friendsTotal = null;
  if (account && friends?.status === 'ok') {
    const list = Array.isArray(friends.data?.friends) ? friends.data.friends : [];
    friendsTotal = list.length;
    friendsOnline = list.filter((f) => f && f.online).length;
  }
  const resume = mine?.status === 'ok' ? pickResume(mine.data?.rooms) : null;
  return { perGame, rooms, tables, friendsOnline, friendsTotal, resume };
}
