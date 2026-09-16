import { issue, htmlPages } from './issue.js';
import { sameSite } from '../url.js';

/**
 * Lab and field data from the free public PageSpeed Insights API (no key required at low volume).
 * If it is unavailable, the report falls back to metrics measured from raw HTML and marks lab metrics UNAVAILABLE.
 */
async function pageSpeed(url, strategy) {
  if (process.env.ENABLE_PAGESPEED === 'false') return { available: false, reason: 'Disabled with ENABLE_PAGESPEED=false' };
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url); api.searchParams.set('strategy', strategy);
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach(c => api.searchParams.append('category', c));
  if (process.env.PSI_API_KEY) api.searchParams.set('key', process.env.PSI_API_KEY);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(api, { signal: ctrl.signal });
    if (!res.ok) return { available: false, reason: `PageSpeed Insights returned ${res.status}${res.status === 429 ? ' (free quota reached; set PSI_API_KEY to raise it)' : ''}` };
    const j = await res.json(); const lr = j.lighthouseResult; const a = lr.audits;
    const num = id => a[id]?.numericValue ?? null;
    const opp = Object.values(a).filter(x => x.details?.type === 'opportunity' && x.numericValue > 100).sort((x, y) => y.numericValue - x.numericValue).slice(0, 8).map(x => ({ id: x.id, title: x.title, savingsMs: Math.round(x.numericValue), display: x.displayValue || '' }));
    const field = j.loadingExperience?.metrics ? Object.fromEntries(Object.entries(j.loadingExperience.metrics).map(([k, v]) => [k, { p75: v.percentile, category: v.category }])) : null;
    return {
      available: true, strategy, fetchedAt: lr.fetchTime,
      scores: Object.fromEntries(Object.entries(lr.categories).map(([k, v]) => [k, Math.round((v.score || 0) * 100)])),
      lab: { lcp: num('largest-contentful-paint'), fcp: num('first-contentful-paint'), cls: num('cumulative-layout-shift'), tbt: num('total-blocking-time'), speedIndex: num('speed-index'), ttfb: num('server-response-time'), domSize: num('dom-size'), requests: a['network-requests']?.details?.items?.length ?? null, totalBytes: num('total-byte-weight'), unusedJs: num('unused-javascript'), unusedCss: num('unused-css-rules'), renderBlocking: num('render-blocking-resources'), thirdParty: a['third-party-summary']?.details?.items?.length ?? null },
      field, fieldOrigin: j.originLoadingExperience?.metrics ? Object.fromEntries(Object.entries(j.originLoadingExperience.metrics).map(([k, v]) => [k, { p75: v.percentile, category: v.category }])) : null,
      opportunities: opp,
    };
  } catch (e) { return { available: false, reason: e.name === 'AbortError' ? 'PageSpeed Insights timed out' : 'PageSpeed Insights could not be reached: ' + e.message }; }
  finally { clearTimeout(t); }
}

