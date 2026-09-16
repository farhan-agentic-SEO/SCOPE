// Spins up a small local website with deliberate SEO problems and runs the full audit against it.
process.env.ALLOW_PRIVATE_HOSTS = 'true';
process.env.ENABLE_PAGESPEED = 'false';
const { default: express } = await import('express');
const { runAudit } = await import('../src/lib/pipeline.js');

const app = express(); const PORT = 4010; const B = `http://127.0.0.1:${PORT}`;
const layout = (title, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${extra}<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><header><nav><a href="/">Home</a> <a href="/services/">Services</a> <a href="/services/knee-pain-treatment/">Knee pain</a> <a href="/about/">About</a> <a href="/blog/">Blog</a> <a href="/contact/">Contact</a></nav></header><main>${body}</main><footer><p>Acme Clinic, 120 Main Street, Plano, TX 75024. Call (972) 555-0100.</p><a href="/privacy-policy/">Privacy policy</a></footer></body></html>`;
const lorem = n => Array.from({ length: n }, (_, i) => `Physical therapy for knee pain helps patients recover strength and mobility after injury number ${i}. Our clinicians build a plan around your goals, daily activities and medical history.`).join(' ');
const pages = {
  '/': layout('Acme Clinic | Orthopedic and Sports Medicine in Plano, TX', `<h1>Orthopedic care in Plano</h1><p>${lorem(12)}</p><h2>What conditions do you treat?</h2><p>We treat knee pain, back pain, sports injuries and arthritis with non surgical care first.</p><a href="/services/knee-pain-treatment/">knee pain treatment in Plano</a> <a href="/broken-page/">click here</a> <a href="https://www.nih.gov/">NIH</a><img src="/img/IMG_20231.jpg">`, `<meta name="description" content="Acme Clinic offers orthopedic and sports medicine care in Plano, Texas. Book an appointment with a board certified physician today."><link rel="canonical" href="${B}/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"MedicalClinic","name":"Acme Clinic","url":"${B}/","telephone":"+1-972-555-0100","address":{"@type":"PostalAddress","streetAddress":"120 Main Street","addressLocality":"Plano","addressRegion":"TX"},"sameAs":["https://www.facebook.com/acme"]}</script>`),
  '/services/': layout('Services | Acme Clinic', `<h1>Our services</h1><p>${lorem(4)}</p><a href="/services/knee-pain-treatment/">Knee pain treatment</a> <a href="/services/back-pain/">Back pain</a>`, `<meta name="description" content="Services">`),
  '/services/knee-pain-treatment/': layout('Knee Pain Treatment in Plano | Acme Clinic', `<h1>Knee pain treatment in Plano</h1><p>${lorem(30)}</p><h2>How long does knee pain recovery take?</h2><p>Most patients see improvement within six to eight weeks of consistent physical therapy and home exercise.</p><h2>Is surgery needed?</h2><ul><li>Most cases are treated without surgery</li><li>Injections can help</li></ul><a href="/contact/">Book an appointment</a>`, `<meta name="description" content="Non surgical knee pain treatment in Plano with physical therapy, injections and sports medicine. Book a same week appointment."><link rel="canonical" href="${B}/services/knee-pain-treatment/">`),
  '/services/back-pain/': layout('Services | Acme Clinic', `<h1>Back pain</h1><p>Short page.</p>`),
  '/services/back-pain-copy/': layout('Back pain care | Acme Clinic', `<h1>Back pain care</h1><p>${lorem(30)}</p>`, `<meta name="robots" content="noindex">`),
  '/about/': layout('About Acme Clinic', `<h1>About us</h1><h1>Second H1</h1><p>${lorem(6)}</p><h4>Skipped level</h4>`),
  '/blog/': layout('Blog | Acme Clinic', `<h1>Blog</h1><a href="/blog/knee-exercises/">Knee exercises</a> <a href="/old-post/">Old post</a>`),
  '/blog/knee-exercises/': layout('Knee Exercises | Acme Clinic', `<h1>Knee exercises</h1><p>${lorem(30)}</p>`),
  '/contact/': layout('Contact | Acme Clinic', `<h1>Contact</h1><form><input type="text" name="n"><input type="email" id="e"></form>`),
  '/privacy-policy/': layout('Privacy | Acme Clinic', `<h1>Privacy</h1><p>Policy text.</p>`),
  '/orphan-page/': layout('Orphan | Acme Clinic', `<h1>Orphan page about hip pain</h1><p>${lorem(10)}</p>`),
  '/private/secret/': layout('Secret', '<h1>Secret</h1>'),
};
app.get('/old-post/', (q, r) => r.redirect(302, '/old-post-2/'));
app.get('/old-post-2/', (q, r) => r.redirect(301, '/blog/knee-exercises/'));
app.get('/robots.txt', (q, r) => r.type('text/plain').send(`User-agent: *\nDisallow: /private/\nDisallow: /services/back-pain-copy/\nNoindex: /foo\nSitemap: ${B}/sitemap.xml\n`));
app.get('/sitemap.xml', (q, r) => r.type('application/xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/services/', '/services/knee-pain-treatment/', '/orphan-page/', '/broken-page/', '/old-post/', '/private/secret/'].map(u => `<url><loc>${B}${u}</loc><lastmod>2031-01-01</lastmod></url>`).join('')}</urlset>`));
app.get('/llms.txt', (q, r) => r.type('text/plain').send(`# Acme Clinic\n\n> Orthopedic clinic in Plano, TX.\n\n## Services\n\n- [Knee pain](${B}/services/knee-pain-treatment/): Non surgical knee care\n- [Missing page](${B}/gone/)\n- [Old post](${B}/old-post/)\n`));
app.get('/style.css', (q, r) => r.type('text/css').send('body{}'));
Object.entries(pages).forEach(([p, h]) => app.get(p, (q, r) => r.type('html').send(h)));
app.use((q, r) => r.status(404).type('html').send('<h1>Not found</h1>'));

