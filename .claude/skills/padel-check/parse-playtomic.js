// Extract free 17:00–23:00 windows from a playtomic.com club page.
//
// Returns: Array<{ start: "HH:MM", end: "HH:MM", durationMin, numCourts }>
// (deduplicated and dominance-pruned — see below).
//
// Notes:
// - Playtomic does not expose a per-court grid in the DOM. Each available
//   booking is a `<details class="group/slot">` element whose textContent
//   starts with the start time (US format e.g. "5:00 PM"), then "N options"
//   (== courts available at that start), then per-duration sub-items
//   formatted "•60 min", "•90 min", ...
// - We collect ALL durations from each slot block (multi-match via exec loop;
//   `String.match(/.../g)` would discard sub-options after the first).
// - Times are AM/PM → minutes-since-midnight.
// - Filter: start ∈ [17:00, 23:00) and clipped duration ≥ 90 min.
//
// Dominance pruning (output reduction):
//   For each `start`, sort surviving (durationMin, numCourts) pairs by
//   durationMin DESC and keep one only if its numCourts is strictly greater
//   than the running max. Rationale: shorter window with the same court count
//   as a longer window is informationally redundant — anyone who fits the
//   short one also fits the long one. Keeps shorter windows ONLY when more
//   courts unlock at the shorter length.
() => {
  const parseTime = (text) => {
    const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = +m[1], min = +m[2];
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    return h * 60 + min;
  };
  const fmt = x => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;

  const slots = Array.from(document.querySelectorAll('details.group\\/slot'));
  const raw = []; // { startMin, durationMin, numCourts }
  const seen = new Set();
  for (const slot of slots) {
    const text = slot.textContent.trim();
    const tm = text.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    if (!tm) continue;
    const startMin = parseTime(tm[1]);
    if (startMin === null || startMin < 17 * 60 || startMin >= 23 * 60) continue;

    const optMatch = text.match(/(\d+)\s*option/);
    const numCourts = optMatch ? +optMatch[1] : 1;

    const durs = new Set();
    const re = /•\s*(\d+)\s*min/g;
    let dm;
    while ((dm = re.exec(text)) !== null) durs.add(+dm[1]);

    for (const dur of durs) {
      const clippedEnd = Math.min(startMin + dur, 23 * 60);
      const clippedDur = clippedEnd - startMin;
      if (clippedDur < 90) continue;
      const k = `${startMin}-${clippedDur}-${numCourts}`;
      if (seen.has(k)) continue;
      seen.add(k);
      raw.push({ startMin, durationMin: clippedDur, numCourts });
    }
  }

  // Dominance pruning per start.
  const byStart = new Map();
  for (const w of raw) {
    if (!byStart.has(w.startMin)) byStart.set(w.startMin, []);
    byStart.get(w.startMin).push(w);
  }
  const kept = [];
  for (const [, ws] of byStart) {
    ws.sort((a, b) => b.durationMin - a.durationMin);
    let maxCourts = 0;
    for (const w of ws) {
      if (w.numCourts > maxCourts) {
        kept.push(w);
        maxCourts = w.numCourts;
      }
    }
  }

  kept.sort((a, b) => a.startMin - b.startMin || a.durationMin - b.durationMin);
  return kept.map(w => ({
    start: fmt(w.startMin),
    end: fmt(w.startMin + w.durationMin),
    durationMin: w.durationMin,
    numCourts: w.numCourts,
  }));
}
