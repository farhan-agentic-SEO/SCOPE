import { isAllowed } from '../robots.js';
import { normalizeUrl, sameSite } from '../url.js';
import { issue, htmlPages } from './issue.js';

export function analyzeCrawlability(ctx) {
  const { robots, sitemap, pages, crawlResult, homeUrl } = ctx;
  const issues = []; const total = htmlPages(pages).length || 1;
  const data = { robots: { exists: robots.exists, status: robots.status, url: robots.url, agents: robots.agents, ruleCount: robots.ruleCount || 0, sitemaps: robots.sitemaps, problems: robots.problems, conflicts: robots.conflicts, wildcardRules: robots.wildcardRules || 0, crawlDelays: robots.crawlDelays || [], raw: robots.raw } };

  if (!robots.exists) {
    issues.push(issue({ id: 'robots-missing', category: 'crawlability', severity: robots.status >= 500 ? 'critical' : 'low', title: robots.status >= 500 ? 'robots.txt returns a server error' : 'No robots.txt file found', evidence: [{ url: robots.url, detail: `Status ${robots.status || robots.error}` }], why: robots.status >= 500 ? 'Google may stop crawling the entire site when robots.txt returns 5xx.' : 'Not required, but a robots.txt is the standard place to declare sitemaps and crawl rules.', fix: robots.status >= 500 ? 'Make robots.txt return 200 (or 404) immediately.' : 'Add a robots.txt that allows crawling and lists the sitemap URL.', affectsSite: true }));
  } else {
    if (robots.blocksEverything) issues.push(issue({ id: 'robots-blocks-all', category: 'crawlability', severity: 'critical', title: 'robots.txt blocks Googlebot from the entire site', evidence: [{ url: robots.url, detail: 'Disallow: / applies to Googlebot' }], why: 'Nothing on the site can be crawled, so pages cannot be ranked with content.', fix: 'Remove "Disallow: /" unless the site is intentionally private.', affectsSite: true }));
    if (robots.problems.length) issues.push(issue({ id: 'robots-syntax', category: 'crawlability', severity: 'low', title: 'robots.txt has lines search engines may ignore', evidence: robots.problems.map(p => ({ url: robots.url, detail: `Line ${p.line}: ${p.problem} (${p.text})` })), why: 'Invalid lines are silently ignored, which can leave rules not doing what you expect.', fix: 'Correct or remove the listed lines.' }));
    if (robots.conflicts.length) issues.push(issue({ id: 'robots-conflicts', category: 'crawlability', severity: 'low', title: 'robots.txt has conflicting Allow and Disallow rules', evidence: robots.conflicts.map(c => ({ url: robots.url, detail: `${c.path} for ${c.agents} (lines ${c.lines.join(', ')})` })), why: 'Conflicts resolve differently across crawlers.', fix: 'Keep a single rule per path.' }));
    if (!robots.sitemaps.length) issues.push(issue({ id: 'robots-no-sitemap', category: 'crawlability', severity: 'low', title: 'robots.txt does not declare a sitemap', evidence: [{ url: robots.url, detail: 'No Sitemap: line' }], why: 'Declaring the sitemap helps every crawler find it, not only Google.', fix: 'Add "Sitemap: https://yoursite/sitemap.xml" to robots.txt.', affectsSite: true }));
    if ((robots.crawlDelays || []).length) issues.push(issue({ id: 'robots-crawl-delay', category: 'crawlability', severity: 'low', title: 'Crawl-delay directive present', evidence: robots.crawlDelays.map(c => ({ url: robots.url, detail: `${c.agents}: ${c.delay}s` })), why: 'Google ignores crawl-delay, while Bing and others will crawl more slowly.', fix: 'Remove it unless your server genuinely needs throttling.' }));
  }

  // Googlebot and Bingbot blocking across discovered URLs
  if (robots.parsed) {
    const discovered = new Set([...pages.map(p => p.finalUrl), ...crawlResult.blockedByRobots.map(b => b.url), ...sitemap.urls.map(u => normalizeUrl(u.url)).filter(Boolean)]);
    const check = agent => [...discovered].filter(u => sameSite(u, homeUrl)).map(u => ({ u, r: isAllowed(robots.parsed, u, agent) })).filter(x => !x.r.allowed);
    const gb = check('googlebot'); const bb = check('bingbot');
    data.blockedGooglebot = gb.map(x => ({ url: x.u, rule: `${x.r.rule.type}: ${x.r.rule.path}` }));
    data.blockedBingbot = bb.length;
    const inSitemapBlocked = gb.filter(x => sitemap.urls.some(s => normalizeUrl(s.url) === x.u));
    if (gb.length) issues.push(issue({ id: 'googlebot-blocked-urls', category: 'crawlability', severity: inSitemapBlocked.length ? 'high' : 'medium', title: `Googlebot blocked from ${gb.length} discovered URL${gb.length > 1 ? 's' : ''}`, evidence: gb.map(x => ({ url: x.u, detail: `Matched ${x.r.rule.type}: ${x.r.rule.path}${inSitemapBlocked.includes(x) ? ' (also listed in sitemap)' : ''}` })), why: 'Blocked URLs cannot have their content read. If they are listed in the sitemap or linked internally, this is usually a mistake.', fix: 'Review the matched rules and allow any URL you want in search results.', totalPages: total }));
    // Resource blocking
    const resources = new Set();
    htmlPages(pages).slice(0, 30).forEach(p => { p.data.scripts.forEach(s => resources.add(s.src)); p.data.stylesheets.forEach(s => resources.add(s.href)); p.data.images.slice(0, 10).forEach(i => i.src && resources.add(i.src)); });
    const blockedRes = [...resources].filter(u => sameSite(u, homeUrl) && !isAllowed(robots.parsed, u, 'googlebot').allowed);
    data.blockedResources = blockedRes;
    if (blockedRes.length) issues.push(issue({ id: 'robots-blocks-resources', category: 'crawlability', severity: blockedRes.some(u => /\.(css|js)(\?|$)/.test(u)) ? 'high' : 'medium', title: 'robots.txt blocks CSS, JavaScript or images', evidence: blockedRes.map(u => ({ url: u, detail: 'Blocked for Googlebot' })), why: 'Google renders pages like a browser; blocked CSS and JS can make pages look broken or empty to it.', fix: 'Allow crawling of theme, plugin and asset folders.' }));
  }

  // Sitemap
  data.sitemap = { found: sitemap.found, declaredInRobots: sitemap.declaredInRobots, files: sitemap.sitemaps, totalUrls: sitemap.totalUrls, withLastmod: sitemap.withLastmod, capped: sitemap.capped };
  if (!sitemap.found) issues.push(issue({ id: 'sitemap-missing', category: 'crawlability', severity: 'medium', title: 'No XML sitemap found', evidence: [{ url: new URL('/sitemap.xml', homeUrl).href, detail: 'Checked robots.txt and common sitemap locations' }], why: 'Sitemaps help search engines find every important URL, especially deep or new pages.', fix: 'Generate an XML sitemap (most CMS SEO plugins do this) and reference it in robots.txt.', affectsSite: true }));
  else {
    const broken = sitemap.sitemaps.filter(s => s.problems.length);
    if (broken.length) issues.push(issue({ id: 'sitemap-file-problems', category: 'crawlability', severity: 'medium', title: 'Sitemap files have errors', evidence: broken.map(s => ({ url: s.url, detail: s.problems.join('; ') })), why: 'Invalid sitemap files are ignored.', fix: 'Fix the listed sitemap files or remove references to them.' }));
    const pageByUrl = new Map(); pages.forEach(p => { pageByUrl.set(p.url, p); });
    const smRows = sitemap.urls.map(u => ({ ...u, n: normalizeUrl(u.url), page: pageByUrl.get(normalizeUrl(u.url)) }));
    const bad = (id, filter, severity, title, detail, why, fix) => { const hits = smRows.filter(filter); if (hits.length) issues.push(issue({ id, category: 'crawlability', severity, title, evidence: hits.map(h => ({ url: h.url, detail: detail(h) })), why, fix, totalPages: sitemap.totalUrls })); };
    bad('sitemap-4xx', h => h.page && h.page.status >= 400, 'high', 'Sitemap lists URLs that return errors', h => `Status ${h.page.status}`, 'Sitemaps should only contain live, indexable URLs; errors reduce trust in the sitemap.', 'Remove or fix these URLs.');
    bad('sitemap-redirects', h => h.page && h.page.redirected, 'medium', 'Sitemap lists redirecting URLs', h => `Redirects to ${h.page.finalUrl}`, 'Listing redirects sends mixed signals about which URL is canonical.', 'Replace each with its final destination URL.');
    bad('sitemap-noindex', h => h.page && h.page.data?.robots.noindex, 'high', 'Sitemap lists noindex URLs', () => 'Page has noindex', 'You are asking Google to index pages that tell it not to.', 'Remove noindex pages from the sitemap or remove the noindex.');
    bad('sitemap-canonical-mismatch', h => h.page?.data?.canonical && h.page.data.canonical !== h.page.finalUrl, 'medium', 'Sitemap URLs canonicalize to a different URL', h => `Canonical: ${h.page.data.canonical}`, 'Sitemaps should list canonical URLs only.', 'List the canonical target instead.');
    bad('sitemap-http', h => h.url.startsWith('http://') && homeUrl.startsWith('https'), 'medium', 'Sitemap lists HTTP URLs on an HTTPS site', () => 'Uses http://', 'Every listed URL redirects, wasting crawl budget.', 'Regenerate the sitemap with https URLs.');
    bad('sitemap-duplicates', h => h.occurrences > 1, 'low', 'Duplicate URLs in sitemaps', h => `Listed ${h.occurrences} times`, 'Duplicates are harmless but point to a misconfigured generator.', 'Deduplicate sitemap entries.');
    bad('sitemap-lastmod', h => h.problems.some(p => /lastmod/.test(p)), 'low', 'Invalid or future lastmod dates', h => `${h.lastmod}: ${h.problems.join(', ')}`, 'Google ignores lastmod when it is consistently inaccurate.', 'Only set lastmod when page content actually changes.');
    bad('sitemap-offsite', h => h.n && !sameSite(h.n, homeUrl), 'medium', 'Sitemap lists URLs on another domain', () => 'Different host', 'Cross host sitemap URLs are ignored without verification.', 'Keep sitemap URLs on the same host.');
    // Sitemap vs crawler comparison
    const smSet = new Set(smRows.map(h => h.n));
    const crawledIndexable = htmlPages(pages).filter(p => p.indexability?.indexable);
    const notInSitemap = crawledIndexable.filter(p => !smSet.has(p.finalUrl));
    const smNotReached = smRows.filter(h => !h.page && sameSite(h.n || '', homeUrl));
    data.sitemapComparison = { sitemapUrls: sitemap.totalUrls, crawledUrls: htmlPages(pages).length, indexableNotInSitemap: notInSitemap.length, sitemapNotCrawled: smNotReached.length, note: smNotReached.length && crawlResult.notCrawledInBudget ? 'Some sitemap URLs were outside the crawl limit.' : null };
    if (notInSitemap.length) issues.push(issue({ id: 'indexable-not-in-sitemap', category: 'crawlability', severity: 'low', title: 'Indexable pages missing from the sitemap', evidence: notInSitemap.map(p => ({ url: p.finalUrl, detail: 'Found by crawling, not in any sitemap' })), why: 'Pages outside the sitemap depend on internal links alone to be discovered.', fix: 'Include every indexable page you want ranked.', totalPages: total }));
  }
  return { data, issues };
}

