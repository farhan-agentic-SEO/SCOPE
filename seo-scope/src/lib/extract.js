// Deterministic page extraction. Everything here is MEASURED from the HTML and headers.
import * as cheerio from 'cheerio';
import { normalizeUrl, sameSite } from './url.js';

const GENERIC_ANCHORS = new Set(['click here', 'here', 'read more', 'learn more', 'more', 'this', 'link', 'go', 'details', 'continue', 'view more', 'see more', 'click', 'this page', 'find out more', 'more info']);
const QUESTION_START = /^(what|how|why|when|where|who|which|can|do|does|is|are|should|will|could|would)\b/i;
const SOCIAL = /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|yelp|threads\.net)/i;
const CREDENTIAL = /\b(M\.?D\.?|D\.?O\.?|Ph\.?D|PharmD|DNP|NP-C|PA-C|RN|LCSW|LPC|J\.?D\.?|CPA|CFA|board[- ]certified|licensed|certified|fellowship|residency|years of experience)\b/i;

const clean = s => (s || '').replace(/\s+/g, ' ').trim();

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0; if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

function regionOf($, el) {
  const $el = $(el);
  if ($el.closest('nav,[role=navigation]').length) return 'navigation';
  if ($el.closest('header,[role=banner]').length) return 'header';
  if ($el.closest('footer,[role=contentinfo]').length) return 'footer';
  if ($el.closest('aside,[role=complementary]').length) return 'sidebar';
  return 'content';
}

function collectSchemaNodes(node, out, path = []) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectSchemaNodes(n, out, path)); return; }
  if (node['@graph']) collectSchemaNodes(node['@graph'], out, path);
  if (node['@type']) out.push({ node, nested: path.length > 0 });
  for (const [k, v] of Object.entries(node)) if (k !== '@graph' && v && typeof v === 'object') collectSchemaNodes(v, out, [...path, k]);
}

