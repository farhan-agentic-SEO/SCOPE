import { issue, htmlPages } from './issue.js';
import { commonSuffix } from './onpage.js';

export const STOP = new Set(('a about above after again against all am an and any are aren as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also get got may might must us one two new use using used via per like well way make many much every within without including across however etc am pm view click read learn contact home menu search page site skip content toggle close open back next previous copyright rights reserved privacy policy terms cookie cookies call today us www com http https inc llc ltd our your').split(' '));
const INTENT = {
  transactional: /\b(buy|order|shop|price|pricing|cost|quote|book|booking|schedule|appointment|reserve|purchase|cart|checkout|sign up|subscribe|free trial|get started|hire|request)\b/i,
  commercial: /\b(best|top|vs|versus|compare|comparison|review|reviews|alternatives?|cheap|affordable|rated|leading|trusted)\b/i,
  informational: /\b(what|how|why|when|guide|tips|symptoms|causes|definition|meaning|examples?|learn|explained|faq|questions|benefits|risks|types of|ways to)\b/i,
  navigational: /\b(about|contact|login|log in|account|careers|team|our story|locations?)\b/i,
  local: /\b(near me|nearby|in [A-Z][a-z]+|[A-Z][a-z]+,\s?[A-Z]{2}\b|county|city of|local)\b/,
};
const INDUSTRY = [
  ['medical', /\b(patients?|clinic|physician|doctor|medical|treatment|therapy|psychiatr\w*|health ?care|surgery|symptoms|diagnosis|dental|dentist|pediatric|chiropract\w*|telehealth)\b/gi],
  ['legal', /\b(attorney|lawyer|law firm|legal|lawsuit|injury claim|litigation|divorce|court)\b/gi],
  ['finance', /\b(loan|mortgage|insurance|invest\w*|financial|credit|tax|accounting|bank|wealth)\b/gi],
  ['home-services', /\b(plumb\w*|hvac|roof\w*|electrician|contractor|remodel\w*|pest control|landscap\w*|cleaning services|repair)\b/gi],
  ['saas', /\b(software|platform|saas|api|integration|dashboard|workflow|automation|free trial|pricing plans)\b/gi],
  ['ecommerce', /\b(add to cart|shop now|free shipping|checkout|in stock|sku|collections?|products?)\b/gi],
  ['publishing', /\b(book|author|publish\w*|ghostwrit\w*|manuscript|editing|novel)\b/gi],
  ['marketing', /\b(seo|marketing|agency|branding|social media|ppc|web design|content strategy)\b/gi],
];

const tokenize = t => (t || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
function ngrams(tokens, n) { const out = []; for (let i = 0; i + n <= tokens.length; i++) { const g = tokens.slice(i, i + n); if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.some(w => w.length < 2 || /^\d+$/.test(w))) continue; out.push(g.join(' ')); } return out; }

function shingles(text, k = 5) { const t = tokenize(text); const s = new Set(); for (let i = 0; i + k <= t.length; i++) s.add(t.slice(i, i + k).join(' ')); return s; }
function jaccard(a, b) { if (!a.size || !b.size) return 0; let inter = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a]; for (const x of s) if (l.has(x)) inter++; return inter / (a.size + b.size - inter); }

