import { fetchUrl } from './http.js';
import { normalizeInput, normalizeUrl } from './url.js';
import { loadRobots } from './robots.js';
import { discoverSitemaps } from './sitemap.js';
import { crawl } from './crawler.js';
import { analyzeTechnical } from './analyze/technical.js';
import { analyzeCrawlability, computeIndexability, analyzeIndexability } from './analyze/indexability.js';
import { analyzeOnPage } from './analyze/onpage.js';
import { analyzeContent } from './analyze/content.js';
import { analyzeLinks } from './analyze/links.js';
import { analyzeSchema } from './analyze/schema.js';
import { analyzeTrust, analyzeLocal, analyzeAeo, analyzeGeo, analyzeJsSeo } from './analyze/signals.js';
import { analyzeLlms } from './analyze/llms.js';
import { analyzePerformance } from './analyze/performance.js';
import { runEstimates } from './seo-estimator/index.js';
import { scoreReport, pageScore, buildOpportunities } from './scoring.js';
import { htmlPages } from './analyze/issue.js';

export const STAGES = ['Validating URL', 'Reading robots.txt', 'Discovering sitemaps', 'Crawling pages', 'Checking technical setup', 'Analyzing indexability and on page SEO', 'Analyzing content and topics', 'Checking links and resources', 'Analyzing schema, trust and local signals', 'Checking llms.txt', 'Measuring performance', 'Scoring and estimating', 'Building report'];

