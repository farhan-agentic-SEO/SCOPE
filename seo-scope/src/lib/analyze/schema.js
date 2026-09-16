import { issue, htmlPages } from './issue.js';
import { sameSite } from '../url.js';

const LOCAL_TYPES = /^(LocalBusiness|MedicalBusiness|MedicalClinic|Physician|Dentist|Hospital|Pharmacy|Optician|Store|Restaurant|AutoRepair|LegalService|Attorney|Notary|AccountingService|FinancialService|HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|GeneralContractor|HealthAndBeautyBusiness|DaySpa|BeautySalon|FitnessCenter|RealEstateAgent|ProfessionalService|LodgingBusiness|Hotel|FoodEstablishment|CafeOrCoffeeShop|ChildCare|VeterinaryCare|MedicalOrganization|DiagnosticLab|PsychiatricHospital|EmergencyService)$/;
export const RULES = {
  Organization: { required: ['name'], recommended: ['url', 'logo', 'sameAs', 'contactPoint'] },
  Person: { required: ['name'], recommended: ['url', 'sameAs', 'jobTitle', 'image'] },
  LocalBusiness: { required: ['name', 'address'], recommended: ['telephone', 'url', 'openingHoursSpecification|openingHours', 'geo', 'image', 'priceRange', 'sameAs'] },
  Article: { required: ['headline'], recommended: ['image', 'datePublished', 'dateModified', 'author', 'publisher'] },
  Product: { required: ['name', 'offers|review|aggregateRating'], recommended: ['image', 'description', 'brand', 'sku'] },
  Offer: { required: ['price|priceSpecification'], recommended: ['priceCurrency', 'availability', 'url'] },
  FAQPage: { required: ['mainEntity'], recommended: [] },
  BreadcrumbList: { required: ['itemListElement'], recommended: [] },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'image', 'description', 'offers', 'organizer'] },
  JobPosting: { required: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation|jobLocationType'], recommended: ['validThrough', 'employmentType', 'baseSalary'] },
  VideoObject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: ['description', 'duration', 'contentUrl|embedUrl'] },
  Review: { required: ['itemReviewed|@nested', 'author', 'reviewRating'], recommended: ['datePublished'] },
  AggregateRating: { required: ['ratingValue', 'ratingCount|reviewCount'], recommended: ['bestRating'] },
  WebSite: { required: ['name|url'], recommended: ['url', 'potentialAction'] },
  WebPage: { required: [], recommended: ['name', 'url'] },
  Service: { required: ['name|serviceType'], recommended: ['provider', 'areaServed', 'description'] },
  MedicalCondition: { required: ['name'], recommended: ['description', 'possibleTreatment', 'signOrSymptom'] },
  ImageObject: { required: ['contentUrl|url'], recommended: ['caption', 'creator', 'license'] },
  PostalAddress: { required: [], recommended: ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'] },
  Recipe: { required: ['name', 'image'], recommended: ['author', 'recipeIngredient', 'recipeInstructions', 'nutrition'] },
  HowTo: { required: ['name', 'step'], recommended: ['totalTime', 'image'] },
};
const ruleKey = t => LOCAL_TYPES.test(t) ? 'LocalBusiness' : /^(BlogPosting|NewsArticle|TechArticle|ScholarlyArticle|MedicalScholarlyArticle|Report)$/.test(t) ? 'Article' : /^(ProfilePage|AboutPage|ContactPage|CollectionPage|MedicalWebPage|ItemPage|FAQPage)$/.test(t) && t !== 'FAQPage' ? 'WebPage' : /^(Corporation|NGO|EducationalOrganization|GovernmentOrganization|NewsMediaOrganization|OnlineBusiness)$/.test(t) ? 'Organization' : /^(ProductGroup)$/.test(t) ? 'Product' : /^(MedicalProcedure|MedicalTherapy|TherapeuticProcedure)$/.test(t) ? 'Service' : t;
const has = (node, spec, nested) => spec.split('|').some(k => k === '@nested' ? nested : node[k] !== undefined && node[k] !== '' && !(Array.isArray(node[k]) && !node[k].length));

