// Pure: category tiles for the Home page.

/** Pure: one entry per CATEGORIES id that has at least one game (live or coming soon). */
export function categoryTiles(games, cats) {
  return cats
    .map((c) => {
      const inCat = games.filter((g) => g.category === c.id);
      const live = inCat.filter((g) => g.status === 'live');
      return { ...c, live: live.length, soon: inCat.length - live.length, lead: live[0] || inCat[0] || null };
    })
    .filter((c) => c.live + c.soon > 0);
}