export async function runAudit(rawUrl, { limit = Number(process.env.CRAWL_LIMIT || 100), onStage = () => {}, onLog = () => {} } = {}) {
  const t0 = Date.now();
  const stage = (i, extra = 0) => onStage({ stage: STAGES[i], index: i, progress: Math.round(((i + extra) / STAGES.length) * 100) });

  stage(0);
  const input = normalizeInput(rawUrl);
  const first = await fetchUrl(input, { timeout: 20000 });
  if (!first.ok) throw new Error(`Could not reach ${input}: ${first.error}. Check the address, or the site may block automated requests.`);
  if (first.status >= 400) throw new Error(`${input} returned HTTP ${first.status}. The homepage must be publicly reachable to run an audit.`);
  const homeUrl = normalizeUrl(first.finalUrl);
  const origin = new URL(homeUrl).origin;
  onLog(`Homepage resolved to ${homeUrl}${first.chain.length ? ` after ${first.chain.length} redirect(s)` : ''}`);

  stage(1); const robots = await loadRobots(origin);
  onLog(robots.exists ? `robots.txt found with ${robots.ruleCount} rules` : `robots.txt not found (${robots.status || robots.error})`);
  stage(2); const sitemap = await discoverSitemaps(origin, robots.sitemaps);
  onLog(sitemap.found ? `${sitemap.totalUrls} URLs in ${sitemap.sitemaps.filter(s => s.valid).length} sitemap file(s)` : 'No XML sitemap found');

  stage(3);
  const crawlResult = await crawl({ startUrl: homeUrl, robots, sitemapUrls: sitemap.urls.map(u => u.url), limit, onProgress: ({ fetched }) => onStage({ stage: `Crawling pages (${fetched}/${limit})`, index: 3, progress: Math.round(((3 + Math.min(1, fetched / limit)) / STAGES.length) * 100) }) });
  const pages = crawlResult.pages;
  const homeRecord = pages.find(p => p.finalUrl === crawlResult.homeUrl && p.data) || pages.find(p => p.data);
  const ctx = { input, homeUrl: homeRecord?.finalUrl || homeUrl, homeRecord, homeHtml: first.body, pages, robots, sitemap, crawlResult };
  onLog(`Crawled ${pages.length} URLs (${htmlPages(pages).length} HTML pages)`);

  stage(4); const technical = await analyzeTechnical(ctx);
  stage(5); computeIndexability(ctx);
  const content = analyzeContent(ctx);           // assigns page types used by later analyzers
  const crawlability = analyzeCrawlability(ctx);
  const indexability = analyzeIndexability(ctx);
  const onpage = analyzeOnPage(ctx);
  stage(6); const jsSeo = analyzeJsSeo(ctx);
  stage(7); const links = await analyzeLinks(ctx, { onProgress: (d, t) => onStage({ stage: `Checking links and resources (${d}/${t})`, index: 7, progress: Math.round(((7 + d / Math.max(1, t)) / STAGES.length) * 100) }) });
  stage(8); const schema = analyzeSchema(ctx); const trust = analyzeTrust(ctx); const local = analyzeLocal(ctx); const aeo = analyzeAeo(ctx);
  stage(9); const llms = await analyzeLlms(ctx);
  const geo = analyzeGeo(ctx, { trust, schema, llms });
  stage(10); const performance = await analyzePerformance(ctx);

  stage(11);
  const allIssues = [technical, crawlability, indexability, onpage, content, jsSeo, links, schema, trust, local, aeo, llms, geo, performance].flatMap(a => a.issues);
  const scores = scoreReport(allIssues, { psiMobile: performance.data.pageSpeed.mobile.available ? performance.data.pageSpeed.mobile.scores.performance : null, trust: trust.data.score, aeo: aeo.data.score, geo: geo.data.score, llms: llms.data.score });
  const partial = { indexability: indexability.data, schema: schema.data, trust: trust.data, crawlability: crawlability.data, content: content.data, local: local.data, scores };
  const brand = schema.data.organization?.name || onpage.data.brandSuffix || null;
  const estimates = runEstimates(partial, htmlPages(pages), { brand });
  const opportunities = buildOpportunities(allIssues, estimates);

  stage(12);
  const estByUrl = new Map((estimates.traffic.pages || []).map(p => [p.url, p]));
  const pageRows = pages.map(p => {
    const base = { url: p.url, finalUrl: p.finalUrl, status: p.status, redirected: p.redirected, redirectChain: p.redirectChain, error: p.error, ttfb: p.ttfb, bytes: p.bytes, contentType: p.contentType, clickDepth: p.clickDepth, inSitemap: p.inSitemap, discoveredFrom: p.discoveredFrom, headers: p.headers, indexability: p.indexability };
    if (!p.data) return base;
    const d = p.data; const ps = pageScore(p, allIssues);
    const checks = { title: !!d.title && d.title.length >= 30 && d.title.length <= 60, meta: !!d.metaDescription && d.metaDescription.length >= 70 && d.metaDescription.length <= 160, h1: d.h1s.length === 1 && !!d.h1s[0], canonical: !!p.indexability.canonical?.self, viewport: !!d.viewport, schema: d.schema.types.length > 0, og: !!(d.og.title && d.og.image), altText: d.images.every(i => i.hasAlt) };
    return {
      ...base, pageType: p.pageType, score: ps.score, issues: ps.issues, checks,
      title: d.title, metaDescription: d.metaDescription, h1s: d.h1s, headings: d.headings.slice(0, 60), lang: d.lang, robots: d.robots, canonical: d.canonical, og: d.og, twitter: d.twitter, hreflang: d.hreflang,
      content: p.content, topics: p.topics, aeo: p.aeo?.score ?? null, aeoSignals: p.aeo?.signals, quality: p.quality ? Math.round(p.quality.q * 100) : null,
      subScores: { content: p.content ? Math.round(Math.min(100, (p.content.uniqueWords / 8) + (p.topics?.alignmentScore || 0) * 0.3)) : null, internalLinks: p.linkStats ? Math.round(Math.min(100, Math.log2(1 + p.linkStats.uniqueInlinkPages) * 20 + (p.linkStats.contextualInlinks ? 15 : 0))) : null, schema: p.schemaReport ? Math.max(0, 100 - p.schemaReport.entities.reduce((a, e) => a + e.missingRequired.length * 20 + e.missingRecommended.length * 4, 0) - (p.schemaReport.types.length ? 0 : 100)) : null, performance: Math.max(0, Math.round(100 - Math.max(0, p.ttfb - 200) / 30 - Math.max(0, d.domElements - 800) / 40)) },
      linkStats: p.linkStats, schemaReport: p.schemaReport,
      internalLinksOut: [...new Map(d.links.filter(l => l.kind === 'internal').map(l => [l.href, { href: l.href, text: l.text || l.imgAlt, region: l.region, nofollow: l.nofollow }])).values()].slice(0, 80),
      externalLinksOut: [...new Map(d.links.filter(l => l.kind === 'external').map(l => [l.href, { href: l.href, text: l.text || l.imgAlt, nofollow: l.nofollow }])).values()].slice(0, 40),
      images: d.images.slice(0, 60), imageCount: d.images.length, wordCount: d.wordCount, domElements: d.domElements, htmlBytes: d.htmlBytes, scripts: d.scripts.length, stylesheets: d.stylesheets.length,
      signals: { phones: d.phones, emails: d.emails, addresses: d.addresses, hasFaq: d.hasFaq, questionHeadings: d.questionHeadings, lists: d.lists, tables: d.tables, citationLinks: d.citationLinks, authorSignals: d.authorSignals, publishedTime: d.publishedTime, modifiedTime: d.modifiedTime, jsShell: d.jsShell, mixedContent: d.mixedContent },
      estimate: estByUrl.get(p.finalUrl) || null,
    };
  });

  const report = {
    meta: { id: null, input, homeUrl: ctx.homeUrl, startedAt: t0, finishedAt: Date.now(), durationMs: Date.now() - t0, crawlLimit: limit, pagesCrawled: pages.length, htmlPages: htmlPages(pages).length, notCrawledInBudget: crawlResult.notCrawledInBudget, blockedByRobots: crawlResult.blockedByRobots.length, userAgent: 'SEOScopeBot/1.0', version: '1.0.0' },
    evidenceLegend: { measured: 'Read directly from the website, its headers or public files.', calculated: 'Derived mathematically from measured data.', estimated: 'Predicted by a model from on-site signals. Not Google data.', unavailable: 'Cannot be known honestly from a URL alone.' },
    scores, opportunities, estimates,
    technical: technical.data, crawlability: crawlability.data, indexability: indexability.data, onpage: onpage.data, content: content.data, jsSeo: jsSeo.data, links: links.data, schema: schema.data, trust: trust.data, local: local.data, aeo: aeo.data, geo: geo.data, llms: llms.data, performance: performance.data,
    competitors: { basis: 'unavailable', reason: 'Real search competitors can only be identified from search results data, which requires a SERP source. Nothing is invented here.', profile: { industry: content.data.industry, topics: content.data.siteTopics.slice(0, 10).map(t => t.phrase), locations: local.data.cities.slice(0, 5) }, howToFind: 'Search your top topics below (with your city if local) in a private window and note which domains repeat across results.' },
    unavailable: [
      ['Actual organic clicks and impressions', 'Requires Google Search Console'], ['Actual Google rankings and positions', 'Requires Search Console or a SERP API'], ['Exact search volume', 'Requires Google Ads Keyword Planner or a keyword database'], ['Complete backlink profile and domain authority', 'Requires a link index (Ahrefs, Semrush, Moz, Common Crawl processing)'], ['Conversions and revenue from SEO', 'Requires analytics access'], ['Google Maps and local pack rankings', 'Requires location based SERP checks'], ['Actual AI Overview, ChatGPT or Perplexity citations', 'Requires querying those systems at scale'], ['Competitor keyword gaps', 'Requires a keyword ranking database'],
    ].map(([metric, requires]) => ({ metric, requires, basis: 'unavailable' })),
    issues: allIssues,
    pages: pageRows,
    crawl: { blockedByRobots: crawlResult.blockedByRobots.slice(0, 200), sitemapUrls: sitemap.urls.slice(0, 500).map(u => ({ url: u.url, lastmod: u.lastmod, problems: u.problems })) },
  };
  return report;
}