export function analyzeSchema(ctx) {
  const { pages, homeUrl } = ctx; const issues = [];
  const html = htmlPages(pages).filter(p => p.indexability.indexable); const total = html.length || 1;
  const typeCounts = {}; const invalidJson = []; const missingReq = []; const missingRec = []; const offsiteUrls = []; const dupTypes = []; const noId = [];
  html.forEach(p => {
    const s = p.data.schema; const found = [];
    s.errors.forEach(e => invalidJson.push({ url: p.finalUrl, detail: e }));
    s.types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
    const topLevel = s.nodes.filter(n => !n.nested);
    const seen = {};
    s.nodes.forEach(({ node, nested }) => {
      const types = [].concat(node['@type']).map(String);
      types.forEach(t => {
        const rule = RULES[ruleKey(t)]; if (!rule) return;
        const req = rule.required.filter(r => !has(node, r, nested)); const rec = rule.recommended.filter(r => !has(node, r, nested));
        if (req.length) missingReq.push({ url: p.finalUrl, detail: `${t} missing required: ${req.join(', ')}` });
        if (rec.length && !nested) missingRec.push({ url: p.finalUrl, detail: `${t} missing recommended: ${rec.join(', ')}` });
        found.push({ type: t, nested, missingRequired: req, missingRecommended: rec, id: node['@id'] || null });
        if (!nested) { seen[t] = (seen[t] || 0) + 1; }
      });
      for (const key of ['url', '@id']) { const v = node[key]; if (typeof v === 'string' && /^https?:/.test(v) && !nested && ['WebPage', 'WebSite', 'Organization'].includes(ruleKey(types[0])) && !sameSite(v, homeUrl)) offsiteUrls.push({ url: p.finalUrl, detail: `${types[0]} ${key} is ${v}` }); }
    });
    Object.entries(seen).filter(([t, c]) => c > 1 && !['ListItem', 'Question', 'Offer', 'Review', 'Person', 'ImageObject', 'Answer'].includes(t)).forEach(([t, c]) => dupTypes.push({ url: p.finalUrl, detail: `${c} separate top level ${t} blocks` }));
    if (topLevel.length > 1 && !topLevel.some(n => n.node['@id'])) noId.push({ url: p.finalUrl, detail: `${topLevel.length} entities without @id links` });
    p.schemaReport = { types: s.types, entities: found, invalidJson: s.errors.length, formats: { jsonld: s.jsonld.length, microdata: s.microdataTypes.length, rdfa: s.rdfaTypes.length } };
  });
  const add = o => { if (o.evidence.length) issues.push(issue({ category: 'schema', totalPages: total, ...o })); };
  add({ id: 'schema-invalid-json', severity: 'high', title: 'Invalid JSON-LD that cannot be parsed', evidence: invalidJson, why: 'The whole block is ignored, so none of its markup counts.', fix: 'Fix the JSON syntax (commonly trailing commas or unescaped quotes).' });
  add({ id: 'schema-missing-required', severity: 'medium', title: 'Structured data missing required properties', evidence: missingReq, why: 'Items without required properties are not eligible for rich results.', fix: 'Add the listed properties.' });
  add({ id: 'schema-missing-recommended', severity: 'low', title: 'Structured data missing recommended properties', evidence: missingRec, why: 'Recommended properties give search engines and AI systems fuller entity detail.', fix: 'Add the recommended properties where the information exists.' });
  add({ id: 'schema-duplicate-types', severity: 'low', title: 'Duplicate entity blocks on a page', evidence: dupTypes, why: 'Often two plugins output overlapping schema with conflicting values.', fix: 'Consolidate into one graph; disable duplicate schema output.' });
  add({ id: 'schema-offsite-url', severity: 'medium', title: 'Schema URLs point to another domain', evidence: offsiteUrls, why: 'Mismatched URLs (often a staging domain) confuse entity identity.', fix: 'Use this site’s canonical URLs in schema.' });
  add({ id: 'schema-no-id-graph', severity: 'low', title: 'Multiple entities without @id relationships', evidence: noId, why: 'Linked @id references tie Organization, WebSite and WebPage into one clear entity graph.', fix: 'Give entities stable @id values and reference them (publisher, provider, author).' });
  const noSchema = html.filter(p => !p.data.schema.types.length);
  add({ id: 'schema-none', severity: noSchema.length / total > 0.7 ? 'medium' : 'low', title: 'Indexable pages with no structured data', evidence: noSchema.map(p => ({ url: p.finalUrl, detail: `${p.pageType} page` })), why: 'Structured data helps search engines and AI assistants understand entities and page purpose.', fix: 'Add at least WebPage plus page specific types (Service, Article, Product, BreadcrumbList).' });

  const home = html.find(p => p.finalUrl === homeUrl) || htmlPages(pages).find(p => p.finalUrl === homeUrl);
  const siteTypes = new Set(html.flatMap(p => p.data.schema.types));
  const hasOrg = [...siteTypes].some(t => ruleKey(t) === 'Organization' || ruleKey(t) === 'LocalBusiness');
  if (!hasOrg) add({ id: 'schema-no-organization', severity: 'medium', title: 'No Organization or LocalBusiness schema anywhere', evidence: [{ url: homeUrl, detail: 'No entity describing the business' }], why: 'This is the anchor entity for brand knowledge panels and AI answers about the business.', fix: 'Add Organization (or the specific LocalBusiness subtype) on the homepage with name, logo, address, phone and sameAs.', affectsSite: true });
  if (home && !home.data.schema.types.includes('WebSite')) add({ id: 'schema-no-website', severity: 'low', title: 'Homepage has no WebSite schema', evidence: [{ url: homeUrl, detail: 'No WebSite entity' }], why: 'WebSite schema supports site name display in results.', fix: 'Add WebSite with name and url.', affectsSite: true });
  const inner = html.filter(p => p.finalUrl !== homeUrl && new URL(p.finalUrl).pathname.split('/').filter(Boolean).length >= 2);
  const noCrumb = inner.filter(p => !p.data.schema.types.includes('BreadcrumbList'));
  if (inner.length >= 3 && noCrumb.length / inner.length > 0.5) add({ id: 'schema-no-breadcrumbs', severity: 'low', title: 'Nested pages without BreadcrumbList', evidence: noCrumb.map(p => ({ url: p.finalUrl, detail: 'No BreadcrumbList' })), why: 'Breadcrumb markup shows site hierarchy in results.', fix: 'Add BreadcrumbList matching the visible breadcrumb trail.' });
  const articles = html.filter(p => p.pageType === 'article' && !p.data.schema.types.some(t => ruleKey(t) === 'Article'));
  add({ id: 'schema-article-missing', severity: 'low', title: 'Articles without Article or BlogPosting schema', evidence: articles.map(p => ({ url: p.finalUrl, detail: 'Blog or article page' })), why: 'Article schema clarifies author, dates and publisher, which matter for trust signals.', fix: 'Add BlogPosting with headline, author, datePublished and dateModified.' });
  const faqNoSchema = html.filter(p => p.data.hasFaq && !p.data.schema.types.includes('FAQPage') && p.data.questionHeadings.length >= 3);
  add({ id: 'schema-faq-opportunity', severity: 'low', title: 'Visible FAQs without FAQPage markup', evidence: faqNoSchema.map(p => ({ url: p.finalUrl, detail: `${p.data.questionHeadings.length} question headings` })), why: 'Google limits FAQ rich results to authoritative health and government sites, but the markup still structures Q&A for other systems.', fix: 'Mark up the visible questions and answers as FAQPage.', impact: 'low' });

  const orgNode = html.flatMap(p => p.data.schema.nodes).map(n => n.node).find(n => [].concat(n['@type']).some(t => ruleKey(String(t)) === 'Organization' || ruleKey(String(t)) === 'LocalBusiness'));
  const sameAs = orgNode ? [].concat(orgNode.sameAs || []) : [];
  const data = { typeCounts, pagesWithSchema: html.length - noSchema.length, pagesTotal: html.length, organization: orgNode ? { type: orgNode['@type'], name: orgNode.name, url: orgNode.url, sameAs, telephone: orgNode.telephone, address: orgNode.address, hasLogo: !!orgNode.logo } : null, formats: { jsonld: html.filter(p => p.data.schema.jsonld.length).length, microdata: html.filter(p => p.data.schema.microdataTypes.length).length, rdfa: html.filter(p => p.data.schema.rdfaTypes.length).length } };
  return { data, issues };
}