export async function analyzePerformance(ctx) {
  const { pages, homeUrl } = ctx; const issues = []; const html = htmlPages(pages); const total = html.length || 1;
  const [mobile, desktop] = await Promise.all([pageSpeed(homeUrl, 'mobile'), pageSpeed(homeUrl, 'desktop')]);
  const perPage = html.map(p => {
    const d = p.data;
    const blocking = d.scripts.filter(s => s.inHead && !s.async && !s.defer).length + d.stylesheets.filter(s => !s.media || s.media === 'all').length;
    const thirdParty = [...new Set(d.scripts.filter(s => !sameSite(s.src, homeUrl)).map(s => new URL(s.src).hostname))];
    return { url: p.finalUrl, ttfb: p.ttfb, htmlKb: Math.round(d.htmlBytes / 1024), domElements: d.domElements, scripts: d.scripts.length, stylesheets: d.stylesheets.length, renderBlocking: blocking, thirdPartyHosts: thirdParty, images: d.images.length, inlineScriptKb: Math.round(d.inlineScriptBytes / 1024) };
  });
  const add = o => { if (o.evidence.length) issues.push(issue({ category: 'performance', totalPages: total, ...o })); };
  add({ id: 'large-dom', severity: 'low', title: 'Very large DOM (over 1,500 elements)', evidence: perPage.filter(x => x.domElements > 1500).map(x => ({ url: x.url, detail: `${x.domElements} elements` })), why: 'Large DOMs slow rendering and interaction (INP).', fix: 'Simplify page builder nesting and remove hidden duplicate sections.' });
  add({ id: 'render-blocking', severity: 'medium', title: 'Many render blocking scripts and stylesheets', evidence: perPage.filter(x => x.renderBlocking > 6).map(x => ({ url: x.url, detail: `${x.renderBlocking} blocking resources in the head` })), why: 'The browser cannot paint until these load, delaying FCP and LCP.', fix: 'Defer non critical JavaScript, inline critical CSS and combine small stylesheets.', effort: 'medium' });
  add({ id: 'heavy-html', severity: 'low', title: 'HTML documents over 500 KB', evidence: perPage.filter(x => x.htmlKb > 500).map(x => ({ url: x.url, detail: `${x.htmlKb} KB (${x.inlineScriptKb} KB inline script)` })), why: 'Heavy HTML delays parsing and first paint.', fix: 'Move inline data and scripts to cached external files.' });
  add({ id: 'many-third-party', severity: 'low', title: 'Many third party script domains', evidence: perPage.filter(x => x.thirdPartyHosts.length > 8).map(x => ({ url: x.url, detail: `${x.thirdPartyHosts.length} domains: ${x.thirdPartyHosts.slice(0, 5).join(', ')}` })), why: 'Each third party adds DNS, connection and execution cost.', fix: 'Remove unused tags and load the rest after interaction where possible.' });
  if (mobile.available) {
    const m = mobile.lab;
    if (mobile.scores.performance < 50) add({ id: 'psi-mobile-poor', severity: 'high', title: `Mobile Lighthouse performance score is ${mobile.scores.performance}`, evidence: [{ url: homeUrl, detail: `LCP ${(m.lcp / 1000).toFixed(1)}s, TBT ${Math.round(m.tbt)}ms, CLS ${m.cls?.toFixed(2)}` }], why: 'Slow mobile experiences lose visitors and weaken page experience signals.', fix: 'Start with the top PageSpeed opportunities listed in the report.', effort: 'medium', affectsSite: true });
    if (m.lcp > 2500) add({ id: 'lcp-slow', severity: m.lcp > 4000 ? 'high' : 'medium', title: `Lab LCP is ${(m.lcp / 1000).toFixed(1)}s on mobile (target under 2.5s)`, evidence: [{ url: homeUrl, detail: 'Lighthouse mobile lab data' }], why: 'LCP is a Core Web Vital.', fix: 'Optimize and preload the hero image, reduce server time, defer blocking resources.', affectsSite: true });
    if (m.cls > 0.1) add({ id: 'cls-high', severity: m.cls > 0.25 ? 'high' : 'medium', title: `Layout shift (CLS ${m.cls.toFixed(2)}) above 0.1`, evidence: [{ url: homeUrl, detail: 'Lighthouse mobile lab data' }], why: 'CLS is a Core Web Vital; shifting layouts cause misclicks.', fix: 'Reserve space for images, embeds, banners and web fonts.', affectsSite: true });
    const inp = mobile.field?.INTERACTION_TO_NEXT_PAINT;
    if (inp && inp.p75 > 200) add({ id: 'inp-slow', severity: inp.p75 > 500 ? 'high' : 'medium', title: `Real user INP is ${inp.p75}ms (target under 200ms)`, evidence: [{ url: homeUrl, detail: 'Chrome UX Report field data via PageSpeed Insights' }], why: 'INP is the Core Web Vital for responsiveness.', fix: 'Break up long JavaScript tasks and reduce third party scripts.', affectsSite: true });
  }
  return { data: { pageSpeed: { mobile, desktop }, perPage, medians: medians(perPage), note: mobile.available ? 'Lab metrics from Lighthouse via the free PageSpeed Insights API for the homepage. Field data appears only when Chrome has enough real user samples.' : `Lab metrics unavailable: ${mobile.reason}. Showing metrics measured from raw HTML only.` }, issues };
}

function medians(rows) {
  const med = k => { const v = rows.map(r => r[k]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  return { ttfb: med('ttfb'), htmlKb: med('htmlKb'), domElements: med('domElements'), scripts: med('scripts'), renderBlocking: med('renderBlocking') };
}
