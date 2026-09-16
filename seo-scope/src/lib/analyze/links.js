import { checkUrl, pool } from '../http.js';
import { normalizeUrl, sameSite } from '../url.js';
import { issue, htmlPages } from './issue.js';

export async function analyzeLinks(ctx, { maxLinkChecks = 250, maxResourceChecks = 150, onProgress = () => {} } = {}) {
  const { pages, homeUrl, sitemap } = ctx; const issues = [];
  const html = htmlPages(pages); const total = html.length || 1;
  const byUrl = new Map(); pages.forEach(p => { byUrl.set(p.url, p); if (!byUrl.has(p.finalUrl)) byUrl.set(p.finalUrl, p); });

  // Build graph
  const inlinks = new Map(); const anchorsByTarget = new Map();
  html.forEach(p => {
    const d = p.data;
    const internal = d.links.filter(l => l.kind === 'internal'); const external = d.links.filter(l => l.kind === 'external');
    p.linkStats = { internal: internal.length, uniqueInternal: new Set(internal.map(l => l.href)).size, external: external.length, uniqueExternal: new Set(external.map(l => l.href)).size, contextual: internal.filter(l => l.region === 'content').length, navigation: internal.filter(l => l.region === 'navigation' || l.region === 'header').length, footer: internal.filter(l => l.region === 'footer').length, nofollowInternal: internal.filter(l => l.nofollow).length, inlinks: 0, uniqueInlinkPages: 0, contextualInlinks: 0 };
    const seen = new Set();
    internal.forEach(l => {
      const target = byUrl.get(l.href); const key = target ? (target.redirected ? target.finalUrl : target.finalUrl) : l.href;
      if (key === p.finalUrl) return;
      const rec = inlinks.get(key) || { count: 0, pages: new Set(), contextual: 0 };
      rec.count++; rec.pages.add(p.finalUrl); if (l.region === 'content') rec.contextual++;
      inlinks.set(key, rec);
      const anchor = (l.text || l.imgAlt || l.ariaLabel || '').toLowerCase().trim();
      if (anchor && !seen.has(key + anchor)) { seen.add(key + anchor); const a = anchorsByTarget.get(key) || new Map(); a.set(anchor, (a.get(anchor) || 0) + 1); anchorsByTarget.set(key, a); }
    });
  });
  html.forEach(p => { const r = inlinks.get(p.finalUrl); if (r) { p.linkStats.inlinks = r.count; p.linkStats.uniqueInlinkPages = r.pages.size; p.linkStats.contextualInlinks = r.contextual; } p.linkStats.topAnchors = [...(anchorsByTarget.get(p.finalUrl) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([text, count]) => ({ text, count })); });

  const indexable = html.filter(p => p.indexability.indexable && p.finalUrl !== homeUrl);
  // Orphans: known through the sitemap but no internal links point to them
  const smSet = new Set(sitemap.urls.map(u => normalizeUrl(u.url)).filter(Boolean));
  const orphans = indexable.filter(p => p.linkStats.uniqueInlinkPages === 0);
  if (orphans.length) issues.push(issue({ id: 'orphan-pages', category: 'links', severity: 'high', title: 'Orphan pages (no internal links point to them)', evidence: orphans.map(p => ({ url: p.finalUrl, detail: `0 internal links${smSet.has(p.finalUrl) ? ', found only in the sitemap' : ''}` })), why: 'Pages without internal links get little crawl priority and no internal authority.', fix: 'Link to each page from relevant hub pages and related content.', totalPages: total }));
  const weak = indexable.filter(p => p.linkStats.uniqueInlinkPages > 0 && p.linkStats.uniqueInlinkPages <= 2 && ['service', 'product', 'location', 'article', 'page'].includes(p.pageType));
  if (weak.length) issues.push(issue({ id: 'weak-internal-links', category: 'links', severity: 'medium', title: 'Weakly connected pages (1 or 2 linking pages)', evidence: weak.map(p => ({ url: p.finalUrl, detail: `Linked from ${p.linkStats.uniqueInlinkPages} page${p.linkStats.uniqueInlinkPages > 1 ? 's' : ''} (${p.pageType})` })), why: 'Internal links show which pages matter and pass relevance through anchor text.', fix: 'Add contextual links from related pages using descriptive anchors.', totalPages: total }));
  const noContextual = indexable.filter(p => p.linkStats.uniqueInlinkPages > 2 && p.linkStats.contextualInlinks === 0 && ['service', 'product', 'location'].includes(p.pageType));
  if (noContextual.length) issues.push(issue({ id: 'no-contextual-inlinks', category: 'links', severity: 'low', title: 'Money pages linked only from menus and footers', evidence: noContextual.map(p => ({ url: p.finalUrl, detail: `${p.linkStats.inlinks} navigation or footer links, 0 in body content` })), why: 'Links inside content carry more topical context than sitewide menu links.', fix: 'Link to these pages from related articles and service pages.', totalPages: total }));

  // Click depth
  const depthDist = {}; html.forEach(p => { const d = p.clickDepth === null ? 'unreached' : p.clickDepth >= 4 ? '4+' : String(p.clickDepth); depthDist[d] = (depthDist[d] || 0) + 1; });
  const deep = indexable.filter(p => p.clickDepth !== null && p.clickDepth >= 4);
  if (deep.length) issues.push(issue({ id: 'deep-pages', category: 'links', severity: deep.some(p => ['service', 'product', 'location'].includes(p.pageType)) ? 'medium' : 'low', title: 'Pages 4 or more clicks from the homepage', evidence: deep.map(p => ({ url: p.finalUrl, detail: `${p.clickDepth} clicks deep (${p.pageType})` })), why: 'Deeply buried pages are crawled less often and treated as less important.', fix: 'Flatten navigation or add links from hub pages so key pages are within 3 clicks.', totalPages: total }));

  // Anchor text quality
  const genericLinks = html.flatMap(p => p.data.links.filter(l => l.kind === 'internal' && l.generic && l.region === 'content').map(l => ({ url: p.finalUrl, detail: `"${l.text}" to ${l.href}` })));
  if (genericLinks.length) issues.push(issue({ id: 'generic-anchors', category: 'links', severity: 'low', title: 'Internal links with generic anchor text', evidence: genericLinks, why: 'Anchors like "click here" waste a relevance signal.', fix: 'Describe the destination in the anchor ("spinal stenosis treatment options").' }));
  const emptyAnchors = html.flatMap(p => p.data.links.filter(l => l.kind === 'internal' && !l.text && !l.imgAlt && !l.ariaLabel).map(l => ({ url: p.finalUrl, detail: `Link to ${l.href} has no text${l.imageOnly ? ' (image without alt)' : ''}` })));
  if (emptyAnchors.length) issues.push(issue({ id: 'empty-anchors', category: 'links', severity: 'low', title: 'Internal links with no anchor text', evidence: emptyAnchors, why: 'Search engines and screen readers get no context about the destination.', fix: 'Add text, alt text on linked images, or aria-label.' }));
  const anchorTargets = new Map();
  html.forEach(p => p.data.links.filter(l => l.kind === 'internal' && l.text && !l.generic && l.region === 'content').forEach(l => { const t = byUrl.get(l.href)?.finalUrl || l.href; const k = l.text.toLowerCase(); const s = anchorTargets.get(k) || new Set(); s.add(t); anchorTargets.set(k, s); }));
  const ambiguous = [...anchorTargets.entries()].filter(([k, s]) => s.size > 1 && k.split(' ').length >= 2);
  if (ambiguous.length) issues.push(issue({ id: 'anchor-multiple-targets', category: 'links', severity: 'low', title: 'Same anchor text points to different pages', evidence: ambiguous.map(([k, s]) => ({ url: [...s][0], detail: `"${k}" links to ${s.size} URLs: ${[...s].slice(0, 3).join(', ')}` })), why: 'Mixed signals about which page owns the topic.', fix: 'Use a given descriptive anchor for one destination only.', basis: 'calculated' }));
  const excessive = html.filter(p => p.linkStats.uniqueInternal + p.linkStats.uniqueExternal > 250);
  if (excessive.length) issues.push(issue({ id: 'excessive-links', category: 'links', severity: 'low', title: 'Pages with more than 250 unique links', evidence: excessive.map(p => ({ url: p.finalUrl, detail: `${p.linkStats.uniqueInternal} internal, ${p.linkStats.uniqueExternal} external` })), why: 'Huge link counts dilute the value passed to each destination.', fix: 'Trim mega menus and footers to the most important links.', totalPages: total }));
  const nofollowInternal = html.filter(p => p.linkStats.nofollowInternal > 0);
  if (nofollowInternal.length) issues.push(issue({ id: 'nofollow-internal', category: 'links', severity: 'low', title: 'Internal links marked nofollow', evidence: nofollowInternal.map(p => ({ url: p.finalUrl, detail: `${p.linkStats.nofollowInternal} nofollow internal links` })), why: 'Nofollow on your own links stops internal signals flowing.', fix: 'Remove nofollow from internal links.' }));

  // Links to redirects and errors already known from the crawl
  const toRedirect = []; const toError = [];
  html.forEach(p => p.data.links.filter(l => l.kind === 'internal').forEach(l => { const t = byUrl.get(l.href); if (!t) return; if (t.redirected && t.status === 200) toRedirect.push({ url: p.finalUrl, detail: `"${l.text || l.imgAlt || 'no text'}" to ${l.href} redirects to ${t.finalUrl}`, href: l.href }); else if (t.status >= 400 || !t.status) toError.push({ url: p.finalUrl, detail: `"${l.text || l.imgAlt || 'no text'}" to ${l.href} returns ${t.status || t.errorCode}`, href: l.href, status: t.status }); }));

  // Check links not covered by the crawl (external + internal outside budget)
  const unknown = new Map();
  html.forEach(p => p.data.links.forEach(l => { if (l.kind !== 'internal' && l.kind !== 'external') return; if (byUrl.has(l.href)) return; if (!unknown.has(l.href)) unknown.set(l.href, { href: l.href, kind: l.kind, sources: [] }); const u = unknown.get(l.href); if (u.sources.length < 5) u.sources.push({ page: p.finalUrl, text: l.text || l.imgAlt || '' }); }));
  ctx.crawlResult.nonHtmlLinks.forEach(h => { if (!unknown.has(h)) unknown.set(h, { href: h, kind: 'internal', sources: [] }); });
  const toCheck = [...unknown.values()].sort((a, b) => (a.kind === 'internal' ? 0 : 1) - (b.kind === 'internal' ? 0 : 1) || b.sources.length - a.sources.length).slice(0, maxLinkChecks);
  let done = 0;
  const results = await pool(toCheck, 10, async item => { const r = await checkUrl(item.href); onProgress(++done, toCheck.length); return { ...item, ...r }; });
  const externalBroken = []; const chainsFound = [];
  results.forEach(r => {
    const sources = r.sources.length ? r.sources : html.filter(p => p.data.links.some(l => l.href === r.href)).slice(0, 3).map(p => ({ page: p.finalUrl, text: '' }));
    const bad = !r.status || r.status >= 400;
    // Many sites reject bots on social platforms: treat 403/429/999 on external links as unverified, not broken
    const unverified = r.kind === 'external' && [401, 403, 429, 999].includes(r.status);
    sources.forEach(s => {
      if (bad && !unverified) (r.kind === 'internal' ? toError : externalBroken).push({ url: s.page, detail: `"${s.text || 'no text'}" to ${r.href} ${r.status ? 'returns ' + r.status : 'failed: ' + (r.errorCode || r.error)}`, status: r.status });
      else if (r.chain?.length > 1) chainsFound.push({ url: s.page, detail: `${r.href} passes through ${r.chain.length} redirects` });
    });
  });
  if (toError.length) issues.push(issue({ id: 'broken-internal-links', category: 'links', severity: 'high', title: 'Broken internal links', evidence: toError, why: 'Broken links frustrate visitors and leak crawl budget and link value.', fix: 'Update each link to a live URL or add a 301 redirect for the missing page.' }));
  if (externalBroken.length) issues.push(issue({ id: 'broken-external-links', category: 'links', severity: 'medium', title: 'Broken external links', evidence: externalBroken, why: 'Dead outbound links make content look unmaintained and hurt user trust.', fix: 'Replace with a current source or remove the link.' }));
  if (toRedirect.length) issues.push(issue({ id: 'links-to-redirects', category: 'links', severity: 'low', title: 'Internal links pointing to redirects', evidence: toRedirect, why: 'Each redirect adds a hop for users and crawlers.', fix: 'Point links straight at the final URL.' }));
  if (chainsFound.length) issues.push(issue({ id: 'links-redirect-chains', category: 'links', severity: 'low', title: 'Links that pass through redirect chains', evidence: chainsFound, why: 'Chains slow page loads and can lose signals.', fix: 'Update the link to the final destination.' }));

  // Resources: CSS, JS, fonts, images
  const resources = new Map();
  html.forEach(p => {
    p.data.stylesheets.forEach(s => resources.has(s.href) || resources.set(s.href, { href: s.href, type: 'css', page: p.finalUrl }));
    p.data.scripts.forEach(s => resources.has(s.src) || resources.set(s.src, { href: s.src, type: 'js', page: p.finalUrl }));
    p.data.fonts.forEach(f => resources.has(f) || resources.set(f, { href: f, type: 'font', page: p.finalUrl }));
    p.data.images.forEach(i => i.src && !resources.has(i.src) && resources.set(i.src, { href: i.src, type: 'image', page: p.finalUrl, ext: i.ext }));
  });
  const resList = [...resources.values()].sort((a, b) => (a.type === 'image' ? 1 : 0) - (b.type === 'image' ? 1 : 0)).slice(0, maxResourceChecks);
  const resResults = await pool(resList, 10, async r => ({ ...r, ...(await checkUrl(r.href)) }));
  const brokenRes = resResults.filter(r => r.status >= 400 || !r.status);
  if (brokenRes.length) issues.push(issue({ id: 'broken-resources', category: 'technical', severity: brokenRes.some(r => r.type !== 'image') ? 'high' : 'medium', title: 'Broken images, CSS, JavaScript or fonts', evidence: brokenRes.map(r => ({ url: r.page, detail: `${r.type}: ${r.href} ${r.status ? 'returns ' + r.status : 'failed'}` })), why: 'Missing CSS or JS breaks layout and functionality; missing images look broken.', fix: 'Restore the files or update the references.' }));
  const heavyImages = resResults.filter(r => r.type === 'image' && r.bytes > 300_000 && r.status === 200);
  const imageBytes = resResults.filter(r => r.type === 'image' && r.status === 200).reduce((a, r) => a + (r.bytes || 0), 0);
  if (heavyImages.length) issues.push(issue({ id: 'heavy-images', category: 'performance', severity: heavyImages.some(r => r.bytes > 1_000_000) ? 'medium' : 'low', title: 'Images larger than 300 KB', evidence: heavyImages.map(r => ({ url: r.page, detail: `${Math.round(r.bytes / 1024)} KB: ${r.href}` })), why: 'Oversized images are the most common cause of slow LCP.', fix: 'Resize to display dimensions and compress, ideally as WebP or AVIF.' }));
  const legacyBytes = resResults.filter(r => r.type === 'image' && ['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(r.ext) && r.status === 200).reduce((a, r) => a + (r.bytes || 0), 0);
  const oversizeBytes = heavyImages.reduce((a, r) => a + Math.max(0, r.bytes - 150_000), 0);
  const savings = { estimatedBytes: Math.round(legacyBytes * 0.3 + oversizeBytes * 0.5), sampledImages: resResults.filter(r => r.type === 'image').length, sampledBytes: imageBytes, basis: 'estimated', method: 'About 30% saving from converting JPEG/PNG to WebP plus 50% of bytes above 150 KB on oversized images. Sampled images only.' };

  const hubs = html.filter(p => p.linkStats.uniqueInlinkPages > 0).sort((a, b) => b.linkStats.uniqueInlinkPages - a.linkStats.uniqueInlinkPages).slice(0, 10).map(p => ({ url: p.finalUrl, inlinkPages: p.linkStats.uniqueInlinkPages, outlinks: p.linkStats.uniqueInternal, pageType: p.pageType }));
  // Architecture tree by page type and top path segment
  const tree = {}; html.forEach(p => { const seg = new URL(p.finalUrl).pathname.split('/').filter(Boolean)[0] || '(home)'; tree[seg] = tree[seg] || { count: 0, types: {}, avgDepth: 0 }; tree[seg].count++; tree[seg].types[p.pageType] = (tree[seg].types[p.pageType] || 0) + 1; tree[seg].avgDepth += p.clickDepth ?? 0; });
  Object.values(tree).forEach(t => { t.avgDepth = +(t.avgDepth / t.count).toFixed(1); });
  const edges = []; html.forEach(p => { new Set(p.data.links.filter(l => l.kind === 'internal' && l.region === 'content').map(l => byUrl.get(l.href)?.finalUrl).filter(Boolean)).forEach(t => t !== p.finalUrl && edges.push([p.finalUrl, t])); });

  return { data: { depthDistribution: depthDist, hubs, orphans: orphans.length, weak: weak.length, checkedLinks: results.length, uncheckedLinks: Math.max(0, unknown.size - results.length), checkedResources: resResults.length, brokenInternal: toError.length, brokenExternal: externalBroken.length, architecture: tree, contextualEdges: edges.slice(0, 1500), imageSavings: savings }, issues };
}
