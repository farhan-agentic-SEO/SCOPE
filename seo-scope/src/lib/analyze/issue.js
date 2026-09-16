export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** Standard issue record used by every analyzer and by the opportunity engine. */
export function issue({ id, category, severity, title, evidence = [], why, fix, impact, effort = 'low', basis = 'measured', affectsSite = false, totalPages }) {
  const ev = evidence.slice(0, 200);
  return { id, category, severity, title, count: evidence.length, evidence: ev, why, fix, impact: impact || ({ critical: 'high', high: 'high', medium: 'medium', low: 'low' })[severity], effort, basis, affectsSite, ratio: totalPages ? Math.min(1, evidence.length / totalPages) : null };
}

export const htmlPages = pages => pages.filter(p => p.status === 200 && p.data);
export const indexable = pages => htmlPages(pages).filter(p => p.indexability?.indexable);
export const shortPath = u => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