export function computeIndexability(ctx) {
  const { pages, robots, homeUrl } = ctx;
  const byUrl = new Map(); pages.forEach(p => { byUrl.set(p.url, p); if (!byUrl.has(p.finalUrl)) byUrl.set(p.finalUrl, p); });
  for (const p of pages) {
    const reasons = [];
    if (p.status !== 200) reasons.push(p.status ? `Status ${p.status}` : 'Unreachable');
    if (p.redirected) reasons.push('Redirects');
    if (p.status === 200 && !p.isHtml) reasons.push('Not HTML');
    const d = p.data;
    let canonical = null;
    if (d) {
      if (d.robots.noindex) reasons.push(d.robots.header?.includes('noindex') ? 'X-Robots-Tag noindex' : 'Meta robots noindex');
      if (robots.parsed && !isAllowed(robots.parsed, p.finalUrl, 'googlebot').allowed) reasons.push('Blocked by robots.txt');
      if (d.canonical) {
        const target = byUrl.get(d.canonical);
        canonical = { target: d.canonical, self: d.canonical === p.finalUrl, crossDomain: !sameSite(d.canonical, homeUrl), targetStatus: target ? target.status : null, targetRedirects: target?.redirected || false, targetNoindex: target?.data?.robots.noindex || false, multiple: new Set(d.canonicals).size > 1, httpMismatch: homeUrl.startsWith('https') && d.canonical.startsWith('http:'), hostMismatch: sameSite(d.canonical, homeUrl) && new URL(d.canonical).hostname !== new URL(p.finalUrl).hostname };
        if (!canonical.self) reasons.push('Canonicalized to another URL');
      }
    }
    p.indexability = { indexable: reasons.length === 0, reasons, canonical };
  }
}

