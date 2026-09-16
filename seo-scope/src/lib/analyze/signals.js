// Heuristic signal scores. The inputs are MEASURED; the scores are CALCULATED heuristics.
import { issue, htmlPages } from './issue.js';

const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
const findPage = (pages, re) => htmlPages(pages).find(p => re.test(new URL(p.finalUrl).pathname) || re.test(p.data.title || ''));

export function analyzeTrust(ctx) {
  const { pages, homeUrl } = ctx; const html = htmlPages(pages); const issues = [];
  const allLinks = html.flatMap(p => p.data.links);
  const linkMatch = re => allLinks.some(l => (l.kind === 'internal' && re.test(new URL(l.href).pathname)) || re.test(l.text || ''));
  const orgNodes = html.flatMap(p => p.data.schema.nodes.map(n => n.node));
  const checks = [
    ['About page', !!findPage(pages, /\/about|our-story|who-we-are/i) || linkMatch(/about/i)],
    ['Contact page', !!findPage(pages, /\/contact/i) || linkMatch(/contact/i)],
    ['Privacy policy', linkMatch(/privacy/i)],
    ['Terms or conditions', linkMatch(/terms|conditions/i)],
    ['Disclaimer', linkMatch(/disclaimer/i)],
    ['Editorial or review policy', linkMatch(/editorial|review-policy|our-process|standards/i)],
    ['Author information on articles', html.some(p => p.data.authorSignals)],
    ['Author or team bio pages', html.some(p => p.pageType === 'person') || !!findPage(pages, /\/(team|authors?|providers?|doctors?|staff)\b/i)],
    ['Credentials mentioned', html.reduce((a, p) => a + p.data.credentialSignals, 0) >= 3],
    ['Reviewer attribution', html.some(p => p.data.reviewedBy)],
    ['References or citations', html.some(p => p.data.referencesSection || p.data.citationLinks >= 2)],
    ['Published dates', html.some(p => p.data.publishedTime || p.data.schema.nodes.some(n => n.node.datePublished))],
    ['Updated dates', html.some(p => p.data.modifiedTime || p.data.schema.nodes.some(n => n.node.dateModified))],
    ['Business address', html.some(p => p.data.addresses.length) || orgNodes.some(n => n.address)],
    ['Phone number', html.some(p => p.data.phones.length)],
    ['Email address', html.some(p => p.data.emails.length)],
    ['Social profiles linked', html.some(p => p.data.socialLinks.length)],
    ['sameAs in schema', orgNodes.some(n => n.sameAs)],
    ['Organization schema', orgNodes.some(n => [].concat(n['@type']).some(t => /Organization|LocalBusiness|MedicalBusiness|Physician|Clinic|Attorney|Store/i.test(String(t))))],
    ['Testimonials or reviews', html.some(p => p.data.testimonialSignals)],
  ].map(([label, pass]) => ({ label, pass: !!pass }));
  const passed = checks.filter(c => c.pass).length;
  const missing = checks.filter(c => !c.pass);
  const important = missing.filter(c => ['About page', 'Contact page', 'Privacy policy', 'Author information on articles', 'Organization schema', 'Business address', 'Phone number'].includes(c.label));
  if (important.length) issues.push(issue({ id: 'trust-signals-missing', category: 'trust', severity: important.length >= 3 ? 'medium' : 'low', title: 'Key trust and experience signals not detected', evidence: important.map(c => ({ url: homeUrl, detail: c.label })), why: 'Visible ownership, contact details, authorship and policies help users and quality raters judge credibility, especially for health, finance and legal topics.', fix: 'Add the missing pages or details and link them from the footer.', basis: 'measured', affectsSite: true }));
  return { data: { checks, passed, total: checks.length, score: pct(passed, checks.length), note: 'Detected signals only. This is not a measurement of E-E-A-T, which Google does not expose as a score.' }, issues };
}

