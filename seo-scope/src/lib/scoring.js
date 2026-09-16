// CALCULATED scores. Traffic and estimates are deliberately excluded from SEO Health.
import { SEVERITY_RANK } from './analyze/issue.js';

export const WEIGHTS = { technical: 15, crawlability: 10, indexability: 10, onpage: 15, content: 15, links: 10, schema: 8, performance: 7, mobile: 3, trust: 3, aeogeo: 4 };
export const LABELS = { technical: 'Technical SEO', crawlability: 'Crawlability', indexability: 'Indexability', onpage: 'On page SEO', content: 'Content', links: 'Internal linking', schema: 'Structured data', performance: 'Performance', mobile: 'Mobile', trust: 'Trust and experience signals', aeogeo: 'AEO and AI search readiness' };
const MAP = { security: 'technical', international: 'technical', social: 'onpage', llms: 'aeogeo' };
const BASE = { critical: 45, high: 22, medium: 9, low: 3 };

function penalty(i) {
  const base = BASE[i.severity];
  if (i.affectsSite || i.ratio == null) return base;
  return base * (0.3 + 0.7 * Math.sqrt(i.ratio));
}

export function scoreReport(issues, extras) {
  const categories = {};
  for (const key of Object.keys(WEIGHTS)) {
    const own = issues.filter(i => (MAP[i.category] || i.category) === key);
    let score = 100 - own.reduce((a, i) => a + penalty(i), 0);
    // Blend in measured or heuristic sub-scores where they exist
    if (key === 'performance' && extras.psiMobile != null) score = 0.6 * extras.psiMobile + 0.4 * score;
    if (key === 'trust') score = 0.7 * extras.trust + 0.3 * score;
    if (key === 'aeogeo') score = 0.35 * extras.aeo + 0.45 * extras.geo + 0.2 * Math.max(score, 0) * (extras.llms != null ? 1 : 1);
    score = Math.round(Math.max(0, Math.min(100, score)));
    categories[key] = { key, label: LABELS[key], score, weight: WEIGHTS[key], points: +(score * WEIGHTS[key] / 100).toFixed(1), issues: own.length, critical: own.filter(i => i.severity === 'critical').length, basis: 'calculated' };
  }
  const total = Math.round(Object.values(categories).reduce((a, c) => a + c.points, 0));
  const anyCritical = issues.some(i => i.severity === 'critical');
  return { health: anyCritical ? Math.min(total, 69) : total, rawHealth: total, cappedByCritical: anyCritical && total > 69, grade: total >= 90 ? 'Excellent' : total >= 75 ? 'Good' : total >= 55 ? 'Needs work' : 'Poor', categories, basis: 'calculated', method: 'Each category starts at 100 and loses points per issue, scaled by severity and the share of pages affected. Categories are weighted to 100. A critical issue caps the total at 69.' };
}

export function pageScore(page, issues) {
  const mine = issues.filter(i => !i.affectsSite && !['llms', 'aeogeo', 'trust', 'local'].includes(i.category) && i.evidence.some(e => e.url === page.finalUrl));
  const s = Math.max(0, 100 - mine.reduce((a, i) => a + ({ critical: 30, high: 12, medium: 5, low: 2 })[i.severity], 0));
  return { score: Math.round(s), issues: mine.map(i => ({ id: i.id, title: i.title, severity: i.severity, category: i.category, detail: i.evidence.find(e => e.url === page.finalUrl)?.detail })).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) };
}

export function buildOpportunities(issues, estimates) {
  const effortRank = { low: 0, medium: 1, high: 2 }; const impactRank = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || impactRank[a.impact] - impactRank[b.impact] || effortRank[a.effort] - effortRank[b.effort] || b.count - a.count);
  const priority = i => i.severity === 'critical' ? 'Critical' : i.severity === 'high' ? 'High impact' : i.severity === 'medium' ? 'Medium' : 'Low';
  const groups = { Critical: [], 'High impact': [], Medium: [], Low: [] };
  sorted.forEach(i => groups[priority(i)].push({ id: i.id, issue: i.title, category: i.category, urls: [...new Set(i.evidence.map(e => e.url))].slice(0, 20), evidence: i.evidence.slice(0, 10), count: i.count, why: i.why, fix: i.fix, impact: i.impact, effort: i.effort, priority: priority(i), basis: i.basis }));
  const quickWins = (estimates?.opportunity?.quickWins || []).map(q => ({ ...q, basis: 'estimated' }));
  return { groups, quickWins, total: issues.length };
}