export function analyzeIndexability(ctx) {
  const { pages } = ctx; const issues = [];
  const html = htmlPages(pages); const total = html.length || 1;
  const summary = { indexable: 0, noindex: 0, blocked: 0, canonicalized: 0, redirected: pages.filter(p => p.redirected).length, errors: pages.filter(p => !p.redirected && p.status !== 200).length, total: pages.length };
  html.forEach(p => { const r = p.indexability.reasons; if (!r.length) summary.indexable++; if (r.some(x => /noindex/.test(x))) summary.noindex++; if (r.includes('Blocked by robots.txt')) summary.blocked++; if (r.includes('Canonicalized to another URL')) summary.canonicalized++; });
  summary.robotsBlockedNotCrawled = ctx.crawlResult.blockedByRobots.length;

  const noindex = html.filter(p => p.data.robots.noindex);
  const importantNoindex = noindex.filter(p => p.clickDepth !== null && p.clickDepth <= 1);
  if (noindex.some(p => p.finalUrl === ctx.homeUrl)) issues.push(issue({ id: 'home-noindex', category: 'indexability', severity: 'critical', title: 'Homepage is set to noindex', evidence: [{ url: ctx.homeUrl, detail: noindex.find(p => p.finalUrl === ctx.homeUrl).data.robots.meta || 'X-Robots-Tag' }], why: 'The homepage will be removed from search results.', fix: 'Remove the noindex directive (check the CMS "discourage search engines" setting).', affectsSite: true }));
  if (noindex.length) issues.push(issue({ id: 'noindex-pages', category: 'indexability', severity: importantNoindex.length ? 'high' : 'low', title: `${noindex.length} page${noindex.length > 1 ? 's are' : ' is'} set to noindex`, evidence: noindex.map(p => ({ url: p.finalUrl, detail: `${p.data.robots.meta || p.data.robots.header}${p.clickDepth !== null && p.clickDepth <= 1 ? ' (linked from homepage or navigation)' : ''}` })), why: 'Fine for thank you, login and filter pages, but a mistake on pages you want to rank.', fix: 'Confirm each page is intentionally excluded; remove noindex where it is not.', totalPages: total }));
  const nofollowPages = html.filter(p => p.data.robots.nofollow);
  if (nofollowPages.length) issues.push(issue({ id: 'nofollow-pages', category: 'indexability', severity: 'medium', title: 'Pages use meta nofollow', evidence: nofollowPages.map(p => ({ url: p.finalUrl, detail: p.data.robots.meta || p.data.robots.header })), why: 'Links on these pages will not pass signals to your other pages.', fix: 'Remove nofollow unless you have a specific reason.', totalPages: total }));

  const withCanon = html.filter(p => p.indexability.canonical);
  const missingCanon = html.filter(p => !p.indexability.canonical && !p.data.robots.noindex);
  if (missingCanon.length) issues.push(issue({ id: 'canonical-missing', category: 'indexability', severity: missingCanon.length / total > 0.5 ? 'medium' : 'low', title: 'Pages without a canonical tag', evidence: missingCanon.map(p => ({ url: p.finalUrl, detail: 'No rel=canonical' })), why: 'Self referencing canonicals protect against duplicates created by parameters and tracking links.', fix: 'Add a self referencing canonical to every indexable page.', totalPages: total }));
  const c = (id, test, severity, title, detail, why, fix) => { const hits = withCanon.filter(p => test(p.indexability.canonical, p)); if (hits.length) issues.push(issue({ id, category: 'indexability', severity, title, evidence: hits.map(p => ({ url: p.finalUrl, detail: detail(p.indexability.canonical) })), why, fix, totalPages: total })); };
  c('canonical-to-error', k => k.targetStatus && k.targetStatus >= 400, 'high', 'Canonical points to an error page', k => `${k.target} returns ${k.targetStatus}`, 'Google ignores canonicals that point to broken URLs and may pick its own.', 'Point the canonical to a live 200 URL.');
  c('canonical-to-redirect', k => k.targetRedirects, 'medium', 'Canonical points to a redirecting URL', k => k.target, 'Canonical targets should be final URLs.', 'Update to the redirect destination.');
  c('canonical-to-noindex', k => k.targetNoindex, 'high', 'Canonical points to a noindex page', k => k.target, 'Conflicting signals: consolidate to a page that says it should not be indexed.', 'Point to an indexable page or remove the noindex.');
  c('canonical-cross-domain', k => k.crossDomain, 'medium', 'Canonical points to a different domain', k => k.target, 'Pages hand their ranking to another site; correct for syndication, wrong otherwise.', 'Confirm this is intentional.');
  c('canonical-multiple', k => k.multiple, 'high', 'Multiple different canonical tags on one page', () => 'More than one rel=canonical', 'Google ignores all canonicals when they conflict.', 'Output a single canonical (often two SEO plugins are both active).');
  c('canonical-protocol-host', k => k.httpMismatch || k.hostMismatch, 'medium', 'Canonical uses the wrong protocol or hostname', k => k.target, 'Canonicals pointing to http or the other www variant point at redirects.', 'Use the exact preferred protocol and hostname.');
  const canonicalized = withCanon.filter(p => !p.indexability.canonical.self && !p.indexability.canonical.crossDomain);
  if (canonicalized.length) issues.push(issue({ id: 'canonicalized-pages', category: 'indexability', severity: 'low', title: 'Pages canonicalized to a different URL', evidence: canonicalized.map(p => ({ url: p.finalUrl, detail: `Canonical: ${p.indexability.canonical.target}` })), why: 'These pages will not rank themselves. Check that each points to a true duplicate.', fix: 'Keep canonicals only on real duplicates; make unique pages self canonical.', totalPages: total }));

  // Internal links pointing to canonicalized or noindex pages
  return { data: { summary }, issues };
}