export function extractPage(html, pageUrl, headers = {}) {
  const $ = cheerio.load(html);
  const base = $('base[href]').attr('href') ? new URL($('base[href]').attr('href'), pageUrl).href : pageUrl;
  const isHttps = pageUrl.startsWith('https:');
  const out = { url: pageUrl };

  out.htmlBytes = Buffer.byteLength(html);
  out.lang = $('html').attr('lang') || null;
  out.generator = $('meta[name=generator]').attr('content') || null;
  out.titles = $('head title, title').map((_, e) => clean($(e).text())).get().filter((v, i, a) => a.indexOf(v) === i);
  out.title = $('title').first().length ? clean($('title').first().text()) : null;
  out.titleTagCount = $('title').length;
  out.metaDescriptions = $('meta[name="description" i]').map((_, e) => clean($(e).attr('content'))).get();
  out.metaDescription = out.metaDescriptions.length ? out.metaDescriptions[0] : null;
  const robotsMeta = $('meta[name="robots" i], meta[name="googlebot" i]').map((_, e) => (($(e).attr('content') || '').toLowerCase())).get().join(',');
  const xRobots = (headers['x-robots-tag'] || '').toLowerCase();
  const directives = new Set(`${robotsMeta},${xRobots}`.split(/\s*,\s*/).map(s => s.replace(/^[a-z]+bot:\s*/, '').trim()).filter(Boolean));
  out.robots = { meta: robotsMeta || null, header: xRobots || null, noindex: directives.has('noindex') || directives.has('none'), nofollow: directives.has('nofollow') || directives.has('none'), noarchive: directives.has('noarchive'), nosnippet: directives.has('nosnippet'), noimageindex: directives.has('noimageindex'), maxSnippet: [...directives].find(d => d.startsWith('max-snippet')) || null, maxImagePreview: [...directives].find(d => d.startsWith('max-image-preview')) || null };
  out.canonicals = $('link[rel="canonical" i]').map((_, e) => normalizeUrl($(e).attr('href'), base)).get().filter(Boolean);
  const linkHeaderCanon = (headers.link || '').match(/<([^>]+)>\s*;\s*rel="?canonical"?/i);
  if (linkHeaderCanon) out.canonicalHeader = normalizeUrl(linkHeaderCanon[1], base);
  out.canonical = out.canonicals[0] || out.canonicalHeader || null;
  out.viewport = $('meta[name="viewport" i]').attr('content') || null;
  out.charset = $('meta[charset]').attr('charset') || null;

  // Headings
  out.headings = $('h1,h2,h3,h4,h5,h6').map((_, e) => ({ level: Number(e.tagName[1]), text: clean($(e).text()) })).get();
  out.h1s = out.headings.filter(h => h.level === 1).map(h => h.text);
  out.questionHeadings = out.headings.filter(h => h.level > 1 && (h.text.endsWith('?') || QUESTION_START.test(h.text))).map(h => h.text);

  // Open Graph and Twitter
  const meta = n => $(`meta[property="${n}"], meta[name="${n}"]`).attr('content') || null;
  out.og = { title: meta('og:title'), description: meta('og:description'), image: meta('og:image'), url: meta('og:url'), type: meta('og:type'), siteName: meta('og:site_name'), imageWidth: meta('og:image:width'), imageHeight: meta('og:image:height') };
  out.twitter = { card: meta('twitter:card'), title: meta('twitter:title'), description: meta('twitter:description'), image: meta('twitter:image') };
  out.publishedTime = meta('article:published_time') || $('time[datetime]').first().attr('datetime') || null;
  out.modifiedTime = meta('article:modified_time') || meta('og:updated_time') || null;
  out.authorMeta = meta('author');

  // hreflang
  out.hreflang = $('link[rel="alternate" i][hreflang]').map((_, e) => ({ lang: ($(e).attr('hreflang') || '').toLowerCase(), href: normalizeUrl($(e).attr('href'), base) })).get();

  // Structured data
  out.schema = { jsonld: [], errors: [], microdataTypes: [], rdfaTypes: [], nodes: [] };
  $('script[type="application/ld+json" i]').each((_, e) => {
    const txt = $(e).contents().text().trim();
    if (!txt) return;
    try { const data = JSON.parse(txt); out.schema.jsonld.push(data); const nodes = []; collectSchemaNodes(data, nodes); out.schema.nodes.push(...nodes); }
    catch (err) { out.schema.errors.push(err.message.slice(0, 140)); }
  });
  out.schema.microdataTypes = $('[itemscope][itemtype]').map((_, e) => ($(e).attr('itemtype') || '').split('/').pop()).get();
  out.schema.rdfaTypes = $('[typeof]').map((_, e) => $(e).attr('typeof')).get();
  out.schema.types = [...new Set([...out.schema.nodes.flatMap(n => [].concat(n.node['@type'])), ...out.schema.microdataTypes, ...out.schema.rdfaTypes].map(String))];

  // Resources and mixed content
  out.scripts = $('script[src]').map((_, e) => ({ src: normalizeUrl($(e).attr('src'), base), async: $(e).is('[async]'), defer: $(e).is('[defer]') || $(e).attr('type') === 'module', inHead: $(e).closest('head').length > 0 })).get().filter(s => s.src);
  out.inlineScriptBytes = $('script:not([src])').map((_, e) => $(e).text().length).get().reduce((a, b) => a + b, 0);
  out.stylesheets = $('link[rel="stylesheet" i]').map((_, e) => ({ href: normalizeUrl($(e).attr('href'), base), media: $(e).attr('media') || null })).get().filter(s => s.href);
  out.fonts = $('link[rel="preload" i][as="font"]').map((_, e) => normalizeUrl($(e).attr('href'), base)).get().filter(Boolean);
  out.preconnects = $('link[rel="preconnect" i]').length;
  const resourceUrls = [...out.scripts.map(s => s.src), ...out.stylesheets.map(s => s.href), ...$('img[src],iframe[src],source[src],video[src],audio[src]').map((_, e) => normalizeUrl($(e).attr('src'), base)).get()];
  out.mixedContent = isHttps ? [...new Set(resourceUrls.filter(u => u && u.startsWith('http:')))] : [];
  out.iframes = $('iframe[src]').length;
  out.domElements = $('*').length;

  // Images
  out.images = $('img').map((_, e) => {
    const $e = $(e); const srcRaw = $e.attr('src') || $e.attr('data-src') || $e.attr('data-lazy-src') || '';
    const src = srcRaw.startsWith('data:') ? null : normalizeUrl(srcRaw, base);
    const file = src ? decodeURIComponent(new URL(src).pathname.split('/').pop() || '') : '';
    return { src, hasAlt: $e.is('[alt]'), alt: $e.attr('alt') ?? null, width: $e.attr('width') || null, height: $e.attr('height') || null, loading: $e.attr('loading') || ($e.attr('data-src') ? 'lazy-js' : null), srcset: !!($e.attr('srcset') || $e.attr('data-srcset')), inPicture: $e.closest('picture').length > 0, file, ext: (file.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || null, inLink: $e.closest('a').length > 0 };
  }).get();
  out.pictureSources = $('picture source[type]').map((_, e) => $(e).attr('type')).get();

  // Links
  out.links = [];
  $('a[href]').each((_, e) => {
    const $e = $(e); const hrefRaw = ($e.attr('href') || '').trim();
    if (!hrefRaw || hrefRaw.startsWith('#') || /^(javascript|data):/i.test(hrefRaw)) return;
    if (/^(mailto|tel|sms):/i.test(hrefRaw)) { out.links.push({ href: hrefRaw, kind: hrefRaw.split(':')[0].toLowerCase(), text: clean($e.text()) }); return; }
    const href = normalizeUrl(hrefRaw, base); if (!href) return;
    const text = clean($e.text()); const imgAlt = $e.find('img').map((_, i) => $(i).attr('alt') || '').get().join(' ').trim();
    const rel = ($e.attr('rel') || '').toLowerCase();
    out.links.push({ href, kind: sameSite(href, pageUrl) ? 'internal' : 'external', text, imageOnly: !text && $e.find('img,svg').length > 0, imgAlt, ariaLabel: $e.attr('aria-label') || $e.attr('title') || null, nofollow: /nofollow|ugc|sponsored/.test(rel), region: regionOf($, e), generic: GENERIC_ANCHORS.has(text.toLowerCase()) });
  });

  // Text and content metrics
  const $c = cheerio.load(html);
  $c('script,style,noscript,template,svg,iframe,canvas').remove();
  const bodyText = clean($c('body').text());
  let $main = $c('main,[role=main]').first();
  if (!$main.length) $main = $c('article').first();
  const mainScope = $main.length ? $main : $c('body').clone();
  if (!$main.length) mainScope.find('header,nav,footer,aside,[role=navigation],[role=banner],[role=contentinfo]').remove();
  const mainText = clean(mainScope.text());
  const words = t => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);
  const mainWords = words(mainText);
  out.wordCount = words(bodyText).length;
  out.mainWordCount = mainWords.length;
  out.mainText = mainText.slice(0, 60000);
  out.textRatio = out.htmlBytes ? +(Buffer.byteLength(bodyText) / out.htmlBytes).toFixed(3) : 0;
  out.paragraphs = mainScope.find('p').map((_, e) => clean($c(e).text())).get().filter(p => p.length >= 40);
  const sentences = mainText.split(/(?<=[.!?])\s+/).filter(s => words(s).length >= 3);
  out.sentenceCount = sentences.length;
  out.avgSentenceLength = sentences.length ? +(mainWords.length / sentences.length).toFixed(1) : 0;
  const syl = mainWords.slice(0, 5000).reduce((a, w) => a + syllables(w), 0);
  const sample = Math.min(mainWords.length, 5000);
  out.readingEase = sample > 50 && sentences.length ? Math.max(0, Math.min(100, Math.round(206.835 - 1.015 * (mainWords.length / sentences.length) - 84.6 * (syl / sample)))) : null;
  out.lists = mainScope.find('ul,ol').filter((_, e) => $c(e).find('li').length >= 2 && !$c(e).closest('nav').length).length;
  out.orderedLists = mainScope.find('ol').length;
  out.tables = mainScope.find('table').length;
  out.hasFaq = /frequently asked|\bfaqs?\b/i.test(out.headings.map(h => h.text).join(' ')) || out.schema.types.includes('FAQPage') || $('details summary').length >= 3;
  out.definitionSentences = sentences.filter(s => /^[A-Z][\w\s-]{2,60}\s(is|are|refers to|means)\s(a|an|the)\b/.test(s)).length;
  out.statsSentences = sentences.filter(s => /\d+(\.\d+)?\s?(%|percent|million|billion|times)/i.test(s)).length;
  out.stepSignals = out.orderedLists + (mainText.match(/\bstep\s\d+\b/gi) || []).length;

  // Answer-first check: paragraph right after each question heading
  out.answeredQuestions = 0;
  $('h2,h3,h4').each((_, e) => {
    const t = clean($(e).text());
    if (!(t.endsWith('?') || QUESTION_START.test(t))) return;
    const next = clean($(e).nextAll('p').first().text());
    const w = words(next).length;
    if (w >= 8 && w <= 80) out.answeredQuestions++;
  });

  // Hidden and JS rendering signals
  out.hiddenBlocks = $('[style*="display:none"],[style*="display: none"],[hidden]').filter((_, e) => clean($(e).text()).length > 80).length;
  out.accordionBlocks = $('details,[class*=accordion],[class*=tab-pane],[role=tabpanel]').length;
  const rootShell = $('#root,#__next,#app,#___gatsby,[data-reactroot],#svelte').length > 0;
  out.jsShell = { rootContainer: rootShell, scriptCount: out.scripts.length, lowText: out.wordCount < 50, likelyClientRendered: rootShell && out.wordCount < 80, noscriptText: clean($('noscript').text()).length };

  // Accessibility (static signals)
  const inputs = $('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea');
  out.a11y = {
    inputs: inputs.length,
    unlabeledInputs: inputs.filter((_, e) => { const id = $(e).attr('id'); return !($(e).attr('aria-label') || $(e).attr('aria-labelledby') || $(e).closest('label').length || (id && $(`label[for="${id}"]`).length) || $(e).attr('title')); }).length,
    emptyButtons: $('button').filter((_, e) => !clean($(e).text()) && !$(e).attr('aria-label') && !$(e).attr('title')).length,
    emptyLinks: out.links.filter(l => (l.kind === 'internal' || l.kind === 'external') && !l.text && !l.imgAlt && !l.ariaLabel).length,
    hasMainLandmark: $('main,[role=main]').length > 0,
    hasNavLandmark: $('nav,[role=navigation]').length > 0,
    invalidAria: $('[role]').filter((_, e) => !/^(button|link|navigation|main|banner|contentinfo|complementary|search|form|dialog|alert|tab|tablist|tabpanel|menu|menuitem|menubar|list|listitem|img|presentation|none|region|heading|checkbox|radio|switch|textbox|combobox|option|listbox|progressbar|status|tooltip|grid|row|cell|gridcell|columnheader|rowheader|table|article|figure|group|separator|toolbar|tree|treeitem|feed|log|marquee|timer|alertdialog|document|application|math|note|definition|term|directory|searchbox|slider|spinbutton|scrollbar|menuitemcheckbox|menuitemradio|radiogroup|rowgroup|treegrid)$/.test(($(e).attr('role') || '').split(' ')[0])).length,
    positiveTabindex: $('[tabindex]').filter((_, e) => Number($(e).attr('tabindex')) > 0).length,
    autoplayMedia: $('video[autoplay],audio[autoplay]').length,
    userScalableNo: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(out.viewport || ''),
  };

  // Business, trust and local signals
  const fullText = bodyText;
  out.phones = [...new Set([...out.links.filter(l => l.kind === 'tel').map(l => l.href.replace(/^tel:/i, '')), ...(fullText.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g) || [])].map(p => p.replace(/[^\d+]/g, '').replace(/^\+?1(?=\d{10}$)/, '')))].slice(0, 10);
  out.emails = [...new Set([...out.links.filter(l => l.kind === 'mailto').map(l => l.href.replace(/^mailto:/i, '').split('?')[0].toLowerCase()), ...(fullText.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) || []).map(e => e.toLowerCase())])].slice(0, 10);
  out.addresses = [...new Set((fullText.match(/\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,4}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Ct|Court|Hwy|Highway|Pl|Place|Suite|Ste|Plaza|Circle|Cir|Trail|Tr)\b\.?(?:[^.\n]{0,60}?\b[A-Z]{2}\s+\d{5})?/g) || []).map(clean))].slice(0, 6);
  out.zipCodes = [...new Set(fullText.match(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g) || [])].slice(0, 10);
  out.mapsLinks = out.links.filter(l => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com|bing\.com\/maps/i.test(l.href)).length + $('iframe[src*="google.com/maps"]').length;
  out.socialLinks = [...new Set(out.links.filter(l => l.kind === 'external' && SOCIAL.test(new URL(l.href).hostname)).map(l => l.href))].slice(0, 15);
  out.hoursMentioned = /\b(mon(day)?|tue(sday)?|hours)\b[^.]{0,40}\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(fullText);
  out.testimonialSignals = /(testimonial|reviews?|what our (patients|clients|customers) say|★|stars?\b)/i.test(fullText);
  out.credentialSignals = (fullText.match(new RegExp(CREDENTIAL.source, 'gi')) || []).length;
  out.referencesSection = /\b(references|sources|citations|bibliography|works cited)\b/i.test(out.headings.map(h => h.text).join(' '));
  out.citationLinks = out.links.filter(l => l.kind === 'external' && l.region === 'content' && /(\.gov|\.edu|\.org|nih\.gov|pubmed|doi\.org|who\.int|cdc\.gov|jamanetwork|nejm|thelancet|nature\.com|sciencedirect|springer|wiley)/i.test(l.href)).length;
  out.authorSignals = !!(out.authorMeta || $('[rel=author],.author,.byline,[class*=author],[itemprop=author]').length || out.schema.nodes.some(n => n.node.author));
  out.reviewedBy = /(medically reviewed|reviewed by|fact[- ]checked)/i.test(fullText);
  out.hasSearchForm = $('form[role=search], input[type=search]').length > 0;
  return out;
}