export function analyzeLocal(ctx) {
  const { pages, homeUrl } = ctx; const html = htmlPages(pages); const issues = [];
  const nodes = html.flatMap(p => p.data.schema.nodes.map(n => n.node));
  const localNode = nodes.find(n => [].concat(n['@type']).some(t => /LocalBusiness|MedicalBusiness|MedicalClinic|Physician|Dentist|Attorney|LegalService|Store|Restaurant|Plumber|Electrician|HVACBusiness|RoofingContractor|ProfessionalService|MedicalOrganization/i.test(String(t))));
  const phoneCounts = new Map(); html.forEach(p => p.data.phones.forEach(ph => phoneCounts.set(ph, (phoneCounts.get(ph) || 0) + 1)));
  const phones = [...phoneCounts.entries()].sort((a, b) => b[1] - a[1]);
  const addresses = [...new Set(html.flatMap(p => p.data.addresses))];
  const locationPages = html.filter(p => p.pageType === 'location');
  const cities = [...new Set(html.flatMap(p => (p.data.mainText.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s[A-Z]{2}\b/g) || [])))].slice(0, 20);
  const localTitles = html.filter(p => cities.some(c => (p.data.title || '').includes(c.split(',')[0]))).length;
  const localH1 = html.filter(p => cities.some(c => (p.data.h1s[0] || '').includes(c.split(',')[0]))).length;
  const isLocal = !!localNode || addresses.length > 0 || html.some(p => p.data.mapsLinks) || locationPages.length > 0;
  const schemaPhone = localNode?.telephone ? String(localNode.telephone).replace(/[^\d]/g, '').replace(/^1(?=\d{10}$)/, '') : null;
  const napConsistent = phones.length <= 1 || (phones[0][1] >= html.length * 0.5 && phones.length <= 3);
  const checks = [
    ['LocalBusiness schema (or subtype)', !!localNode], ['Address in schema', !!localNode?.address], ['Geo coordinates in schema', !!localNode?.geo], ['Opening hours', !!(localNode?.openingHoursSpecification || localNode?.openingHours) || html.some(p => p.data.hoursMentioned)],
    ['Phone number visible', phones.length > 0], ['Click to call link', html.some(p => p.data.links.some(l => l.kind === 'tel'))], ['Street address visible', addresses.length > 0], ['Consistent phone across pages', phones.length > 0 && napConsistent],
    ['Schema phone matches visible phone', !!schemaPhone && phoneCounts.has(schemaPhone)], ['Maps or directions link', html.some(p => p.data.mapsLinks)], ['Location or service area pages', locationPages.length > 0], ['City names in titles', localTitles > 0], ['City names in H1s', localH1 > 0], ['Reviews or testimonials', html.some(p => p.data.testimonialSignals)], ['Service area in schema', !!localNode?.areaServed],
  ].map(([label, pass]) => ({ label, pass: !!pass }));
  if (isLocal) {
    if (!localNode) issues.push(issue({ id: 'local-no-schema', category: 'local', severity: 'medium', title: 'Local business signals found but no LocalBusiness schema', evidence: [{ url: homeUrl, detail: `Address or maps signals present; schema types: ${[...new Set(html.flatMap(p => p.data.schema.types))].slice(0, 6).join(', ') || 'none'}` }], why: 'LocalBusiness markup confirms name, address, phone and hours to search engines.', fix: 'Add the most specific LocalBusiness subtype with NAP, geo and hours.', affectsSite: true }));
    if (phones.length > 3) issues.push(issue({ id: 'local-nap-inconsistent', category: 'local', severity: 'low', title: 'Several different phone numbers across the site', evidence: phones.slice(0, 8).map(([ph, c]) => ({ url: homeUrl, detail: `${ph} on ${c} page${c > 1 ? 's' : ''}` })), why: 'Inconsistent NAP details can weaken local entity matching (unless these are separate locations).', fix: 'Use one primary number per location and match it everywhere, including schema and Google Business Profile.' }));
    if (schemaPhone && !phoneCounts.has(schemaPhone)) issues.push(issue({ id: 'local-schema-phone-mismatch', category: 'local', severity: 'low', title: 'Schema phone number does not match any visible number', evidence: [{ url: homeUrl, detail: `Schema: ${localNode.telephone}` }], why: 'Mismatched NAP between markup and page weakens trust in the data.', fix: 'Align schema with the published phone number.' }));
  }
  const passed = checks.filter(c => c.pass).length;
  return { data: { isLocal, checks, passed, total: checks.length, score: isLocal ? pct(passed, checks.length) : null, phones: phones.slice(0, 5).map(([number, pagesCount]) => ({ number, pages: pagesCount })), addresses: addresses.slice(0, 5), cities, locationPages: locationPages.map(p => p.finalUrl), schema: localNode ? { type: localNode['@type'], name: localNode.name, telephone: localNode.telephone, address: localNode.address } : null, note: 'Signals from the website only. Google Maps rankings and Business Profile data are not measurable from a URL.' }, issues };
}