export function classifyPageType(p, homeUrl) {
  const u = new URL(p.finalUrl); const path = u.pathname.toLowerCase(); const types = p.data.schema.types.map(t => t.toLowerCase()); const title = (p.data.title || '').toLowerCase();
  if (p.finalUrl === homeUrl || path === '/' ) return 'home';
  if (/privacy|terms|disclaimer|cookie|accessibility-statement|legal|hipaa/.test(path)) return 'legal';
  if (/contact/.test(path)) return 'contact';
  if (/about|our-story|who-we-are|team|staff|providers?\b|doctors?\b|physicians?\b|people|leadership/.test(path)) return path.split('/').filter(Boolean).length > 1 && /providers?|doctors?|team|staff|physicians?|people/.test(path) ? 'person' : 'about';
  if (types.includes('product') || /\/(product|products|shop|store|item)s?\//.test(path)) return 'product';
  if (/\/(blog|news|articles?|insights|resources|posts?|guides?|learn)\//.test(path) || types.some(t => /article|blogposting|newsarticle/.test(t))) return path.split('/').filter(Boolean).length > 1 ? 'article' : 'blog-index';
  if (/\/(locations?|areas?-we-serve|service-areas?|cities|offices?)\b/.test(path)) return 'location';
  if (/\/(services?|treatments?|conditions?|solutions?|what-we-do|practice-areas?|specialt(y|ies)|programs?)\b/.test(path) || types.includes('service') || types.includes('medicalprocedure')) return 'service';
  if (/\/(category|categories|tag|collections?)\//.test(path)) return 'category';
  if (/faq/.test(path)) return 'faq';
  if (/careers|jobs/.test(path)) return 'careers';
  if (/pricing|plans/.test(path) || /pricing/.test(title)) return 'pricing';
  return 'page';
}

export function analyzeContent(ctx) {
  const { pages, homeUrl } = ctx; const issues = [];
  const html = htmlPages(pages);
  const total = html.length || 1;
  html.forEach(p => { p.pageType = classifyPageType(p, homeUrl); });

  // Boilerplate: paragraphs repeated on at least 40% of pages
  const paraFreq = new Map();
  html.forEach(p => new Set(p.data.paragraphs).forEach(t => paraFreq.set(t, (paraFreq.get(t) || 0) + 1)));
  const boiler = new Set([...paraFreq].filter(([, c]) => c >= Math.max(3, total * 0.4)).map(([t]) => t));
  html.forEach(p => {
    const w = p.data.mainWordCount || 1;
    const bw = p.data.paragraphs.filter(t => boiler.has(t)).reduce((a, t) => a + tokenize(t).length, 0);
    const uniqueWords = Math.max(0, w - bw);
    p.content = { words: p.data.mainWordCount, uniqueWords, boilerplatePct: Math.round((bw / w) * 100), paragraphs: p.data.paragraphs.length, sentences: p.data.sentenceCount, avgSentence: p.data.avgSentenceLength, readingEase: p.data.readingEase, textRatio: p.data.textRatio };
  });

  // Duplicate and near duplicate detection
  const sh = html.map(p => ({ p, s: shingles(p.data.mainText) }));
  const pairs = [];
  for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) {
    if (sh[i].s.size < 20 || sh[j].s.size < 20) continue;
    const sim = jaccard(sh[i].s, sh[j].s);
    if (sim >= 0.6) pairs.push({ a: sh[i].p.finalUrl, b: sh[j].p.finalUrl, similarity: Math.round(sim * 100), typeA: sh[i].p.pageType, typeB: sh[j].p.pageType });
  }
  const exact = pairs.filter(x => x.similarity >= 92); const near = pairs.filter(x => x.similarity < 92);
  if (exact.length) issues.push(issue({ id: 'duplicate-content', category: 'content', severity: 'high', title: 'Pages with duplicate main content', evidence: exact.map(x => ({ url: x.a, detail: `${x.similarity}% identical to ${x.b}` })), why: 'Google picks one version and filters the rest, so duplicates rarely rank.', fix: 'Merge the pages with a 301 redirect, canonicalize to the primary version, or rewrite each to be distinct.', effort: 'medium', totalPages: total }));
  if (near.length) issues.push(issue({ id: 'near-duplicate-content', category: 'content', severity: 'medium', title: 'Near duplicate pages (60 to 91% similar)', evidence: near.map(x => ({ url: x.a, detail: `${x.similarity}% similar to ${x.b}${x.typeA === 'location' && x.typeB === 'location' ? ' (location page template)' : ''}` })), why: 'Templated service or location pages with swapped names add little unique value.', fix: 'Add genuinely local or page specific detail: team, cases, FAQs, directions, pricing.', effort: 'high', totalPages: total }));

  // Thin content
  const skipTypes = new Set(['contact', 'legal', 'category', 'blog-index', 'careers']);
  const thinCandidates = html.filter(p => p.indexability.indexable && !skipTypes.has(p.pageType));
  const minWords = { article: 600, service: 400, location: 350, product: 200, home: 250, about: 250, person: 150, faq: 300, pricing: 150, page: 250 };
  const veryThin = thinCandidates.filter(p => p.content.uniqueWords < 100);
  const thin = thinCandidates.filter(p => p.content.uniqueWords >= 100 && p.content.uniqueWords < (minWords[p.pageType] || 250));
  if (veryThin.length) issues.push(issue({ id: 'very-thin-content', category: 'content', severity: 'high', title: 'Very thin pages (under 100 unique words)', evidence: veryThin.map(p => ({ url: p.finalUrl, detail: `${p.content.uniqueWords} unique words (${p.pageType})${p.data.jsShell.likelyClientRendered ? ', likely rendered by JavaScript' : ''}` })), why: 'Pages with almost no content rarely satisfy a search query.', fix: 'Expand with substantive, specific information or noindex and consolidate the page.', effort: 'medium', totalPages: total }));
  if (thin.length) issues.push(issue({ id: 'thin-content', category: 'content', severity: 'medium', title: 'Thin content for the page type', evidence: thin.map(p => ({ url: p.finalUrl, detail: `${p.content.uniqueWords} unique words; typical minimum for a ${p.pageType} page is about ${minWords[p.pageType] || 250}` })), why: 'Competing pages usually cover the topic in more depth.', fix: 'Answer the questions a searcher has: process, cost, outcomes, FAQs, proof.', effort: 'medium', totalPages: total }));
  const templateHeavy = html.filter(p => p.content.boilerplatePct >= 60 && p.content.words > 80);
  if (templateHeavy.length) issues.push(issue({ id: 'boilerplate-heavy', category: 'content', severity: 'low', title: 'Pages dominated by repeated template text', evidence: templateHeavy.map(p => ({ url: p.finalUrl, detail: `${p.content.boilerplatePct}% of main text repeats across the site` })), why: 'Search engines discount boilerplate and judge the unique portion.', fix: 'Reduce repeated blocks or add unique content.', totalPages: total }));
  const hard = html.filter(p => p.content.readingEase !== null && p.content.readingEase < 30 && p.content.words > 300);
  if (hard.length) issues.push(issue({ id: 'hard-to-read', category: 'content', severity: 'low', title: 'Content that is hard to read', evidence: hard.map(p => ({ url: p.finalUrl, detail: `Flesch reading ease ${p.content.readingEase}, ${p.content.avgSentence} words per sentence` })), why: 'Dense text lowers engagement and makes answers harder to extract.', fix: 'Shorten sentences, break up paragraphs, use lists.', totalPages: total }));
  const hidden = html.filter(p => p.data.hiddenBlocks >= 2);
  if (hidden.length) issues.push(issue({ id: 'hidden-text', category: 'content', severity: 'low', title: 'Substantial text hidden with inline display:none', evidence: hidden.map(p => ({ url: p.finalUrl, detail: `${p.data.hiddenBlocks} hidden blocks` })), why: 'Hidden text may carry less weight; check it is not important content.', fix: 'Make key content visible by default or use accessible tabs and accordions.' }));

  // Topic and keyword extraction (TF-IDF over weighted fields)
  const brandSuffix = commonSuffix(html.map(p => p.data.title).filter(Boolean));
  const stripBrand = t => brandSuffix && t ? t.replace(brandSuffix, '').replace(/\s[|\-–—:·•]\s*$/, '') : t;
  const docs = html.map(p => {
    const d = p.data; const tf = new Map();
    const addField = (text, weight) => { const t = tokenize(text); [1, 2, 3].forEach(n => ngrams(t, n).forEach(g => tf.set(g, (tf.get(g) || 0) + weight * (n === 1 ? 0.6 : n === 2 ? 1.3 : 1.5)))); };
    addField(stripBrand(d.title), 6); d.h1s.forEach(h => addField(h, 5)); addField(decodeURIComponent(new URL(p.finalUrl).pathname).replace(/[-_/]/g, ' '), 4);
    d.headings.filter(h => h.level === 2).forEach(h => addField(h.text, 2.5)); d.headings.filter(h => h.level === 3).forEach(h => addField(h.text, 1.5));
    addField(d.metaDescription, 2); d.images.forEach(i => addField(i.alt, 0.5)); addField(d.mainText.slice(0, 20000), 0.35);
    return { p, tf };
  });
  const df = new Map(); docs.forEach(({ tf }) => new Set(tf.keys()).forEach(k => df.set(k, (df.get(k) || 0) + 1)));
  const N = docs.length || 1;
  const sitePhraseScore = new Map();
  docs.forEach(({ p, tf }) => {
    const scored = [...tf.entries()].map(([k, v]) => ({ k, score: v * Math.log(1 + N / df.get(k)) * (N > 3 && df.get(k) > N * 0.7 ? 0.2 : 1) })).filter(x => x.score > 1).sort((a, b) => b.score - a.score);
    const picked = []; for (const s of scored) { if (picked.length >= 12) break; if (picked.some(x => x.k.includes(s.k) || s.k.includes(x.k))) continue; picked.push(s); }
    const primary = picked.find(x => x.k.includes(' ')) || picked[0];
    const pk = primary?.k || '';
    const pt = pk.split(' ');
    const inText = (txt) => { const t = (txt || '').toLowerCase(); return pt.length && pt.every(w => t.includes(w)); };
    const alignment = { title: inText(p.data.title), h1: inText(p.data.h1s[0]), url: inText(decodeURIComponent(p.finalUrl).replace(/[-_]/g, ' ')), meta: inText(p.data.metaDescription), body: inText(p.data.mainText), schema: p.data.schema.types.length > 0 };
    const alignScore = ['title', 'h1', 'url', 'body', 'meta'].filter(k => alignment[k]).length / 5;
    const textAll = `${p.data.title} ${p.data.h1s.join(' ')} ${p.data.metaDescription || ''} ${p.data.headings.map(h => h.text).join(' ')}`;
    const intents = Object.entries(INTENT).filter(([, re]) => re.test(textAll)).map(([k]) => k);
    const typeIntent = { article: 'informational', 'blog-index': 'informational', faq: 'informational', service: 'commercial', product: 'transactional', pricing: 'transactional', location: 'local', contact: 'navigational', about: 'navigational', person: 'navigational', home: 'navigational', legal: 'navigational', careers: 'navigational', category: 'commercial', page: 'informational' }[p.pageType];
    const primaryIntent = intents.includes('transactional') && ['service', 'product', 'pricing'].includes(p.pageType) ? 'transactional' : typeIntent;
    const mismatch = (primaryIntent === 'transactional' || primaryIntent === 'commercial') && !/(book|schedule|contact|call|buy|order|get|request|quote|appointment)/i.test(p.data.links.map(l => l.text).join(' ') + p.data.mainText.slice(-3000));
    p.topics = { primary: pk, secondary: picked.filter(x => x !== primary).slice(0, 8).map(x => x.k), alignment, alignmentScore: Math.round(alignScore * 100), alignmentLevel: alignScore >= 0.8 ? 'high' : alignScore >= 0.5 ? 'medium' : 'low', questions: p.data.questionHeadings.slice(0, 10), intent: primaryIntent, intentSignals: intents, intentMismatch: mismatch };
    picked.slice(0, 6).forEach((x, i) => sitePhraseScore.set(x.k, (sitePhraseScore.get(x.k) || 0) + x.score / (i + 1)));
    // Keyword stuffing: a single term above 4% density with many repeats
    const toks = tokenize(p.data.mainText).filter(t => !STOP.has(t) && t.length > 2); const counts = new Map(); toks.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    p.content.topTerm = top ? { term: top[0], count: top[1], density: +(top[1] / (toks.length || 1) * 100).toFixed(1) } : null;
  });
  const stuffed = html.filter(p => p.content.topTerm && p.content.topTerm.density > 4.5 && p.content.topTerm.count > 20);
  if (stuffed.length) issues.push(issue({ id: 'keyword-stuffing', category: 'content', severity: 'medium', title: 'Possible keyword stuffing', evidence: stuffed.map(p => ({ url: p.finalUrl, detail: `"${p.content.topTerm.term}" is ${p.content.topTerm.density}% of words (${p.content.topTerm.count} times)` })), why: 'Unnatural repetition can trigger spam classifiers and reads poorly.', fix: 'Use natural variations and cover related subtopics instead.', totalPages: total }));
  const weakAlign = html.filter(p => p.indexability.indexable && p.topics.primary && p.topics.alignmentLevel === 'low' && !['legal', 'contact'].includes(p.pageType));
  if (weakAlign.length) issues.push(issue({ id: 'weak-topic-alignment', category: 'content', severity: 'medium', title: 'Title, H1, URL and content do not agree on the topic', evidence: weakAlign.map(p => ({ url: p.finalUrl, detail: `Detected topic "${p.topics.primary}" missing from ${Object.entries(p.topics.alignment).filter(([k, v]) => !v && k !== 'schema').map(([k]) => k).join(', ')}` })), why: 'Consistent signals make it clear which queries the page should rank for.', fix: 'Put the core topic in the title, H1, URL slug and opening paragraph.', totalPages: total }));
  const mism = html.filter(p => p.indexability.indexable && p.topics.intentMismatch);
  if (mism.length) issues.push(issue({ id: 'intent-no-cta', category: 'content', severity: 'low', title: 'Commercial pages without a clear next step', evidence: mism.map(p => ({ url: p.finalUrl, detail: `${p.pageType} page with no booking, contact, quote or buy action detected` })), why: 'Pages targeting commercial intent need an obvious conversion path.', fix: 'Add a visible call to action that matches the searcher intent.', basis: 'calculated', totalPages: total }));

  // Site level topics, industry, entities
  const allText = html.slice(0, 40).map(p => `${p.data.title} ${p.data.headings.map(h => h.text).join(' ')} ${p.data.mainText.slice(0, 4000)}`).join(' ');
  const industryScores = INDUSTRY.map(([k, re]) => [k, (allText.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  const industry = industryScores[0][1] >= 8 ? industryScores[0][0] : 'general';
  const siteTopics = [...sitePhraseScore.entries()].sort((a, b) => b[1] - a[1]).filter(([k]) => k.includes(' ')).slice(0, 25).map(([k, s]) => ({ phrase: k, weight: Math.round(s), pages: html.filter(p => p.topics.primary === k || p.topics.secondary.includes(k)).length }));
  const cannibal = [...html.filter(p => p.indexability.indexable && p.topics.primary).reduce((m, p) => m.set(p.topics.primary, [...(m.get(p.topics.primary) || []), p]), new Map()).entries()].filter(([, g]) => g.length > 1);
  if (cannibal.length) issues.push(issue({ id: 'topic-overlap', category: 'content', severity: 'medium', title: 'Multiple pages target the same primary topic', evidence: cannibal.flatMap(([k, g]) => g.map(p => ({ url: p.finalUrl, detail: `"${k}" is also the main topic of ${g.length - 1} other page${g.length > 2 ? 's' : ''}` }))), why: 'Pages targeting the same query split relevance and links (keyword cannibalization).', fix: 'Pick one primary page per topic, differentiate the others, and link them to the primary.', basis: 'calculated', effort: 'medium', totalPages: total }));

  const entitySet = new Map();
  const addEntity = (name, type, source) => { if (!name || name.length < 3 || name.length > 80) return; const k = name.toLowerCase(); const e = entitySet.get(k) || { name, type, sources: new Set(), count: 0 }; e.sources.add(source); e.count++; entitySet.set(k, e); };
  html.forEach(p => {
    p.data.schema.nodes.forEach(({ node }) => { const t = [].concat(node['@type'])[0]; if (typeof node.name === 'string') addEntity(node.name, t, 'schema'); const addr = node.address; if (addr && typeof addr === 'object' && addr.addressLocality) addEntity(addr.addressLocality, 'Place', 'schema'); });
    (p.data.mainText.match(/\b(?:Dr\.|Doctor)\s[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/g) || []).forEach(n => addEntity(n, 'Person', 'content'));
    (p.data.mainText.match(/\b[A-Z][a-z]+,\s(?:TX|CA|NY|FL|IL|NJ|PA|OH|GA|NC|MI|WA|AZ|MA|VA|CO|TN|IN|MO|MD|WI|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|VT|WY|DC)\b/g) || []).forEach(n => addEntity(n, 'Place', 'content'));
  });
  const entities = [...entitySet.values()].map(e => ({ ...e, sources: [...e.sources] })).sort((a, b) => b.count - a.count).slice(0, 40);

  const wc = html.map(p => p.content.uniqueWords);
  return { data: { industry, industryScores: Object.fromEntries(industryScores), siteTopics, entities, duplicatePairs: pairs, avgWords: Math.round(wc.reduce((a, b) => a + b, 0) / (wc.length || 1)), wordHistogram: [[0, 100], [100, 300], [300, 600], [600, 1000], [1000, 2000], [2000, Infinity]].map(([a, b]) => ({ label: b === Infinity ? `${a}+` : `${a} to ${b}`, count: wc.filter(w => w >= a && w < b).length })), pageTypes: Object.fromEntries([...html.reduce((m, p) => m.set(p.pageType, (m.get(p.pageType) || 0) + 1), new Map())]), intents: Object.fromEntries([...html.reduce((m, p) => m.set(p.topics.intent, (m.get(p.topics.intent) || 0) + 1), new Map())]) }, issues };
}
