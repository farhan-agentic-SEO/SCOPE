// llms.txt analysis. Facts about the file are MEASURED. The usefulness score is a CALCULATED heuristic.
// Reference format: https://llmstxt.org (a proposal; not an adopted standard of any search engine).
import { fetchUrl, checkUrl, pool } from '../http.js';
import { normalizeUrl, sameSite } from '../url.js';
import { issue, htmlPages } from './issue.js';

const LINK_RE = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/;

export function parseLlmsTxt(text) {
  const lines = text.split(/\r?\n/);
  const out = { h1: null, h1Line: null, summary: null, details: [], sections: [], links: [], problems: [], otherH1s: 0 };
  let section = null; let seenH2 = false;
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { if (!out.h1) { out.h1 = line.replace(/^#\s+/, '').trim(); out.h1Line = i + 1; if (i > 0 && lines.slice(0, i).some(l => l.trim())) out.problems.push({ line: i + 1, problem: 'H1 is not the first content line' }); } else out.otherH1s++; return; }
    if (/^##\s+/.test(line)) { seenH2 = true; section = { name: line.replace(/^##\s+/, '').trim(), line: i + 1, links: [], text: 0 }; out.sections.push(section); return; }
    if (/^>\s?/.test(line) && !seenH2 && !out.summary) { out.summary = line.replace(/^>\s?/, '').trim(); return; }
    const m = line.match(LINK_RE);
    if (m) { const link = { title: m[1].trim(), href: m[2].trim(), note: (m[3] || '').trim(), section: section?.name || null, line: i + 1, optional: /^optional$/i.test(section?.name || '') }; out.links.push(link); section?.links.push(link); if (!section) out.problems.push({ line: i + 1, problem: 'Link list appears before any H2 section' }); return; }
    if (/^\s*[-*]\s+/.test(line) && /\]\(/.test(line)) out.problems.push({ line: i + 1, problem: 'List item looks like a link but is not in "- [name](url): notes" form' });
    if (line.trim() && !seenH2 && !/^>/.test(line)) out.details.push(line.trim());
    if (line.trim() && section && !m) section.text++;
  });
  if (!out.h1) out.problems.push({ line: 1, problem: 'Missing required H1 title ("# Site name")' });
  if (out.otherH1s) out.problems.push({ line: null, problem: `${out.otherH1s} additional H1 headings (only one is expected)` });
  if (!out.summary) out.problems.push({ line: null, problem: 'No blockquote summary ("> short description") after the H1' });
  if (!out.sections.length) out.problems.push({ line: null, problem: 'No H2 sections with link lists' });
  return out;
}

async function probe(url) {
  const r = await fetchUrl(url, { timeout: 12000, maxBytes: 5_000_000 });
  const htmlLike = /text\/html/i.test(r.contentType) || /^\s*<(!doctype|html)/i.test(r.body.slice(0, 200));
  return { url, status: r.status, finalUrl: r.finalUrl, redirected: r.chain.length > 0, contentType: r.contentType, bytes: r.bytes, error: r.error, exists: r.ok && r.status === 200 && !htmlLike && r.body.trim().length > 0, htmlFallback: r.ok && r.status === 200 && htmlLike, body: r.body, truncated: r.truncated };
}

export async function analyzeLlms(ctx) {
  const { pages, homeUrl, sitemap } = ctx; const issues = [];
  const origin = new URL(homeUrl).origin;
  const [main, full, wellKnown] = await Promise.all([probe(`${origin}/llms.txt`), probe(`${origin}/llms-full.txt`), probe(`${origin}/.well-known/llms.txt`)]);
  const html = htmlPages(pages);
  const byUrl = new Map(); pages.forEach(p => { byUrl.set(p.url, p); if (!byUrl.has(p.finalUrl)) byUrl.set(p.finalUrl, p); });
  const smSet = new Set(sitemap.urls.map(u => normalizeUrl(u.url)).filter(Boolean));
  const data = { basisNote: 'File facts are measured. Score and coverage judgement are calculated heuristics. llms.txt is a community proposal; no major AI provider has confirmed it uses the file for ranking or citation.', files: {} };
  const describe = f => ({ url: f.url, status: f.status, exists: f.exists, htmlFallback: f.htmlFallback, redirected: f.redirected, finalUrl: f.finalUrl, contentType: f.contentType, bytes: f.bytes, error: f.error });
  data.files.llms = describe(main); data.files.llmsFull = describe(full); data.files.wellKnown = describe(wellKnown);

  const suggestion = buildSuggestedLlmsTxt(ctx);
  data.suggested = suggestion;

  if (!main.exists) {
    const detail = main.htmlFallback ? 'Returns an HTML page with status 200 (soft 404)' : `Status ${main.status || main.error}`;
    issues.push(issue({ id: 'llms-missing', category: 'llms', severity: 'low', title: 'No llms.txt file', evidence: [{ url: main.url, detail }], why: 'llms.txt is a proposed Markdown index that points language models to your most useful pages. Adoption by AI companies is unconfirmed, so treat it as a low cost, low certainty addition.', fix: 'Publish /llms.txt at the site root. A suggested file generated from this crawl is included in the report.', basis: 'measured', affectsSite: true }));
    if (main.htmlFallback) issues.push(issue({ id: 'llms-soft-404', category: 'llms', severity: 'low', title: '/llms.txt returns an HTML page instead of a 404', evidence: [{ url: main.url, detail: `200 with ${main.contentType}` }], why: 'Tools cannot tell whether the file exists.', fix: 'Return a 404 for missing files or publish the real file.', affectsSite: true }));
    data.score = 0; data.scoreBreakdown = [];
    data.full = full.exists ? summarizeFull(full, ctx) : null;
    return { data, issues };
  }

  const parsed = parseLlmsTxt(main.body);
  data.parsed = { h1: parsed.h1, summary: parsed.summary, detailLines: parsed.details.length, sections: parsed.sections.map(s => ({ name: s.name, links: s.links.length, line: s.line })), linkCount: parsed.links.length, problems: parsed.problems };
  data.raw = main.body.slice(0, 30000);
  if (!/text\/(plain|markdown)|text\/x-markdown/i.test(main.contentType)) issues.push(issue({ id: 'llms-content-type', category: 'llms', severity: 'low', title: 'llms.txt served with an unexpected content type', evidence: [{ url: main.url, detail: main.contentType || 'none' }], why: 'Plain text or Markdown content types make the file easy for tools to read.', fix: 'Serve it as text/plain or text/markdown with UTF-8.', affectsSite: true }));
  if (main.redirected) issues.push(issue({ id: 'llms-redirected', category: 'llms', severity: 'low', title: 'llms.txt is reached through a redirect', evidence: [{ url: main.url, detail: `Ends at ${main.finalUrl}` }], why: 'Some fetchers do not follow redirects.', fix: 'Serve the file directly at /llms.txt on the canonical host.', affectsSite: true }));
  if (parsed.problems.length) issues.push(issue({ id: 'llms-format', category: 'llms', severity: parsed.h1 ? 'low' : 'medium', title: 'llms.txt does not follow the expected structure', evidence: parsed.problems.map(p => ({ url: main.url, detail: `${p.line ? 'Line ' + p.line + ': ' : ''}${p.problem}` })), why: 'The proposal expects an H1 title, a blockquote summary, then H2 sections of Markdown link lists.', fix: 'Restructure the file to match the format (see the suggested file).', affectsSite: true }));

  // Link checks
  const links = parsed.links.map(l => { let abs = null; try { abs = new URL(l.href, origin).href; } catch {} return { ...l, abs, normalized: abs ? normalizeUrl(abs) : null }; });
  const invalid = links.filter(l => !l.abs);
  const results = await pool(links.filter(l => l.abs).slice(0, 150), 8, async l => {
    const known = byUrl.get(l.normalized);
    if (known) return { ...l, status: known.status, finalUrl: known.finalUrl, redirected: known.redirected, page: known, source: 'crawl' };
    const r = await checkUrl(l.abs);
    return { ...l, status: r.status, finalUrl: normalizeUrl(r.finalUrl) || r.finalUrl, redirected: (r.chain || []).length > 0, error: r.errorCode, page: null, source: 'checked' };
  });
  const broken = results.filter(r => !r.status || r.status >= 400);
  const redirected = results.filter(r => r.status < 400 && r.redirected);
  const offsite = results.filter(r => !sameSite(r.abs, homeUrl));
  const nonCanonical = results.filter(r => r.page?.data?.canonical && r.page.data.canonical !== r.page.finalUrl);
  const noindex = results.filter(r => r.page?.data?.robots.noindex);
  const protocolHostMismatch = results.filter(r => sameSite(r.abs, homeUrl) && new URL(r.abs).origin !== origin);
  const markdownLinks = results.filter(r => /\.md(\?|$)/i.test(r.abs));
  const withNotes = links.filter(l => l.note).length;
  const ev = (arr, fmt) => arr.map(r => ({ url: main.url, detail: fmt(r) }));
  if (invalid.length) issues.push(issue({ id: 'llms-invalid-links', category: 'llms', severity: 'medium', title: 'Invalid URLs inside llms.txt', evidence: invalid.map(l => ({ url: main.url, detail: `Line ${l.line}: ${l.href}` })), why: 'Unparseable links cannot be followed.', fix: 'Use absolute https URLs.' }));
  if (broken.length) issues.push(issue({ id: 'llms-broken-links', category: 'llms', severity: 'medium', title: 'Broken links inside llms.txt', evidence: ev(broken, r => `Line ${r.line}: ${r.abs} returns ${r.status || r.error}`), why: 'Pointing models at dead pages defeats the purpose of the file.', fix: 'Update or remove the broken entries.' }));
  if (redirected.length) issues.push(issue({ id: 'llms-redirect-links', category: 'llms', severity: 'low', title: 'llms.txt links that redirect', evidence: ev(redirected, r => `Line ${r.line}: ${r.abs} redirects to ${r.finalUrl}`), why: 'Links should point at final canonical URLs.', fix: 'Replace with the destination URLs.' }));
  if (nonCanonical.length) issues.push(issue({ id: 'llms-noncanonical-links', category: 'llms', severity: 'low', title: 'llms.txt links to non canonical URLs', evidence: ev(nonCanonical, r => `Line ${r.line}: ${r.abs} canonical is ${r.page.data.canonical}`), why: 'Inconsistent with the canonical signals the rest of the site sends.', fix: 'Use the canonical URL for each page.' }));
  if (noindex.length) issues.push(issue({ id: 'llms-noindex-links', category: 'llms', severity: 'low', title: 'llms.txt links to noindex pages', evidence: ev(noindex, r => `Line ${r.line}: ${r.abs}`), why: 'Pages you exclude from search are usually not the ones to promote to AI systems.', fix: 'Check these entries are intentional.' }));
  if (protocolHostMismatch.length) issues.push(issue({ id: 'llms-host-mismatch', category: 'llms', severity: 'low', title: 'llms.txt links use a different protocol or hostname', evidence: ev(protocolHostMismatch, r => `Line ${r.line}: ${r.abs} (site uses ${origin})`), why: 'Every such link hits a redirect.', fix: `Use ${origin} URLs.` }));

  // Coverage of important pages
  const linkedSet = new Set(results.flatMap(r => [r.normalized, r.finalUrl]).filter(Boolean));
  const indexable = html.filter(p => p.indexability.indexable);
  const importantTypes = ['home', 'service', 'product', 'location', 'about', 'pricing', 'faq', 'contact'];
  const topInlinked = [...indexable].sort((a, b) => (b.linkStats?.uniqueInlinkPages || 0) - (a.linkStats?.uniqueInlinkPages || 0)).slice(0, 15);
  const important = [...new Map([...indexable.filter(p => importantTypes.includes(p.pageType) && (p.clickDepth ?? 9) <= 2), ...topInlinked].map(p => [p.finalUrl, p])).values()];
  const missingImportant = important.filter(p => !linkedSet.has(p.finalUrl));
  const coverage = important.length ? Math.round(((important.length - missingImportant.length) / important.length) * 100) : 0;
  if (missingImportant.length) issues.push(issue({ id: 'llms-missing-important', category: 'llms', severity: coverage < 40 ? 'medium' : 'low', title: 'Important pages not listed in llms.txt', evidence: missingImportant.map(p => ({ url: p.finalUrl, detail: `${p.pageType} page, ${p.linkStats?.uniqueInlinkPages || 0} linking pages, ${p.clickDepth ?? '?'} clicks deep` })), why: 'The file is meant to be a curated map of your most useful content.', fix: 'Add these pages with a one line description each.', basis: 'calculated' }));
  const typeCoverage = {}; importantTypes.forEach(t => { const all = indexable.filter(p => p.pageType === t); if (all.length) typeCoverage[t] = { total: all.length, listed: all.filter(p => linkedSet.has(p.finalUrl)).length }; });
  const missingSections = Object.entries(typeCoverage).filter(([t, v]) => v.listed === 0 && t !== 'contact').map(([t]) => t);
  if (missingSections.length) issues.push(issue({ id: 'llms-missing-sections', category: 'llms', severity: 'low', title: 'Whole content areas absent from llms.txt', evidence: missingSections.map(t => ({ url: main.url, detail: `No ${t} pages listed (${typeCoverage[t].total} on the site)` })), why: 'Models get an incomplete picture of what the business offers.', fix: 'Add an H2 section for each missing area.', basis: 'calculated' }));
  const notInSitemapOrCrawl = results.filter(r => sameSite(r.abs, homeUrl) && !r.page && !smSet.has(r.normalized) && r.status === 200);
  if (notInSitemapOrCrawl.length) issues.push(issue({ id: 'llms-links-outside-architecture', category: 'llms', severity: 'low', title: 'llms.txt links to pages not found in the sitemap or crawl', evidence: ev(notInSitemapOrCrawl, r => `Line ${r.line}: ${r.abs}`), why: 'May indicate stale entries or pages hidden from normal navigation.', fix: 'Confirm these pages are current and linked internally.', basis: 'calculated' }));
  if (links.length && withNotes / links.length < 0.5) issues.push(issue({ id: 'llms-no-descriptions', category: 'llms', severity: 'low', title: 'Most llms.txt links have no description', evidence: [{ url: main.url, detail: `${withNotes} of ${links.length} links include ": description"` }], why: 'Short notes tell a model what each page covers before it fetches it.', fix: 'Add a one sentence description after each link.' }));

  // Score (calculated heuristic)
  const breakdown = [
    ['File accessible as plain text at /llms.txt', main.exists && !main.redirected ? 1 : main.exists ? 0.6 : 0, 15],
    ['H1 title present', parsed.h1 ? 1 : 0, 10],
    ['Blockquote summary present', parsed.summary ? 1 : 0, 10],
    ['Organised into H2 sections', Math.min(1, parsed.sections.length / 3), 10],
    ['Links resolve without errors', results.length ? 1 - broken.length / results.length : 0, 15],
    ['Links use canonical, non redirecting URLs', results.length ? 1 - (redirected.length + nonCanonical.length) / results.length : 0, 10],
    ['Important page coverage', coverage / 100, 20],
    ['Links carry descriptions', links.length ? withNotes / links.length : 0, 7],
    ['llms-full.txt available', full.exists ? 1 : 0, 3],
  ].map(([label, v, weight]) => ({ label, value: Math.round(Math.max(0, Math.min(1, v)) * 100), weight }));
  data.score = Math.round(breakdown.reduce((a, b) => a + b.value * b.weight, 0) / 100);
  data.scoreBreakdown = breakdown;
  data.links = { total: links.length, checked: results.length, broken: broken.length, redirected: redirected.length, nonCanonical: nonCanonical.length, noindex: noindex.length, offsite: offsite.length, markdownVersions: markdownLinks.length, withDescriptions: withNotes };
  data.coverage = { importantPages: important.length, listed: important.length - missingImportant.length, percent: coverage, byType: typeCoverage, missing: missingImportant.map(p => p.finalUrl) };
  data.full = full.exists ? summarizeFull(full, ctx) : null;
  if (!full.exists) data.fullNote = 'llms-full.txt not found. It is optional; it holds full page content in one Markdown file.';
  return { data, issues };
}

function summarizeFull(full, ctx) {
  const body = full.body; const headings = (body.match(/^#{1,3}\s.+$/gm) || []);
  const words = (body.match(/\S+/g) || []).length;
  const urls = [...new Set(body.match(/https?:\/\/[^\s)>\]]+/g) || [])];
  const sameSiteUrls = urls.filter(u => sameSite(u, ctx.homeUrl));
  return { bytes: full.bytes, truncatedRead: full.truncated, words, headings: headings.length, sampleHeadings: headings.slice(0, 12), urls: urls.length, sameSiteUrls: sameSiteUrls.length, contentType: full.contentType, tooLarge: full.bytes > 5_000_000 };
}

export function buildSuggestedLlmsTxt(ctx) {
  const { pages, homeUrl } = ctx;
  const html = htmlPages(pages).filter(p => p.indexability?.indexable);
  const home = htmlPages(pages).find(p => p.finalUrl === homeUrl);
  const orgName = html.flatMap(p => p.data.schema.nodes.map(n => n.node)).find(n => typeof n.name === 'string' && [].concat(n['@type']).some(t => /Organization|LocalBusiness|WebSite|Medical|Physician|Store|Attorney/i.test(String(t))))?.name;
  const siteName = orgName || home?.data.og.siteName || (home?.data.title || new URL(homeUrl).hostname).split(/\s[|\-–—:]\s/).pop().trim();
  const summary = (home?.data.metaDescription || home?.data.og.description || home?.data.paragraphs[0] || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const clean = s => (s || '').replace(/\s+/g, ' ').replace(/[\[\]]/g, '').trim();
  const titleOf = p => clean((p.data.h1s[0] || p.data.title || new URL(p.finalUrl).pathname).split(/\s[|\-–—]\s/)[0]).slice(0, 90);
  const noteOf = p => { const t = clean(p.data.metaDescription || p.data.paragraphs[0] || ''); if (t.length <= 160) return t; const cut = t.slice(0, 160); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! ')); return end > 60 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')); };
  const groups = [
    ['Services', ['service']], ['Products', ['product', 'category', 'pricing']], ['Locations', ['location']], ['About', ['about', 'person', 'contact']], ['Guides and articles', ['article', 'faq']],
  ];
  const ranked = [...html].sort((a, b) => (b.linkStats?.uniqueInlinkPages || 0) - (a.linkStats?.uniqueInlinkPages || 0));
  let out = `# ${clean(siteName)}\n\n`;
  if (summary) out += `> ${summary}\n\n`;
  const lines = [];
  for (const [label, types] of groups) {
    const items = ranked.filter(p => types.includes(p.pageType)).slice(0, label === 'Guides and articles' ? 20 : 25);
    if (!items.length) continue;
    out += `## ${label}\n\n`;
    items.forEach(p => { const note = noteOf(p); out += `- [${titleOf(p)}](${p.finalUrl})${note ? ': ' + note : ''}\n`; lines.push(p.finalUrl); });
    out += '\n';
  }
  const other = ranked.filter(p => p.pageType === 'page' && p.finalUrl !== homeUrl).slice(0, 10);
  const legal = ranked.filter(p => p.pageType === 'legal' || p.pageType === 'careers' || p.pageType === 'blog-index').slice(0, 8);
  if (other.length || legal.length) {
    out += `## Optional\n\n`;
    [...other, ...legal].forEach(p => out += `- [${titleOf(p)}](${p.finalUrl})${noteOf(p) ? ': ' + noteOf(p) : ''}\n`);
  }
  return { content: out.trim() + '\n', linkCount: lines.length + other.length + legal.length, basis: 'generated', note: 'Built only from indexable, canonical 200 pages found in this crawl. Review descriptions before publishing.' };
}