export function analyzeAeo(ctx) {
  const { pages } = ctx; const html = htmlPages(pages).filter(p => p.indexability.indexable && !['legal', 'contact'].includes(p.pageType)); const issues = [];
  const perPage = html.map(p => {
    const d = p.data; const words = p.content.uniqueWords || d.mainWordCount;
    const s = {
      questionHeadings: Math.min(1, d.questionHeadings.length / 3), directAnswers: d.questionHeadings.length ? Math.min(1, d.answeredQuestions / Math.max(1, d.questionHeadings.length)) : 0,
      faq: d.hasFaq ? 1 : 0, lists: Math.min(1, d.lists / 2), tables: d.tables ? 1 : 0, steps: Math.min(1, d.stepSignals / 1), definitions: Math.min(1, d.definitionSentences / 1),
      conciseParagraphs: d.paragraphs.length ? d.paragraphs.filter(x => x.split(' ').length <= 60).length / d.paragraphs.length : 0,
      hierarchy: words > 0 ? Math.min(1, (d.headings.filter(h => h.level >= 2).length) / Math.max(1, words / 250)) : 0, schema: d.schema.types.some(t => /FAQPage|HowTo|QAPage|Article|BlogPosting/.test(t)) ? 1 : 0,
    };
    const w = { questionHeadings: 14, directAnswers: 16, faq: 10, lists: 10, tables: 5, steps: 8, definitions: 8, conciseParagraphs: 12, hierarchy: 12, schema: 5 };
    const score = Math.round(Object.entries(w).reduce((a, [k, v]) => a + v * s[k], 0));
    p.aeo = { score, signals: s };
    return { url: p.finalUrl, score, pageType: p.pageType };
  });
  const avg = perPage.length ? Math.round(perPage.reduce((a, x) => a + x.score, 0) / perPage.length) : 0;
  const noQ = html.filter(p => ['article', 'service', 'faq', 'page'].includes(p.pageType) && p.content.uniqueWords > 300 && !p.data.questionHeadings.length);
  if (noQ.length) issues.push(issue({ id: 'aeo-no-questions', category: 'aeogeo', severity: 'low', title: 'Long pages with no question based headings', evidence: noQ.map(p => ({ url: p.finalUrl, detail: `${p.content.uniqueWords} words, 0 question headings` })), why: 'Answer engines match conversational questions; question headings with direct answers are easier to quote.', fix: 'Add the real questions customers ask as H2/H3s, each followed by a 40 to 60 word answer.', basis: 'calculated', totalPages: html.length }));
  const unanswered = html.filter(p => p.data.questionHeadings.length >= 2 && p.data.answeredQuestions < p.data.questionHeadings.length / 2);
  if (unanswered.length) issues.push(issue({ id: 'aeo-no-direct-answers', category: 'aeogeo', severity: 'low', title: 'Question headings not followed by a direct answer', evidence: unanswered.map(p => ({ url: p.finalUrl, detail: `${p.data.answeredQuestions} of ${p.data.questionHeadings.length} questions answered in the first paragraph` })), why: 'Answer first formatting is what gets extracted into snippets and AI answers.', fix: 'Start each section with a concise answer sentence, then elaborate.', basis: 'calculated', totalPages: html.length }));
  return { data: { score: avg, pages: perPage.sort((a, b) => a.score - b.score), label: 'Heuristic readiness score, not a measurement of actual answer engine visibility.' }, issues };
}

