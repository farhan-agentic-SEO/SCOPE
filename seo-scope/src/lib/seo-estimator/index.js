/**
 * SEO estimation engine. Every output is ESTIMATED.
 *
 * Without Search Console, a SERP API or a clickstream panel there is no ground truth for
 * rankings, search volume or traffic. These functions produce wide, honest ranges from
 * on-site signals only, and confidence is capped accordingly. Plug real data in through
 * the `external` argument later (GSC, DataForSEO, etc.) to tighten ranges.
 *
 * Every estimate returns { value, min, max, confidence, methodology, signals }.
 */
import { STOP } from '../analyze/content.js';

const LEVELS = ['low', 'medium', 'high'];
const CTR = [0, 0.28, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const ctrAt = pos => pos <= 10 ? CTR[Math.max(1, Math.round(pos))] : pos <= 20 ? 0.008 : pos <= 50 ? 0.0015 : 0.0003;
const CPC = { medical: [2, 12], legal: [6, 45], finance: [4, 25], 'home-services': [3, 20], saas: [3, 15], ecommerce: [0.5, 2.5], publishing: [1, 6], marketing: [3, 18], general: [0.4, 2.5] };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const round2 = n => { if (!isFinite(n) || n <= 0) return 0; if (n < 10) return Math.round(n); const p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };
const est = (min, max, confidence, methodology, signals, extra = {}) => { min = round2(min); max = Math.max(min, round2(max)); return { value: round2((min + max) / 2), min, max, confidence, methodology, signals, basis: 'estimated', ...extra }; };

export function calculateConfidence({ evidenceCount = 0, completeness = 0, hasExternalData = false, chainedEstimates = 0 }) {
  let level = evidenceCount >= 60 && completeness >= 0.7 ? 2 : evidenceCount >= 25 && completeness >= 0.4 ? 1 : 0;
  if (!hasExternalData) level = Math.min(level, 1);  // never "high" from on-site signals alone
  level -= chainedEstimates;                        // each estimate built on another estimate loses a level
  return LEVELS[Math.max(0, level)];
}

/** Proxy for domain strength. Backlinks are UNAVAILABLE, so this uses weak on-site proxies only. */
function authorityProxy(report) {
  const idx = report.indexability.summary.indexable;
  const sameAs = report.schema.organization?.sameAs?.length || 0;
  const trust = report.trust.passed / report.trust.total;
  const sitemap = report.crawlability.sitemap?.totalUrls || 0;
  const a = 0.12 + 0.28 * clamp(Math.log10(Math.max(1, Math.max(idx, sitemap))) / 3) + 0.2 * trust + 0.1 * clamp(sameAs / 4);
  return { value: clamp(a, 0.1, 0.7), signals: [`${Math.max(idx, sitemap)} indexable or sitemap URLs`, `${report.trust.passed}/${report.trust.total} trust signals`, `${sameAs} sameAs profiles`, 'Backlink data unavailable, so authority is a weak proxy'] };
}

export function pageQuality(p, techScore) {
  const words = p.content?.uniqueWords || 0;
  const s = {
    depth: clamp(words / 1200), alignment: (p.topics?.alignmentScore || 0) / 100, inlinks: clamp(Math.log2(1 + (p.linkStats?.uniqueInlinkPages || 0)) / 5),
    clickDepth: p.clickDepth == null ? 0.3 : p.clickDepth <= 1 ? 1 : p.clickDepth === 2 ? 0.8 : p.clickDepth === 3 ? 0.6 : 0.4,
    onpage: [p.data.title, p.data.metaDescription, p.data.h1s[0]].filter(Boolean).length / 3, schema: p.data.schema.types.length ? 1 : 0, aeo: (p.aeo?.score || 0) / 100, technical: techScore / 100,
  };
  const q = 0.24 * s.depth + 0.18 * s.alignment + 0.18 * s.inlinks + 0.08 * s.clickDepth + 0.1 * s.onpage + 0.05 * s.schema + 0.07 * s.aeo + 0.1 * s.technical;
  return { q: clamp(q), s };
}

export function estimateSearchDemand(phrase, { local = false, industry = 'general', brand = null } = {}) {
  const words = phrase.split(' ').filter(w => !STOP.has(w));
  const n = Math.max(1, words.length);
  let [min, max] = n === 1 ? [3000, 60000] : n === 2 ? [400, 8000] : n === 3 ? [70, 1500] : [10, 300];
  const signals = [`${n} meaningful word${n > 1 ? 's' : ''} (shorter phrases are searched more)`];
  if (brand && phrase.includes(brand.toLowerCase())) { min = 30; max = 2000; signals.push('Contains the brand name'); }
  if (local || /\b(near me|in [a-z]+)\b/.test(phrase)) { min *= 0.15; max *= 0.25; signals.push('Local modifier narrows demand'); }
  if (/^(what|how|why|when|can|does|is|are)\b/.test(phrase)) { min *= 0.4; max *= 0.6; signals.push('Question phrasing'); }
  if (/\b(cost|price|best|near|treatment|services?|lawyer|attorney|repair)\b/.test(phrase)) { max *= 1.3; signals.push('Commercial modifier'); }
  const mid = Math.sqrt(min * max);
  return est(min, max, 'low', 'Heuristic from phrase length, modifiers and intent. No search volume database is used.', signals, { bucket: mid >= 2000 ? 'high' : mid >= 200 ? 'medium' : 'low', industry });
}

export function estimateRankingRange(p, { quality, authority, demand }) {
  const headTerm = demand.bucket === 'high';
  let s = quality.q * 0.6 + authority.value * 0.4 - (headTerm ? 0.18 : demand.bucket === 'medium' ? 0.06 : 0);
  if (!p.indexability.indexable) return { best: null, worst: null, label: 'Not eligible (not indexable)', confidence: 'high', basis: 'calculated' };
  const bands = [[0.72, 1, 5], [0.6, 3, 10], [0.48, 8, 20], [0.36, 15, 40], [0.25, 30, 70], [-1, 50, 100]];
  const [, best, worst] = bands.find(([t]) => s >= t);
  return { best, worst, label: `${best} to ${worst}`, score: +s.toFixed(2), confidence: 'low', basis: 'estimated', methodology: 'Band derived from page quality signals, a weak authority proxy and assumed competition for the phrase length. Not observed rankings.', signals: Object.entries(quality.s).map(([k, v]) => `${k}: ${Math.round(v * 100)}%`) };
}

export function estimateKeywordFootprint(report, pages, authority) {
  const idx = pages.filter(p => p.indexability.indexable);
  let min = 0, max = 0; const dist = { top3: [0, 0], top10: [0, 0], top20: [0, 0], top50: [0, 0], top100: [0, 0] };
  let local = 0, question = 0, branded = [0, 0];
  idx.forEach(p => {
    const q = p.quality.q; const qa = clamp(q * 0.6 + authority.value * 0.4);
    const headings = p.data.headings.filter(h => h.level >= 2).length;
    const mid = (3 + (p.content.uniqueWords || 0) / 110 + headings * 1.2) * (0.35 + q) * (0.4 + authority.value * 1.2);
    const lo = mid * 0.45, hi = mid * 1.7; min += lo; max += hi;
    const f = { top3: 0.02 + 0.12 * qa, top10: 0.08 + 0.25 * qa, top20: 0.18 + 0.27 * qa, top50: 0.45 + 0.2 * qa, top100: 1 };
    Object.keys(dist).forEach(k => { dist[k][0] += lo * f[k]; dist[k][1] += hi * f[k]; });
    if (p.topics?.intent === 'local' || p.pageType === 'location') local += mid;
    question += Math.min(mid, p.data.questionHeadings.length * 1.5);
  });
  const brandPages = Math.min(idx.length, 5);
  branded = [2 + brandPages, 10 + brandPages * 6];
  const conf = calculateConfidence({ evidenceCount: idx.length, completeness: 0.5, chainedEstimates: 0 });
  const signals = [`${idx.length} indexable pages`, `Average ${Math.round(idx.reduce((a, p) => a + (p.content.uniqueWords || 0), 0) / (idx.length || 1))} unique words per page`, ...authority.signals];
  const ranges = Object.fromEntries(Object.entries(dist).map(([k, [a, b]]) => [k, { min: round2(a), max: round2(b) }]));
  const ratioLocal = min ? local / ((min + max) / 2) : 0; const ratioQ = min ? question / ((min + max) / 2) : 0;
  return est(min, max, conf, 'Per page model: unique words, section count and quality set the number of long tail variations a page can plausibly rank for (top 100), scaled by an authority proxy. Summed across indexable pages.', signals, {
    distribution: ranges,
    branded: { min: branded[0], max: branded[1] },
    nonBranded: { min: round2(Math.max(0, min - branded[0])), max: round2(Math.max(0, max - branded[1])) },
    longTail: { min: round2(min * 0.6), max: round2(max * 0.8) },
    local: { min: round2(min * ratioLocal * 0.7), max: round2(max * ratioLocal) },
    question: { min: round2(min * clamp(ratioQ) * 0.6), max: round2(max * clamp(ratioQ)) },
  });
}

export function estimateOrganicTraffic(report, pages, { authority, brand, industry, isLocal }) {
  const idx = pages.filter(p => p.indexability.indexable);
  let min = 0, max = 0; const byIntent = {}; const perPage = [];
  idx.forEach(p => {
    const primary = p.topics?.primary; if (!primary) return;
    const demand = estimateSearchDemand(primary, { local: isLocal && (p.pageType === 'location' || p.topics.intent === 'local'), industry, brand });
    const rank = estimateRankingRange(p, { quality: p.quality, authority, demand });
    if (!rank.best) return;
    // Primary topic: pessimistic = low demand at worst rank; optimistic = high demand at best rank, damped
    const pMin = demand.min * ctrAt(rank.worst);
    const pMax = demand.max * ctrAt((rank.best + rank.worst) / 2) * 1.2;
    // Long tail: many low volume variants at a blended CTR
    const tailCount = p.keywordEstimate || 5;
    const blended = clamp(p.quality.q * 0.6 + authority.value * 0.4) * 0.03 + 0.002;
    const tMin = tailCount * 0.45 * 10 * blended; const tMax = tailCount * 1.7 * 60 * blended;
    const lo = pMin + tMin; const hi = pMax + tMax;
    min += lo; max += hi;
    const intent = p.topics.intent || 'informational';
    byIntent[intent] = byIntent[intent] || { min: 0, max: 0 }; byIntent[intent].min += lo; byIntent[intent].max += hi;
    perPage.push({ url: p.finalUrl, topic: primary, demand: { min: demand.min, max: demand.max, bucket: demand.bucket }, ranking: rank.label, traffic: { min: round2(lo), max: round2(hi) }, intent, quality: Math.round(p.quality.q * 100) });
  });
  const brandDemand = estimateSearchDemand(brand || '', { brand });
  const bMin = brand ? brandDemand.min * 0.45 : 0, bMax = brand ? brandDemand.max * 0.6 : 0;
  byIntent.branded = { min: bMin, max: bMax };
  min += bMin; max += bMax;
  const conf = calculateConfidence({ evidenceCount: idx.length, completeness: 0.4, chainedEstimates: 1 });
  const out = est(min, max, conf, 'Estimated demand range x click through rate at an estimated ranking band, per page primary topic, plus a long tail allowance and branded demand. Every input is itself an estimate.', [`${perPage.length} pages with a detectable primary topic`, `Industry profile: ${industry}`, 'No Search Console, rankings or clickstream data', ...authority.signals], {
    breakdown: Object.fromEntries(Object.entries(byIntent).map(([k, v]) => [k, { min: round2(v.min), max: round2(v.max) }])),
    nonBranded: { min: round2(min - bMin), max: round2(max - bMax) },
    pages: perPage.sort((a, b) => b.traffic.max - a.traffic.max),
  });
  return out;
}

export function estimateTrafficValue(traffic, industry) {
  const [cMin, cMax] = CPC[industry] || CPC.general;
  const b = traffic.breakdown || {};
  const factor = k => k === 'informational' || k === 'navigational' ? 0.3 : k === 'branded' ? 0.2 : 1;
  let min = 0, max = 0;
  Object.entries(b).forEach(([k, v]) => { min += v.min * cMin * factor(k); max += v.max * cMax * factor(k); });
  return est(min, max, calculateConfidence({ evidenceCount: 10, completeness: 0.3, chainedEstimates: 2 }), 'Estimated traffic by intent x an assumed cost per click range for the detected industry (informational and navigational discounted to 30%, branded to 20%). This is the cost to buy similar clicks, not revenue.', [`Industry CPC assumption: $${cMin} to $${cMax}`, 'Traffic value is not revenue'], { currency: 'USD' });
}

export function estimateTrafficOpportunity(report, pages, ctx, current) {
  const gains = [];
  const boosted = pages.map(p => {
    if (!p.indexability.indexable || !p.topics?.primary) return p;
    let g = 0; const why = [];
    if ((p.content.uniqueWords || 0) < 500 && !['contact', 'legal', 'home'].includes(p.pageType)) { g += 0.12; why.push('expand content'); }
    if ((p.linkStats?.uniqueInlinkPages || 0) <= 2) { g += 0.08; why.push('add internal links'); }
    if (p.topics.alignmentLevel !== 'high') { g += 0.05; why.push('align title, H1 and URL'); }
    if (!p.data.metaDescription || !p.data.h1s[0]) { g += 0.03; why.push('fix title/meta/H1'); }
    if ((p.clickDepth ?? 0) >= 4) { g += 0.04; why.push('reduce click depth'); }
    if (!p.data.schema.types.length) { g += 0.02; why.push('add schema'); }
    if (g) gains.push({ url: p.finalUrl, topic: p.topics.primary, actions: why, qualityGain: Math.round(g * 100) });
    return { ...p, quality: { ...p.quality, q: clamp(p.quality.q + g) } };
  });
  const potential = estimateOrganicTraffic(report, boosted, ctx);
  const deltaMin = Math.max(0, potential.min - current.max * 0.9);
  const deltaMax = Math.max(deltaMin, potential.max - current.min);
  return est(Math.max(0, potential.min - current.min), deltaMax, 'low', 'Re-runs the traffic model with page quality raised where fixable issues were found. Illustrates relative upside; not a forecast or guarantee.', ['Assumes fixes are implemented well', 'Competition is not modelled'], { current: { min: current.min, max: current.max }, potential: { min: potential.min, max: potential.max }, quickWins: gains.sort((a, b) => b.qualityGain - a.qualityGain).slice(0, 15) });
}

export function runEstimates(report, pages, ctx) {
  const techScore = report.scores?.categories?.technical?.score ?? 70;
  const idx = pages.filter(p => p.indexability.indexable && p.data);
  idx.forEach(p => { p.quality = pageQuality(p, techScore); const headings = p.data.headings.filter(h => h.level >= 2).length; p.keywordEstimate = Math.round((3 + (p.content.uniqueWords || 0) / 110 + headings * 1.2) * (0.35 + p.quality.q)); });
  const authority = authorityProxy(report);
  const brand = report.schema.organization?.name || ctx.brand || null;
  const industry = report.content.industry;
  const isLocal = !!report.local.isLocal;
  const keywords = estimateKeywordFootprint(report, idx, authority);
  const traffic = estimateOrganicTraffic(report, idx, { authority, brand, industry, isLocal });
  const value = estimateTrafficValue(traffic, industry);
  const opportunity = estimateTrafficOpportunity(report, idx, { authority, brand, industry, isLocal }, traffic);
  const topicDemand = (report.content.siteTopics || []).slice(0, 15).map(t => ({ phrase: t.phrase, ...estimateSearchDemand(t.phrase, { local: isLocal, industry, brand }) }));
  return { authorityProxy: authority, keywords, traffic, value, opportunity, topicDemand, disclaimer: 'All figures in this section are ESTIMATED from on-site signals. They are not Google data, not rankings, and not measured traffic. Connect Search Console to replace them with real numbers.' };
}
