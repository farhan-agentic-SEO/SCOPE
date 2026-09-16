import * as cheerio from 'cheerio';
import { fetchUrl } from './http.js';

const DEFAULTS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-index.xml'];

export async function discoverSitemaps(origin, robotsSitemaps = [], { maxSitemaps = 25, maxUrls = 5000 } = {}) {
  const candidates = [...new Set([...robotsSitemaps, ...DEFAULTS.map(p => new URL(p, origin).href)])];
  const sitemaps = []; const urls = new Map(); const visited = new Set();
  const queue = candidates.map(u => ({ url: u, source: robotsSitemaps.includes(u) ? 'robots.txt' : 'default location', parent: null }));

  while (queue.length && visited.size < maxSitemaps) {
    const item = queue.shift();
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    const res = await fetchUrl(item.url, { timeout: 15000, maxBytes: 20_000_000 });
    const entry = { url: item.url, source: item.source, parent: item.parent, status: res.status, error: res.error, type: null, urlCount: 0, valid: false, problems: [], bytes: res.bytes, redirected: res.chain.length > 0 };
    // Default locations that 404 are only informational
    if (!res.ok || res.status !== 200) {
      if (item.source !== 'default location') { entry.problems.push(`Returned ${res.status || res.errorCode}`); sitemaps.push(entry); }
      continue;
    }
    if (/\.gz$/i.test(item.url)) { entry.problems.push('Gzipped sitemap was not decompressed by this audit'); sitemaps.push(entry); continue; }
    const body = res.body.trim();
    if (!/<(urlset|sitemapindex)[\s>]/i.test(body)) {
      if (item.source !== 'default location' || /<\?xml/.test(body)) { entry.problems.push('Response is not a valid XML sitemap (no <urlset> or <sitemapindex> root)'); sitemaps.push(entry); }
      continue;
    }
    if (!/^(<\?xml|<urlset|<sitemapindex|<!--)/i.test(body)) entry.problems.push('Content before the XML root element');
    if (res.bytes > 50 * 1024 * 1024) entry.problems.push('Larger than the 50MB sitemap limit');
    entry.valid = true;
    const $ = cheerio.load(body, { xml: true });
    if ($('sitemapindex').length) {
      entry.type = 'index';
      $('sitemap > loc').each((_, el) => { const loc = $(el).text().trim(); entry.urlCount++; if (loc) queue.unshift({ url: loc, source: 'sitemap index', parent: item.url }); });
    } else {
      entry.type = 'urlset';
      $('url').each((_, el) => {
        const loc = $(el).find('loc').first().text().trim();
        const lastmod = $(el).find('lastmod').first().text().trim() || null;
        entry.urlCount++;
        if (!loc || urls.size >= maxUrls) return;
        const rec = urls.get(loc) || { url: loc, lastmod, sitemaps: [], occurrences: 0, problems: [] };
        rec.occurrences++; rec.sitemaps.push(item.url);
        try { new URL(loc); } catch { rec.problems.push('Invalid URL'); }
        if (lastmod) {
          const d = new Date(lastmod);
          if (isNaN(d)) rec.problems.push('Invalid lastmod'); else if (d.getTime() > Date.now() + 86400000) rec.problems.push('lastmod is in the future');
        }
        urls.set(loc, rec);
      });
      if (entry.urlCount > 50000) entry.problems.push('More than 50,000 URLs in one sitemap');
    }
    sitemaps.push(entry);
  }
  const list = [...urls.values()];
  return {
    found: sitemaps.some(s => s.valid), sitemaps, urls: list,
    declaredInRobots: robotsSitemaps.length > 0,
    totalUrls: list.length, capped: urls.size >= maxUrls,
    httpUrls: list.filter(u => u.url.startsWith('http://')).length,
    duplicates: list.filter(u => u.occurrences > 1).length,
    invalidLastmod: list.filter(u => u.problems.includes('Invalid lastmod')).length,
    futureLastmod: list.filter(u => u.problems.includes('lastmod is in the future')).length,
    withLastmod: list.filter(u => u.lastmod).length,
  };
}