export function analyzeGeo(ctx, { trust, schema, llms }) {
  const { pages } = ctx; const html = htmlPages(pages).filter(p => p.indexability.indexable); const issues = [];
  const n = html.length || 1;
  const factors = [
    ['Organization identity (schema entity with name)', schema.data.organization?.name ? 1 : 0, 12],
    ['Entity links via sameAs', Math.min(1, (schema.data.organization?.sameAs?.length || 0) / 3), 8],
    ['Author identity on content', html.filter(p => p.data.authorSignals).length / Math.max(1, html.filter(p => ['article', 'service'].includes(p.pageType)).length || n), 10],
    ['Citations to authoritative sources', Math.min(1, html.filter(p => p.data.citationLinks > 0 || p.data.referencesSection).length / Math.max(1, n * 0.3)), 10],
    ['Statistics and specific facts', Math.min(1, html.reduce((a, p) => a + p.data.statsSentences, 0) / Math.max(1, n * 1.5)), 8],
    ['Definitions and clear explanations', Math.min(1, html.filter(p => p.data.definitionSentences > 0).length / Math.max(1, n * 0.3)), 8],
    ['Structured data coverage', schema.data.pagesTotal ? schema.data.pagesWithSchema / schema.data.pagesTotal : 0, 10],
    ['Clear content hierarchy', html.filter(p => p.data.headings.filter(h => h.level === 2).length >= 2).length / n, 8],
    ['Topic depth (pages over 500 unique words)', html.filter(p => (p.content?.uniqueWords || 0) >= 500).length / n, 8],
    ['First hand experience language', Math.min(1, html.filter(p => /\b(we have (treated|helped|worked)|in our experience|our (patients|clients|customers) (often|typically)|case study|years of experience)\b/i.test(p.data.mainText)).length / Math.max(1, n * 0.2)), 6],
    ['Freshness (dates published or updated)', html.filter(p => p.data.modifiedTime || p.data.publishedTime || p.data.schema.nodes.some(x => x.node.dateModified)).length / n, 4],
    ['About page and trust signals', trust.data.passed / trust.data.total, 4],
    ['llms.txt present and usable', llms?.data?.score != null ? llms.data.score / 100 : 0, 4],
  ].map(([label, value, weight]) => ({ label, value: Math.round(Math.max(0, Math.min(1, value)) * 100), weight }));
  const score = Math.round(factors.reduce((a, f) => a + f.value * f.weight, 0) / factors.reduce((a, f) => a + f.weight, 0));
  const weakest = factors.filter(f => f.value < 40).sort((a, b) => b.weight - a.weight).slice(0, 4);
  if (weakest.length) issues.push(issue({ id: 'geo-weak-factors', category: 'aeogeo', severity: score < 40 ? 'medium' : 'low', title: 'Weak signals for AI search citation', evidence: weakest.map(f => ({ url: ctx.homeUrl, detail: `${f.label}: ${f.value}%` })), why: 'AI assistants favour sources with clear entity identity, evidence and well structured facts.', fix: 'Strengthen the listed factors, starting with the highest weighted ones.', basis: 'calculated', affectsSite: true }));
  return { data: { score, factors, label: 'Heuristic score. It does not measure actual ChatGPT, Perplexity, Gemini or AI Overview visibility.' }, issues };
}

export function analyzeJsSeo(ctx) {
  const { pages } = ctx; const html = htmlPages(pages); const issues = [];
  const shells = html.filter(p => p.data.jsShell.likelyClientRendered);
  const lowText = html.filter(p => !p.data.jsShell.likelyClientRendered && p.data.wordCount < 60 && p.data.scripts.length >= 5);
  const noTitle = html.filter(p => !p.data.title && p.data.scripts.length >= 3);
  const jsLinks = html.filter(p => p.data.links.filter(l => l.kind === 'internal').length < 3 && p.data.scripts.length >= 5);
  if (shells.length) issues.push(issue({ id: 'js-empty-shell', category: 'technical', severity: 'high', title: 'Pages deliver an empty HTML shell that needs JavaScript', evidence: shells.map(p => ({ url: p.finalUrl, detail: `${p.data.wordCount} words in raw HTML, app root container, ${p.data.scripts.length} scripts` })), why: 'Google can render JavaScript but with delays and failures; most AI crawlers do not run JavaScript at all.', fix: 'Use server side rendering or static generation so content, titles and links are in the initial HTML.', effort: 'high', totalPages: html.length }));
  if (lowText.length) issues.push(issue({ id: 'js-low-raw-text', category: 'technical', severity: 'medium', title: 'Very little text in raw HTML on script heavy pages', evidence: lowText.map(p => ({ url: p.finalUrl, detail: `${p.data.wordCount} words, ${p.data.scripts.length} scripts` })), why: 'Content injected by JavaScript may be missed by crawlers that do not render.', fix: 'Confirm key content is present in the HTML source.', totalPages: html.length }));
  if (jsLinks.length) issues.push(issue({ id: 'js-links-missing', category: 'links', severity: 'medium', title: 'Pages with almost no crawlable links in the HTML', evidence: jsLinks.map(p => ({ url: p.finalUrl, detail: `${p.data.links.filter(l => l.kind === 'internal').length} internal <a href> links` })), why: 'Links created with click handlers instead of <a href> cannot be followed.', fix: 'Render navigation as standard anchor links.', totalPages: html.length }));
  return { data: { clientRenderedPages: shells.length, lowTextPages: lowText.length, jsGeneratedTitleSuspects: noTitle.length, note: 'Raw HTML analysis. JavaScript rendering is not executed in this version, so JS generated content is flagged by signals, not rendered.' }, issues };
}