const server = app.listen(PORT, async () => {
  if (process.argv.includes('--serve')) return console.log(`Fixture site on ${B}`);
  try {
    const t = Date.now();
    const report = await runAudit(`${B}/`, { limit: 50, onStage: s => process.stdout.write(`\r${s.progress}% ${s.stage}                    `), onLog: m => console.log('\n  ' + m) });
    console.log(`\n\nDone in ${Date.now() - t}ms`);
    console.log('SEO health:', report.scores.health, report.scores.grade, '| categories:', Object.values(report.scores.categories).map(c => `${c.key}=${c.score}`).join(' '));
    console.log('Pages:', report.meta.pagesCrawled, 'html:', report.meta.htmlPages, 'indexability:', JSON.stringify(report.indexability.summary));
    console.log('Issues:', report.issues.length);
    report.issues.forEach(i => console.log(`  [${i.severity}] ${i.category}/${i.id} (${i.count}) ${i.title}`));
    console.log('llms:', report.llms.score, JSON.stringify(report.llms.links), 'coverage', report.llms.coverage?.percent);
    console.log('AEO', report.aeo.score, 'GEO', report.geo.score, 'Trust', report.trust.score, 'Local', report.local.score);
    console.log('Estimates keywords', report.estimates.keywords.min, report.estimates.keywords.max, report.estimates.keywords.confidence, '| traffic', report.estimates.traffic.min, report.estimates.traffic.max, report.estimates.traffic.confidence, '| value', report.estimates.value.min, report.estimates.value.max);
    console.log('Industry', report.content.industry, 'topics', report.content.siteTopics.slice(0, 5).map(t => t.phrase));
    console.log('Page types', JSON.stringify(report.content.pageTypes));
    console.log('Suggested llms.txt:\n' + report.llms.suggested.content);
    console.log('JSON size KB', Math.round(JSON.stringify(report).length / 1024));
  } catch (e) { console.error('\nFAILED', e); process.exitCode = 1; }
  server.close();
});
