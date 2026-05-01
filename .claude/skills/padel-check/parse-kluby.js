// Extract free 17:00–23:00 windows from a kluby.org grafik page.
//
// Returns: Array<{ courtName, start: "HH:MM", end: "HH:MM", durationMin }>
// or { error: "..." } if the schedule table cannot be located (e.g. user not logged in).
//
// Notes:
// - kluby.org renders TWO `table.table-grafik` instances: a floating header
//   (`floatThead-table`) holding court names, and the body table with slot rows.
// - Multi-slot bookings use rowspan, so naive cell-per-row indexing breaks.
//   We materialise a 2D `grid[row][col] = isFree?` propagating rowspan/colspan.
// - First column is the time label, courts start at column index 1.
// - Court header text often duplicates ("Hala 1 Hala Hala 1 Hala") due to the
//   floating-header DOM doubling content; trimmed via regex to first two words.
// - Window threshold: ≥ 90 min, clipped at 23:00.
() => {
  const tables = document.querySelectorAll('table');
  let grafik = null, headerT = null;
  for (const t of tables) {
    if (t.className.includes('table-grafik')) {
      if (t.className.includes('floatThead')) headerT = t;
      else grafik = t;
    }
  }
  if (!grafik) return { error: 'no grafik table (not logged in?)' };

  const courtNames = headerT
    ? Array.from(headerT.querySelectorAll('th'))
        .map(h => h.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    : [];

  const rows = Array.from(grafik.querySelectorAll('tr'));
  const grid = rows.map(() => ({}));
  for (let ri = 0; ri < rows.length; ri++) {
    let ci = 0;
    for (const cell of rows[ri].querySelectorAll('td,th')) {
      while (grid[ri][ci] !== undefined) ci++;
      const rs = +(cell.getAttribute('rowspan') || 1);
      const cs = +(cell.getAttribute('colspan') || 1);
      const free = cell.textContent.includes('Rezerwuj');
      for (let r = ri; r < ri + rs; r++) {
        if (!grid[r]) grid[r] = {};
        for (let c = ci; c < ci + cs; c++) grid[r][c] = free;
      }
      ci += cs;
    }
  }

  const timeRows = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const fc = rows[ri].querySelector('td,th');
    if (!fc) continue;
    const m = fc.textContent.match(/(\d{1,2}):(\d{2})/);
    if (!m) continue;
    const total = (+m[1]) * 60 + (+m[2]);
    if (total < 17 * 60 || total > 22 * 60 + 30) continue;
    const courts = [];
    for (let c = 1; c <= (courtNames.length || 10); c++) {
      courts.push(grid[ri][c] === true);
    }
    timeRows.push({ total, courts });
  }

  const nc = courtNames.length || Math.max(0, ...timeRows.map(r => r.courts.length));
  const fmt = x => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  const wins = [];

  for (let c = 0; c < nc; c++) {
    const rawName = courtNames[c] || `Kort ${c + 1}`;
    const name = rawName.replace(/(\S+\s+\S+)\s+.*/, '$1');
    let i = 0;
    while (i < timeRows.length) {
      if (!timeRows[i].courts[c]) { i++; continue; }
      let j = i;
      while (j < timeRows.length && timeRows[j].courts[c]) j++;
      const start = timeRows[i].total;
      const end = Math.min(timeRows[j - 1].total + 30, 23 * 60);
      const dur = end - start;
      if (dur >= 90) {
        wins.push({ courtName: name, start: fmt(start), end: fmt(end), durationMin: dur });
      }
      i = j;
    }
  }
  return wins;
}
