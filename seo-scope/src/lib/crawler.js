import { fetchUrl } from './http.js';
import { extractPage } from './extract.js';
import { normalizeUrl, sameSite, NON_HTML_EXT } from './url.js';
import { isAllowed } from './robots.js';

/**
 * Priority crawl: homepage, then pages linked from navigation and the homepage,
 * then sitemap URLs, then deeper internal links. Bounded by crawl budget.
 */
export async function crawl({ startUrl, robots, sitemapUrls = [], limit = 100, concurrency = 5, timeout = 15000, respectRobots = true, onProgress = () => {} }) {
  const pages = new Map();          // normalized requested URL -> page record
  const queued = new Map();         // url -> {priority, depth, from}
  const blockedByRobots = [];
  const skipped = { nonHtmlLinks: new Set(), overBudget: 0 };
  const sitemapSet = new Set(sitemapUrls.map(u => normalizeUrl(u)).filter(Boolean));
  let fetched = 0;

  const enqueue = (url, depth, from, priority) => {
    const n = normalizeUrl(url); if (!n) return;
    if (!sameSite(n, startUrl)) return;
    if (NON_HTML_EXT.test(new URL(n).pathname)) { skipped.nonHtmlLinks.add(n); return; }
    if (pages.has(n)) return;
    const existing = queued.get(n);
    if (existing) { if (priority < existing.priority) Object.assign(existing, { priority, depth: Math.min(depth, existing.depth), from }); return; }
    if (respectRobots && robots?.parsed && !isAllowed(robots.parsed, n, 'seoscopebot').allowed) {
      if (!blockedByRobots.some(b => b.url === n)) blockedByRobots.push({ url: n, from, rule: isAllowed(robots.parsed, n, 'seoscopebot').rule });
      return;
    }
    queued.set(n, { url: n, priority, depth, from });
  };

  enqueue(startUrl, 0, null, 0);
  for (const u of sitemapSet) enqueue(u, 99, 'sitemap', 25);

  const next = () => {
    let best = null;
    for (const item of queued.values()) if (!best || item.priority < best.priority) best = item;
    if (best) queued.delete(best.url);
    return best;
  };

  async function processOne(item) {
    let res = await fetchUrl(item.url, { timeout });
    if (!res.ok && ['TIMEOUT', 'CONNECTION_RESET', 'NETWORK'].includes(res.errorCode)) res = await fetchUrl(item.url, { timeout });
    else if (res.ok && res.status >= 500) { await new Promise(r => setTimeout(r, 800)); const retry = await fetchUrl(item.url, { timeout }); if (retry.ok) res = retry; }
    fetched++;
    const finalN = normalizeUrl(res.finalUrl) || res.finalUrl;
    const isHtml = /html/i.test(res.contentType) || (!res.contentType && /<html/i.test(res.body.slice(0, 1000)));
    const record = {
      url: item.url, finalUrl: finalN, status: res.status, error: res.error || null, errorCode: res.errorCode || null,
      redirectChain: res.chain, redirected: res.chain.length > 0, ttfb: res.ttfb, time: res.time, bytes: res.bytes, truncated: !!res.truncated,
      contentType: res.contentType, depth: item.depth, discoveredFrom: item.from, inSitemap: sitemapSet.has(item.url) || sitemapSet.has(finalN),
      headers: pickHeaders(res.headers), isHtml, data: null,
    };
    if (res.ok && res.status === 200 && isHtml && res.body && !res.chain.length) {
      try { record.data = extractPage(res.body, finalN, res.headers); } catch (e) { record.error = 'Parse failed: ' + e.message; }
    }
    pages.set(item.url, record);
    // The redirect target is treated as its own page to crawl.
    if (record.redirected && finalN && sameSite(finalN, startUrl) && !pages.has(finalN)) enqueue(finalN, item.depth, item.url, item.depth * 10 + 1);
    if (record.data && !record.data.robots.nofollow) {
      for (const l of record.data.links) {
        if (l.kind !== 'internal') continue;
        const bonus = l.region === 'navigation' || l.region === 'header' ? -4 : l.region === 'content' ? -1 : 2;
        enqueue(l.href, item.depth + 1, finalN, (item.depth + 1) * 10 + bonus);
      }
    }
    onProgress({ fetched, queued: queued.size, current: item.url, limit });
  }

  const active = new Set();
  while (true) {
    while (queued.size && active.size < concurrency && pages.size + active.size < limit) {
      const item = next(); if (!item) break;
      const p = processOne(item)
        .catch(e => { pages.set(item.url, { url: item.url, finalUrl: item.url, status: 0, error: e.message, errorCode: 'CRAWLER', redirectChain: [], depth: item.depth, headers: {}, data: null }); })
        .finally(() => active.delete(p));
      active.add(p);
    }
    if (!active.size) break;
    await Promise.race(active);
  }
  await Promise.all(active);
  skipped.overBudget = queued.size;

  // Recompute click depth from the actual link graph (shortest path from homepage).
  const list = [...pages.values()];
  const byFinal = new Map(); list.forEach(p => { byFinal.set(p.finalUrl, p); byFinal.set(p.url, p); });
  const startN = normalizeUrl(startUrl); const startRec = pages.get(startN);
  const home = (startRec?.data ? startRec : byFinal.get(startRec?.finalUrl)) || list.find(p => p.data) || list[0];
  const depth = new Map(); const q = [];
  if (home) { depth.set(home.finalUrl, 0); q.push(home); }
  while (q.length) {
    const p = q.shift(); const d = depth.get(p.finalUrl);
    for (const l of p.data?.links || []) {
      if (l.kind !== 'internal') continue;
      const t = byFinal.get(l.href); if (!t) continue;
      const tf = t.redirected ? byFinal.get(t.finalUrl) || t : t;
      if (!depth.has(tf.finalUrl)) { depth.set(tf.finalUrl, d + 1); q.push(tf); }
    }
  }
  list.forEach(p => { p.clickDepth = depth.has(p.finalUrl) ? depth.get(p.finalUrl) : null; });

  return { pages: list, blockedByRobots, notCrawledInBudget: skipped.overBudget, nonHtmlLinks: [...skipped.nonHtmlLinks], homeUrl: home?.finalUrl };
}

function pickHeaders(h = {}) {
  const keep = ['server', 'x-powered-by', 'content-encoding', 'cache-control', 'expires', 'etag', 'last-modified', 'strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'x-robots-tag', 'content-type', 'vary', 'cf-ray', 'x-vercel-id', 'x-served-by', 'x-cache', 'via', 'x-shopify-stage', 'x-wix-request-id', 'x-nf-request-id', 'x-amz-cf-id', 'x-github-request-id', 'set-cookie', 'link', 'alt-svc'];
  return Object.fromEntries(Object.entries(h).filter(([k]) => keep.includes(k)).map(([k, v]) => [k, k === 'set-cookie' ? '[present]' : String(v).slice(0, 300)]));
}
