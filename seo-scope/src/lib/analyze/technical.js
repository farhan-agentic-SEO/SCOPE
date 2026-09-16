import { fetchUrl, getCertificate } from '../http.js';
import { urlFlags, stripWww, normalizeUrl } from '../url.js';
import { issue, htmlPages, groupBy } from './issue.js';

const TECH = [
  ['WordPress', (h, hd) => /wp-content|wp-includes/i.test(h)], ['Elementor', h => /elementor/i.test(h)], ['WooCommerce', h => /woocommerce/i.test(h)],
  ['Yoast SEO', h => /yoast seo/i.test(h)], ['Rank Math', h => /rank-math|rank math/i.test(h)], ['All in One SEO', h => /aioseo/i.test(h)],
  ['Shopify', (h, hd) => /cdn\.shopify\.com|Shopify\.theme/i.test(h) || hd['x-shopify-stage']], ['Webflow', h => /webflow\.(js|css|com)|data-wf-page/i.test(h)],
  ['Wix', (h, hd) => /static\.wixstatic\.com|wix\.com/i.test(h) || hd['x-wix-request-id']], ['Squarespace', h => /squarespace/i.test(h)], ['Drupal', h => /drupal/i.test(h)],
  ['Joomla', h => /\/media\/jui\/|joomla/i.test(h)], ['Ghost', h => /ghost-(url|portal)|content="Ghost/i.test(h)], ['HubSpot CMS', h => /hs-scripts\.com|hubspot/i.test(h)],
  ['Next.js', h => /__NEXT_DATA__|\/_next\//.test(h)], ['Nuxt', h => /__NUXT__|\/_nuxt\//.test(h)], ['Gatsby', h => /___gatsby/.test(h)], ['Astro', h => /astro-island|data-astro/i.test(h)],
  ['React', h => /data-reactroot|react(\.production|-dom)/i.test(h)], ['Vue', h => /data-v-[a-f0-9]{6,}|vue(\.runtime|\.global)/i.test(h)], ['Angular', h => /ng-version=/i.test(h)], ['Svelte', h => /svelte-[a-z0-9]{5,}/i.test(h)],
  ['jQuery', h => /jquery(\.min)?\.js/i.test(h)], ['Bootstrap', h => /bootstrap(\.min)?\.(css|js)/i.test(h)], ['Tailwind CSS', h => /tailwind/i.test(h)],
  ['Cloudflare', (h, hd) => hd['cf-ray'] || /cloudflare/i.test(hd.server || '')], ['Vercel', (h, hd) => hd['x-vercel-id']], ['Netlify', (h, hd) => hd['x-nf-request-id'] || /netlify/i.test(hd.server || '')],
  ['Amazon CloudFront', (h, hd) => hd['x-amz-cf-id']], ['Fastly', (h, hd) => /fastly/i.test(hd['x-served-by'] || '') || /varnish/i.test(hd.via || '')], ['GitHub Pages', (h, hd) => hd['x-github-request-id']],
  ['Nginx', (h, hd) => /nginx/i.test(hd.server || '')], ['Apache', (h, hd) => /apache/i.test(hd.server || '')], ['LiteSpeed', (h, hd) => /litespeed/i.test(hd.server || '')], ['IIS', (h, hd) => /iis/i.test(hd.server || '')], ['PHP', (h, hd) => /php/i.test(hd['x-powered-by'] || '')],
  ['Google Analytics 4', h => /gtag\/js\?id=G-|googletagmanager\.com\/gtag/i.test(h)], ['Google Tag Manager', h => /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(h)], ['Meta Pixel', h => /connect\.facebook\.net\/.*fbevents/i.test(h)],
  ['Microsoft Clarity', h => /clarity\.ms/i.test(h)], ['Hotjar', h => /hotjar/i.test(h)], ['Klaviyo', h => /klaviyo/i.test(h)], ['HubSpot tracking', h => /js\.hs-scripts\.com|js\.hs-analytics/i.test(h)],
];

export function detectTechnology(homeHtml, headers) {
  return TECH.filter(([, test]) => { try { return !!test(homeHtml || '', headers || {}); } catch { return false; } }).map(([name]) => name);
}

export async function analyzeTechnical(ctx) {
  const { pages, homeUrl, homeHtml, homeRecord } = ctx;
  const issues = []; const total = htmlPages(pages).length || 1;
  const home = new URL(homeUrl); const host = home.hostname; const bare = stripWww(home.host);
  const data = { host, finalHomeUrl: homeUrl };

  // Protocol and host variants
  const variants = [`http://${bare}/`, `http://www.${bare}/`, `https://${bare}/`, `https://www.${bare}/`];
  data.variants = await Promise.all(variants.map(async v => { const r = await fetchUrl(v, { timeout: 10000, maxBytes: 50000 }); return { url: v, status: r.status, finalUrl: r.finalUrl, hops: r.chain.length, chain: r.chain.map(c => `${c.status} ${c.url}`), error: r.errorCode || null }; }));
  const finalHosts = new Set(data.variants.filter(v => v.status === 200).map(v => normalizeUrl(v.finalUrl)).filter(Boolean).map(u => new URL(u).origin));
  data.httpsAvailable = data.variants.some(v => v.url.startsWith('https') && v.status === 200 && v.finalUrl.startsWith('https'));
  data.httpRedirectsToHttps = data.variants.filter(v => v.url.startsWith('http:') && !v.error).every(v => v.finalUrl.startsWith('https:'));
  data.hostConsolidated = finalHosts.size <= 1;
  data.preferredHost = home.origin;
  if (!home.protocol.startsWith('https')) issues.push(issue({ id: 'no-https', category: 'technical', severity: 'critical', title: 'Site does not load over HTTPS', evidence: [{ url: homeUrl, detail: 'Final homepage URL uses http://' }], why: 'HTTPS is a confirmed lightweight ranking signal and browsers mark HTTP pages as not secure.', fix: 'Install a TLS certificate and redirect all HTTP URLs to HTTPS with 301 redirects.', effort: 'medium', affectsSite: true }));
  else if (!data.httpRedirectsToHttps) issues.push(issue({ id: 'http-not-redirected', category: 'technical', severity: 'high', title: 'HTTP version does not redirect to HTTPS', evidence: data.variants.filter(v => v.url.startsWith('http:') && !v.finalUrl.startsWith('https:') && !v.error).map(v => ({ url: v.url, detail: `Ends at ${v.finalUrl} (${v.status})` })), why: 'Duplicate HTTP and HTTPS versions split signals and can be indexed separately.', fix: 'Add a site wide 301 redirect from http:// to https://.', affectsSite: true }));
  if (!data.hostConsolidated) issues.push(issue({ id: 'host-not-consolidated', category: 'technical', severity: 'high', title: 'www and non www versions both resolve without consolidating', evidence: [...finalHosts].map(h => ({ url: h, detail: 'Serves a 200 response' })), why: 'Two live hostnames create duplicate copies of every page.', fix: `Pick one hostname (currently ${home.origin}) and 301 redirect the other to it.`, affectsSite: true }));
  const longChains = data.variants.filter(v => v.hops > 1);
  if (longChains.length) issues.push(issue({ id: 'variant-redirect-chain', category: 'technical', severity: 'low', title: 'Homepage variants reach the final URL through multiple redirects', evidence: longChains.map(v => ({ url: v.url, detail: v.chain.join(' then ') })), why: 'Each extra hop adds latency and wastes crawl budget.', fix: 'Redirect every variant straight to the final URL in a single hop.', affectsSite: true }));

  // TLS
  if (home.protocol === 'https:') {
    data.certificate = await getCertificate(host);
    if (data.certificate.error) issues.push(issue({ id: 'ssl-error', category: 'technical', severity: 'high', title: 'TLS certificate could not be read', evidence: [{ url: homeUrl, detail: data.certificate.error }], why: 'Certificate problems cause browser warnings that stop visitors and crawlers.', fix: 'Check the certificate installation with your host.', affectsSite: true }));
    else {
      if (!data.certificate.authorized) issues.push(issue({ id: 'ssl-invalid', category: 'technical', severity: 'critical', title: 'TLS certificate is not trusted', evidence: [{ url: homeUrl, detail: data.certificate.authorizationError }], why: 'Browsers show a full page security warning.', fix: 'Reissue the certificate for the correct hostname with a trusted authority.', affectsSite: true }));
      if (data.certificate.daysRemaining < 14) issues.push(issue({ id: 'ssl-expiring', category: 'technical', severity: data.certificate.daysRemaining < 0 ? 'critical' : 'high', title: data.certificate.daysRemaining < 0 ? 'TLS certificate has expired' : `TLS certificate expires in ${data.certificate.daysRemaining} days`, evidence: [{ url: homeUrl, detail: `Valid until ${data.certificate.validTo}` }], why: 'An expired certificate makes the whole site inaccessible behind warnings.', fix: 'Renew the certificate and enable automatic renewal.', affectsSite: true }));
    }
  }

  // Soft 404 behaviour
  const probe = new URL(`/seoscope-missing-${Date.now().toString(36)}/`, homeUrl).href;
  const probeRes = await fetchUrl(probe, { timeout: 10000, maxBytes: 200000 });
  data.notFoundHandling = { url: probe, status: probeRes.status, finalUrl: probeRes.finalUrl };
  if (probeRes.status === 200) issues.push(issue({ id: 'soft-404-behaviour', category: 'technical', severity: 'high', title: 'Missing pages return 200 instead of 404 (soft 404)', evidence: [{ url: probe, detail: `A made up URL returned ${probeRes.status}${probeRes.chain.length ? ' after redirecting to ' + probeRes.finalUrl : ''}` }], why: 'Search engines may index error pages and waste crawl budget on URLs that do not exist.', fix: 'Configure the server or CMS to return a real 404 status for unknown URLs.', effort: 'medium', affectsSite: true }));

  // Status distribution
  const buckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, error: 0 };
  pages.forEach(p => { if (!p.status) buckets.error++; else if (p.redirected) buckets['3xx']++; else buckets[`${String(p.status)[0]}xx`] = (buckets[`${String(p.status)[0]}xx`] || 0) + 1; });
  data.statusDistribution = buckets;
  const errors4 = pages.filter(p => p.status >= 400 && p.status < 500); const errors5 = pages.filter(p => p.status >= 500); const failed = pages.filter(p => !p.status);
  if (errors4.length) issues.push(issue({ id: 'pages-4xx', category: 'technical', severity: 'high', title: 'Crawled URLs return 4xx errors', evidence: errors4.map(p => ({ url: p.url, detail: `Status ${p.status}${p.discoveredFrom ? ', linked from ' + p.discoveredFrom : ''}` })), why: 'Broken URLs waste crawl budget and lose any link value pointing at them.', fix: 'Restore the pages, 301 redirect them to the closest relevant page, or remove links to them.', totalPages: total }));
  if (errors5.length) issues.push(issue({ id: 'pages-5xx', category: 'technical', severity: 'critical', title: 'Crawled URLs return server errors (5xx)', evidence: errors5.map(p => ({ url: p.url, detail: `Status ${p.status}` })), why: 'Persistent server errors cause Google to slow crawling and drop pages.', fix: 'Check server logs and fix the failing routes.', totalPages: total }));
  if (failed.length) issues.push(issue({ id: 'pages-unreachable', category: 'technical', severity: 'high', title: 'URLs could not be fetched', evidence: failed.map(p => ({ url: p.url, detail: p.error || p.errorCode })), why: 'Timeouts and connection failures stop crawlers reaching content.', fix: 'Investigate hosting capacity, firewalls, or bot protection blocking crawlers.', totalPages: total }));

  // Redirects inside the crawl
  const redirects = pages.filter(p => p.redirected);
  data.redirects = redirects.map(p => ({ url: p.url, finalUrl: p.finalUrl, hops: p.redirectChain.length, chain: p.redirectChain }));
  const chains = redirects.filter(p => p.redirectChain.length > 1);
  if (chains.length) issues.push(issue({ id: 'redirect-chains', category: 'technical', severity: 'medium', title: 'Redirect chains with more than one hop', evidence: chains.map(p => ({ url: p.url, detail: p.redirectChain.map(c => c.status).join(' then ') + ` then ${p.finalUrl}` })), why: 'Chains slow users and crawlers and can drop signals along the way.', fix: 'Point each redirect straight to the final destination.', totalPages: total }));
  const loops = pages.filter(p => p.errorCode === 'REDIRECT_LOOP' || p.errorCode === 'TOO_MANY_REDIRECTS');
  if (loops.length) issues.push(issue({ id: 'redirect-loops', category: 'technical', severity: 'critical', title: 'Redirect loops', evidence: loops.map(p => ({ url: p.url, detail: p.redirectChain.map(c => c.url).join(' then ') })), why: 'Looping URLs can never be crawled or indexed.', fix: 'Correct the redirect rules so the chain ends on a 200 page.' }));
  const tempRedirects = redirects.filter(p => p.redirectChain.some(c => c.status === 302 || c.status === 307));
  if (tempRedirects.length) issues.push(issue({ id: 'temporary-redirects', category: 'technical', severity: 'low', title: 'Internal URLs use temporary (302/307) redirects', evidence: tempRedirects.map(p => ({ url: p.url, detail: `${p.redirectChain.map(c => c.status).join(', ')} to ${p.finalUrl}` })), why: 'Temporary redirects signal that the old URL should stay indexed.', fix: 'Use 301 or 308 for permanent moves.' }));

  // Response time
  const ok = htmlPages(pages);
  const ttfbs = ok.map(p => p.ttfb).sort((a, b) => a - b);
  data.responseTime = { median: ttfbs[Math.floor(ttfbs.length / 2)] || 0, p90: ttfbs[Math.floor(ttfbs.length * 0.9)] || 0, max: ttfbs[ttfbs.length - 1] || 0, note: 'Measured from the audit server location; time to response headers.' };
  const slow = ok.filter(p => p.ttfb > 1500);
  if (slow.length) issues.push(issue({ id: 'slow-response', category: 'performance', severity: slow.length / total > 0.3 ? 'high' : 'medium', title: 'Slow server response (over 1.5s to first byte)', evidence: slow.map(p => ({ url: p.url, detail: `${p.ttfb} ms` })), why: 'Slow server responses delay every other loading metric, including LCP.', fix: 'Add page caching, a CDN, or faster hosting; review slow database queries.', effort: 'medium', totalPages: total }));

  // Mixed content
  const mixed = ok.filter(p => p.data.mixedContent.length);
  if (mixed.length) issues.push(issue({ id: 'mixed-content', category: 'technical', severity: 'high', title: 'HTTPS pages load insecure HTTP resources', evidence: mixed.map(p => ({ url: p.url, detail: p.data.mixedContent.slice(0, 3).join(', ') })), why: 'Browsers block or warn about insecure resources, breaking pages and trust.', fix: 'Update resource URLs to https:// or use relative URLs.', totalPages: total }));

  // URL structure
  const urlRows = ok.map(p => ({ url: p.finalUrl, ...urlFlags(p.finalUrl) }));
  data.urlStructure = { avgLength: Math.round(urlRows.reduce((a, r) => a + r.length, 0) / (urlRows.length || 1)), maxDepth: Math.max(0, ...urlRows.map(r => r.depth)) };
  const flag = (id, test, severity, title, why, fix) => { const hits = urlRows.filter(test); if (hits.length) issues.push(issue({ id, category: 'technical', severity, title, evidence: hits.map(r => ({ url: r.url, detail: `${r.length} characters` })), why, fix, totalPages: total })); };
  flag('url-too-long', r => r.length > 115, 'low', 'URLs longer than 115 characters', 'Long URLs are harder to share and get truncated in results.', 'Shorten slugs to the core topic words.');
  flag('url-uppercase', r => r.hasUppercase, 'low', 'URLs contain uppercase letters', 'URLs are case sensitive, so mixed case creates duplicate variants.', 'Use lowercase URLs and redirect uppercase versions.');
  flag('url-underscores', r => r.hasUnderscore, 'low', 'URLs use underscores instead of hyphens', 'Google treats hyphens as word separators, not underscores.', 'Use hyphens in new slugs; only redirect old ones if there is a clear benefit.');
  flag('url-special', r => r.hasSpaces || r.hasSpecial, 'low', 'URLs contain spaces or special characters', 'Encoded characters make URLs fragile and harder to link.', 'Use simple lowercase letters, numbers and hyphens.');
  flag('url-parameters', r => r.paramCount > 2, 'low', 'Indexable URLs with many query parameters', 'Parameter combinations can generate near endless duplicate URLs.', 'Canonicalize parameter URLs to the clean version.');
  flag('url-session', r => r.hasSession, 'medium', 'Session IDs in URLs', 'Session IDs create a new URL per visitor.', 'Store sessions in cookies, not URLs.');
  const slashGroups = groupBy(ok.map(p => p.finalUrl).filter(u => new URL(u).pathname !== '/' && !urlFlags(u).isFileLike), u => urlFlags(u).trailingSlash);
  data.trailingSlash = { with: slashGroups.get(true)?.length || 0, without: slashGroups.get(false)?.length || 0 };
  if (data.trailingSlash.with && data.trailingSlash.without && Math.min(data.trailingSlash.with, data.trailingSlash.without) / (data.trailingSlash.with + data.trailingSlash.without) > 0.1) issues.push(issue({ id: 'trailing-slash-mixed', category: 'technical', severity: 'low', title: 'Inconsistent trailing slash usage', evidence: [...(slashGroups.get(data.trailingSlash.with < data.trailingSlash.without ? true : false) || [])].map(u => ({ url: u, detail: 'Differs from the majority pattern' })), why: 'Mixed patterns lead to duplicate URL variants and extra redirects.', fix: 'Choose one pattern and redirect the other.' }));

  // Security headers (homepage)
  const hd = homeRecord?.headers || {};
  data.securityHeaders = { hsts: !!hd['strict-transport-security'], csp: !!hd['content-security-policy'], xContentTypeOptions: /nosniff/i.test(hd['x-content-type-options'] || ''), xFrameOptions: !!hd['x-frame-options'] || /frame-ancestors/i.test(hd['content-security-policy'] || ''), referrerPolicy: !!hd['referrer-policy'], permissionsPolicy: !!hd['permissions-policy'] };
  const missingSec = Object.entries(data.securityHeaders).filter(([, v]) => !v).map(([k]) => k);
  if (missingSec.length) issues.push(issue({ id: 'security-headers', category: 'security', severity: missingSec.includes('hsts') && home.protocol === 'https:' ? 'medium' : 'low', title: 'Security headers missing on the homepage', evidence: missingSec.map(k => ({ url: homeUrl, detail: k })), why: 'Security headers protect visitors and are a trust signal; HSTS prevents protocol downgrade.', fix: 'Add the missing headers at the server, CDN, or security plugin level.', affectsSite: true }));
  const exposed = [hd.server && /\d/.test(hd.server) ? `Server: ${hd.server}` : null, hd['x-powered-by'] ? `X-Powered-By: ${hd['x-powered-by']}` : null].filter(Boolean);
  if (exposed.length) issues.push(issue({ id: 'server-info-exposed', category: 'security', severity: 'low', title: 'Server software versions are exposed in headers', evidence: exposed.map(d => ({ url: homeUrl, detail: d })), why: 'Version numbers help attackers target known vulnerabilities.', fix: 'Hide version details in the server configuration.', affectsSite: true }));

  // Compression and caching (homepage)
  data.compression = hd['content-encoding'] || null;
  data.caching = hd['cache-control'] || null;
  if (!data.compression) issues.push(issue({ id: 'no-compression', category: 'performance', severity: 'medium', title: 'HTML is served without compression', evidence: [{ url: homeUrl, detail: 'No content-encoding header' }], why: 'Gzip or Brotli usually cuts HTML transfer size by 70% or more.', fix: 'Enable Brotli or Gzip on the server or CDN.', affectsSite: true }));

  data.technology = detectTechnology(homeHtml, hd);
  return { data, issues };
}
