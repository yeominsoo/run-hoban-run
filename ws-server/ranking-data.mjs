export function isoWeekKey(date = new Date()) {
  // The existing production Node container uses UTC. Keep its weekly boundaries.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function createResultRanking(data, save = () => {}) {
  return {
    recordResult(name, won) {
      if (!name) return;
      const week = isoWeekKey();
      if (!Object.hasOwn(data, week)) data[week] = Object.create(null);
      if (!Object.hasOwn(data[week], name)) Object.defineProperty(data[week], name, {
        value: { wins: 0, losses: 0 }, enumerable: true, writable: true, configurable: true,
      });
      data[week][name][won ? 'wins' : 'losses'] += 1;
      save();
    },
    getRanking(week) {
      return Object.entries(data[week] || {})
        .map(([name, rec]) => ({ name, wins: rec.wins || 0, losses: rec.losses || 0 }))
        .filter(e => e.wins + e.losses > 0)
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 50);
    },
  };
}

export function createRpsRanking(data, save = () => {}) {
  return {
    recordSetWin(name, mode) {
      if (!name || !['1v1', 'battle', 'tournament'].includes(mode)) return;
      const week = isoWeekKey();
      if (!Object.hasOwn(data, week)) data[week] = Object.create(null);
      if (!Object.hasOwn(data[week], name)) Object.defineProperty(data[week], name, {
        value: { '1v1': 0, battle: 0, tournament: 0 }, enumerable: true, writable: true, configurable: true,
      });
      data[week][name][mode] = (data[week][name][mode] || 0) + 1;
      save();
    },
    getRanking(week) {
      return Object.entries(data[week] || {}).map(([name, modes]) => {
        const byMode = { '1v1': modes['1v1'] || 0, battle: modes.battle || 0, tournament: modes.tournament || 0 };
        return { name, byMode, total: byMode['1v1'] + byMode.battle + byMode.tournament };
      }).filter(e => e.total > 0).sort((a, b) => b.total - a.total).slice(0, 50);
    },
  };
}
