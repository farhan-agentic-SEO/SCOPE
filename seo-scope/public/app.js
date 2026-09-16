const app = document.getElementById('app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? 'n/a' : Number(n).toLocaleString('en-US');
const compact = n => n == null ? 'n/a' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(Math.round(n));
const range = (o, unit = '') => o ? `${compact(o.min)} to ${compact(o.max)}${unit}` : 'n/a';
const money = o => o ? `$${compact(o.min)} to $${compact(o.max)}` : 'n/a';
const path = u => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const basis = b => `<span class="basis ${esc(b)}" title="${esc({ measured: 'Read directly from the site', calculated: 'Derived from measured data', estimated: 'Model prediction, not Google data', unavailable: 'Not knowable from a URL', generated: 'Generated suggestion' }[b] || '')}">${esc(b[0].toUpperCase() + b.slice(1))}</span>`;
const stat = (k, v, b, cls = '') => `<div class="stat ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div>${b ? `<div class="b">${basis(b)}</div>` : ''}</div>`;
const scoreColor = s => s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--medium)' : s >= 40 ? 'var(--high)' : 'var(--critical)';
const bars = (rows, max) => { const m = max || Math.max(1, ...rows.map(r => r[1])); return `<div class="bars">${rows.map(([l, v, suffix = '']) => `<div class="row"><span>${esc(l)}</span><span class="track"><i style="width:${Math.round((v / m) * 100)}%"></i></span><span>${fmt(v)}${suffix}</span></div>`).join('')}</div>`; };
const checklist = items => `<ul class="checklist">${items.map(c => `<li class="${c.pass ? 'ok' : ''}">${esc(c.label)}</li>`).join('')}</ul>`;
const table = (cols, rows, opts = {}) => rows.length ? `<div class="tablewrap"><table class="data"><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr ${opts.onRow ? `class="clickable" data-row="${esc(opts.onRow(r, i))}" tabindex="0"` : ''}>${cols.map(c => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="empty">${esc(opts.empty || 'Nothing to show.')}</p>`;
const evidenceList = (ev, max = 25) => ev?.length ? `<details class="ev"><summary>Show evidence (${ev.length})</summary><ul>${ev.slice(0, max).map(e => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(path(e.url))}</a>: ${esc(e.detail)}</li>`).join('')}${ev.length > max ? `<li>and ${ev.length - max} more in the CSV export</li>` : ''}</ul></details>` : '';

let state = { report: null, id: null };

// ---------- Start ----------
function renderStart(error = '') {
  document.title = 'SEO Scope: free website audit from a URL';
  app.innerHTML = `<main class="start wrap">
    <h1>See what search engines see on any website</h1>
    <p class="lede">Enter a URL. We crawl up to 100 pages and check technical SEO, content, internal links, schema, performance, answer engine readiness and llms.txt. No login, no API keys.</p>
    <form class="urlform" id="f">
      <label class="skip" for="u">Website URL</label>
      <input id="u" type="text" inputmode="url" autocomplete="url" placeholder="https://example.com" required autofocus>
      <label class="skip" for="lim">Crawl limit</label>
      <select id="lim" aria-label="Crawl limit"><option value="25">25 pages</option><option value="50">50 pages</option><option value="100" selected>100 pages</option><option value="250">250 pages</option></select>
      <button class="btn" type="submit">Analyze website</button>
    </form>
    <div class="form-error" role="alert">${esc(error)}</div>
    <div class="legend">
      <div>${basis('measured')}<p>Read directly from the site, its headers, robots.txt, sitemaps and llms.txt.</p></div>
      <div>${basis('calculated')}<p>Scores derived from what was measured, with the method shown.</p></div>
      <div>${basis('estimated')}<p>Model predictions such as traffic and keyword ranges. Never Google data.</p></div>
      <div>${basis('unavailable')}<p>Things a URL cannot reveal, like real rankings or backlinks. We say so.</p></div>
    </div>
  </main>`;
  document.getElementById('f').addEventListener('submit', async e => {
    e.preventDefault();
    const url = document.getElementById('u').value; const limit = document.getElementById('lim').value;
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Starting';
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, limit }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      history.pushState({}, '', `/?id=${j.id}`);
      poll(j.id, url, j.stages);
    } catch (err) { renderStart(err.message); document.getElementById('u').value = url; }
  });
}

// ---------- Progress ----------
async function poll(id, url, stages) {
  let lastStages = stages;
  const draw = job => {
    const idx = lastStages ? lastStages.findIndex(s => job.stage?.startsWith(s)) : -1;
    app.innerHTML = `<main class="progress" aria-live="polite">
      <p class="fine">Analyzing</p><h2>${esc(url || job.input)}</h2>
      <div class="bar" role="progressbar" aria-valuenow="${job.progress || 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${job.progress || 0}%"></i></div>
      <p>${esc(job.stage || 'Starting')}</p>
      ${lastStages ? `<ol class="stages">${lastStages.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : 'todo'}">${esc(i === idx ? job.stage : s)}</li>`).join('')}</ol>` : ''}
      <div class="logs">${(job.log || []).slice(-6).map(l => `<div>${esc(l.msg)}</div>`).join('')}</div>
      <p class="fine" style="margin-top:24px">Large sites take a few minutes. Link checks and PageSpeed data are the slowest steps.</p>
    </main>`;
  };
  while (true) {
    let job;
    try { const r = await fetch(`/api/analysis/${id}`); job = await r.json(); if (!r.ok) throw new Error(job.error); }
    catch (e) { return renderStart(e.message); }
    if (job.status === 'done') { state = { report: job.report, id }; return renderReport(); }
    if (job.status === 'error') { history.pushState({}, '', '/'); return renderStart(job.error); }
    draw(job);
    await new Promise(r => setTimeout(r, 1200));
  }
}

// ---------- Report ----------
const SECTIONS = [
  ['overview', 'Overview'], ['score', 'SEO health'], ['traffic', 'Traffic estimate'], ['keywords', 'Keyword estimate'], ['technical', 'Technical SEO'], ['indexability', 'Indexability'], ['onpage', 'On page'], ['content', 'Content'], ['links', 'Internal links'], ['schema', 'Schema'], ['performance', 'Performance'], ['images', 'Images'], ['local', 'Local SEO'], ['aeo', 'AEO'], ['geo', 'GEO and AI search'], ['llms', 'llms.txt'], ['trust', 'Trust signals'], ['opportunities', 'Opportunities'], ['issues', 'Issues'], ['pages', 'Pages'], ['crawl', 'Crawl data'], ['unavailable', 'Not measurable'],
];

function renderReport() {
  const R = state.report; const host = new URL(R.meta.homeUrl).hostname;
  document.title = `${host}: SEO ${R.scores.health}/100 | SEO Scope`;
  const count = cat => R.issues.filter(i => (Array.isArray(cat) ? cat : [cat]).includes(i.category)).length;
  const navCounts = { technical: count(['technical', 'security', 'international']), indexability: count('indexability'), onpage: count(['onpage', 'social']), content: count('content'), links: count('links'), schema: count('schema'), performance: count('performance'), local: count('local'), llms: count('llms'), issues: R.issues.length, pages: R.pages.length };
  app.innerHTML = `
  <div class="topbar"><div class="wrap">
    <a class="brand" href="/">SEO Scope</a><span class="site" title="${esc(R.meta.homeUrl)}">${esc(R.meta.homeUrl)}</span>
    <div class="actions">
      <a class="btn ghost" href="/api/analysis/${state.id}/issues.csv">Issues CSV</a>
      <a class="btn ghost" href="/api/analysis/${state.id}/export.json">Full JSON</a>
      <button class="btn ghost" id="print">Print or PDF</button>
      <button class="btn danger" id="del">Delete analysis</button>
    </div>
  </div></div>
  <div class="wrap layout">
    <nav class="sidenav" aria-label="Report sections">${SECTIONS.map(([id, label]) => `<a href="#${id}" data-nav="${id}">${esc(label)}${navCounts[id] ? `<span class="n">${navCounts[id]}</span>` : ''}</a>`).join('')}</nav>
    <div id="sections">${SECTIONS.map(([id]) => `<section class="sec" id="${id}">${(RENDER[id] || (() => ''))(R)}</section>`).join('')}</div>
  </div>
  <div class="drawer" id="drawer" aria-hidden="true"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="drawer-title"></div></div>`;
  bindReport();
}

const head = (title, b, intro = '') => `<header><h2>${esc(title)}</h2>${b ? basis(b) : ''}</header>${intro ? `<p class="intro">${intro}</p>` : ''}`;
const issuesFor = (R, cats) => { const list = R.issues.filter(i => cats.includes(i.category)); return list.length ? list.map(oppItem).join('') : '<p class="empty">No issues found in this area.</p>'; };
function oppItem(i) {
  return `<div class="opp ${esc(i.severity)}"><h4>${esc(i.title || i.issue)}</h4>
    <div class="meta"><span class="sev ${esc(i.severity)}">${esc(i.severity)}</span><span>${fmt(i.count)} affected</span><span>Impact: ${esc(i.impact)}</span><span>Effort: ${esc(i.effort)}</span>${basis(i.basis)}</div>
    <dl><dt>Why it matters</dt><dd>${esc(i.why)}</dd><dt>Fix</dt><dd>${esc(i.fix)}</dd></dl>${evidenceList(i.evidence)}</div>`;
}

const RENDER = {
  overview: R => {
    const t = R.technical; const ix = R.indexability.summary; const crit = R.issues.filter(i => i.severity === 'critical').length; const high = R.issues.filter(i => i.severity === 'high').length;
    return `${head('Overview', null, `Crawled ${fmt(R.meta.pagesCrawled)} URLs from ${esc(R.meta.homeUrl)} in ${Math.max(1, Math.round(R.meta.durationMs / 1000))} second${Math.round(R.meta.durationMs / 1000) > 1 ? 's' : ''} (limit ${R.meta.crawlLimit}).${R.meta.notCrawledInBudget ? ` ${fmt(R.meta.notCrawledInBudget)} more URLs were queued but outside the crawl limit.` : ''}`)}
    <div class="grid">
      ${stat('SEO health', `${R.scores.health}<small style="font-size:14px;color:var(--muted)"> / 100</small>`, 'calculated')}
      ${stat('Critical and high issues', `${crit} / ${high}`, 'measured')}
      ${stat('Indexable pages', `${fmt(ix.indexable)} of ${fmt(R.meta.htmlPages)}`, 'measured')}
      ${stat('Median response', `${fmt(t.responseTime.median)} ms`, 'measured')}
      ${stat('Estimated organic traffic', range(R.estimates.traffic, '/mo'), 'estimated', 'range')}
      ${stat('AI search readiness', `${R.geo.score} / 100`, 'calculated')}
      ${stat('llms.txt', R.llms.files.llms.exists ? `${R.llms.score} / 100` : 'Not found', R.llms.files.llms.exists ? 'calculated' : 'measured')}
      ${stat('Technology', esc(t.technology.slice(0, 3).join(', ') || 'Not detected'), 'measured')}
    </div>
    <h3>Top priorities</h3>
    ${[...R.opportunities.groups.Critical, ...R.opportunities.groups['High impact']].slice(0, 5).map(o => oppItem({ ...o, title: o.issue, severity: o.priority === 'Critical' ? 'critical' : 'high' })).join('') || '<p class="empty">No critical or high impact issues. Review the medium opportunities.</p>'}`;
  },
  score: R => {
    const s = R.scores; const cats = Object.values(s.categories);
    return `${head('SEO health', 'calculated', esc(s.method) + ' Traffic is not part of this score.')}
    <div class="health">
      <div><div class="big" style="color:${scoreColor(s.health)}">${s.health}<small> / 100</small></div><div class="grade">${esc(s.grade)}</div>${s.cappedByCritical ? `<p class="fine">Capped at 69 because critical issues exist (uncapped ${s.rawHealth}).</p>` : ''}</div>
      <table class="ledger"><tbody>${cats.map(c => `<tr><td>${esc(c.label)}</td><td class="meter"><div class="meterbar"><i style="width:${c.score}%;background:${scoreColor(c.score)}"></i></div></td><td>${c.score}</td><td class="fine">${c.points} of ${c.weight} pts</td></tr>`).join('')}</tbody></table>
    </div>
    <h3>Secondary scores (not in health total)</h3>
    <div class="grid">${stat('Accessibility signals', R.onpage.accessibilityScore != null ? `${R.onpage.accessibilityScore} / 100` : 'n/a', 'calculated')}${stat('Local SEO signals', R.local.score != null ? `${R.local.score} / 100` : 'Not a local site', 'calculated')}${stat('AEO readiness', `${R.aeo.score} / 100`, 'calculated')}${stat('Trust signals detected', `${R.trust.passed} / ${R.trust.total}`, 'measured')}</div>`;
  },
  traffic: R => {
    const e = R.estimates; const t = e.traffic;
    return `${head('Traffic estimate', 'estimated')}
    <div class="callout">${esc(e.disclaimer)}</div>
    <div class="grid">${stat('Estimated organic traffic', range(t, '/mo'), 'estimated', 'range')}${stat('Confidence', esc(t.confidence), 'calculated')}${stat('Estimated traffic value', money(e.value) + '/mo', 'estimated', 'range')}${stat('Modeled opportunity', '+' + range(e.opportunity, '/mo'), 'estimated', 'range')}</div>
    <p class="fine" style="margin-top:10px">Traffic value is what similar paid clicks might cost. It is not revenue.</p>
    <div class="two"><div><h3>By intent</h3>${table([{ label: 'Segment', key: 'k' }, { label: 'Estimated monthly visits', render: r => range(r) , cls: 'num' }], Object.entries(t.breakdown).map(([k, v]) => ({ k, ...v })))}</div>
    <div><h3>How this was estimated</h3><p>${esc(t.methodology)}</p><ul class="fine">${t.signals.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p class="fine">${esc(e.value.methodology)}</p></div></div>
    <h3>Pages by modeled traffic</h3>
    ${table([{ label: 'Page', cls: 'url', render: r => esc(path(r.url)) }, { label: 'Detected topic', key: 'topic' }, { label: 'Demand', render: r => `${range(r.demand)} (${esc(r.demand.bucket)})`, cls: 'num' }, { label: 'Ranking band', key: 'ranking', cls: 'num' }, { label: 'Visits/mo', render: r => range(r.traffic), cls: 'num' }], t.pages.slice(0, 25))}
    <h3>Quick wins the model found</h3>
    ${table([{ label: 'Page', cls: 'url', render: r => esc(path(r.url)) }, { label: 'Topic', key: 'topic' }, { label: 'Suggested actions', render: r => esc(r.actions.join(', ')) }], e.opportunity.quickWins, { empty: 'No page level quick wins detected.' })}`;
  },
  keywords: R => {
    const k = R.estimates.keywords; const d = k.distribution;
    return `${head('Keyword estimate', 'estimated', 'How many search queries the site could plausibly appear for, based on content volume, structure and quality. Not a ranking report.')}
    <div class="grid">${stat('Estimated organic keywords', range(k), 'estimated', 'range')}${stat('Confidence', esc(k.confidence), 'calculated')}${stat('Branded', range(k.branded), 'estimated', 'range')}${stat('Non branded', range(k.nonBranded), 'estimated', 'range')}${stat('Long tail', range(k.longTail), 'estimated', 'range')}${stat('Local', range(k.local), 'estimated', 'range')}${stat('Question', range(k.question), 'estimated', 'range')}</div>
    <h3>Estimated position distribution</h3>
    ${table([{ label: 'Band', key: 'band' }, { label: 'Estimated keywords', render: r => range(r), cls: 'num' }], [['Top 3', d.top3], ['Top 10', d.top10], ['Top 20', d.top20], ['Top 50', d.top50], ['Top 100', d.top100]].map(([band, v]) => ({ band, ...v })))}
    <h3>Detected site topics and heuristic demand</h3>
    ${table([{ label: 'Topic', key: 'phrase' }, { label: 'Demand level', key: 'bucket' }, { label: 'Estimated searches/mo', render: r => range(r), cls: 'num' }, { label: 'Confidence', key: 'confidence' }], R.estimates.topicDemand)}
    <p class="fine" style="margin-top:10px">${esc(k.methodology)}</p>`;
  },
  technical: R => {
    const t = R.technical; const sh = t.securityHeaders;
    return `${head('Technical SEO', 'measured')}
    <div class="grid">${stat('HTTPS', t.httpsAvailable ? '<span class="pass">Yes</span>' : '<span class="fail">No</span>', 'measured')}${stat('HTTP redirects to HTTPS', t.httpRedirectsToHttps ? '<span class="pass">Yes</span>' : '<span class="fail">No</span>', 'measured')}${stat('One hostname', t.hostConsolidated ? '<span class="pass">Yes</span>' : '<span class="fail">No</span>', 'measured')}${stat('TLS certificate', t.certificate ? (t.certificate.error ? '<span class="fail">Error</span>' : `${t.certificate.daysRemaining} days left`) : 'n/a', 'measured')}${stat('Missing URL status', `${t.notFoundHandling.status}`, 'measured')}${stat('Response p90', `${fmt(t.responseTime.p90)} ms`, 'measured')}${stat('Compression', esc(t.compression || 'None'), 'measured')}${stat('Avg URL length', `${t.urlStructure.avgLength} chars`, 'measured')}</div>
    <div class="two"><div><h3>Status codes</h3>${bars(Object.entries(t.statusDistribution))}</div><div><h3>Hostname variants</h3>${table([{ label: 'Variant', key: 'url', cls: 'url' }, { label: 'Result', render: r => r.error ? esc(r.error) : `${r.status} at ${esc(r.finalUrl)}` }, { label: 'Hops', key: 'hops', cls: 'num' }], t.variants)}</div></div>
    <h3>Security headers</h3>${checklist(Object.entries(sh).map(([k, v]) => ({ label: { hsts: 'Strict-Transport-Security', csp: 'Content-Security-Policy', xContentTypeOptions: 'X-Content-Type-Options', xFrameOptions: 'Clickjacking protection', referrerPolicy: 'Referrer-Policy', permissionsPolicy: 'Permissions-Policy' }[k], pass: v })))}
    <h3>Technology detected</h3><div class="chips">${t.technology.map(x => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="empty">Nothing publicly detectable</span>'}</div>
    <h3>JavaScript rendering</h3><p>${esc(R.jsSeo.note)}</p>
    <h3>Issues</h3>${issuesFor(R, ['technical', 'security', 'international'])}`;
  },
  indexability: R => {
    const s = R.indexability.summary; const c = R.crawlability;
    return `${head('Indexability and crawlability', 'measured')}
    <div class="grid">${stat('Indexable', fmt(s.indexable), 'measured')}${stat('Noindex', fmt(s.noindex), 'measured')}${stat('Blocked by robots.txt', fmt(s.blocked + s.robotsBlockedNotCrawled), 'measured')}${stat('Canonicalized away', fmt(s.canonicalized), 'measured')}${stat('Redirected', fmt(s.redirected), 'measured')}${stat('Errors', fmt(s.errors), 'measured')}</div>
    <div class="two"><div><h3>robots.txt</h3>${c.robots.exists ? `<p>${fmt(c.robots.ruleCount)} rules for ${esc(c.robots.agents.join(', '))}. ${c.robots.wildcardRules} wildcard rules.</p><details class="ev"><summary>View file</summary><pre class="code">${esc(c.robots.raw)}</pre></details>` : `<p class="fail">Not found (${esc(c.robots.status)})</p>`}</div>
    <div><h3>XML sitemap</h3>${c.sitemap.found ? `${table([{ label: 'File', cls: 'url', render: r => esc(path(r.url)) }, { label: 'Type', key: 'type' }, { label: 'URLs', key: 'urlCount', cls: 'num' }, { label: 'Found via', key: 'source' }], c.sitemap.files)}${c.sitemapComparison ? `<div class="grid" style="margin-top:12px">${stat('Sitemap URLs', fmt(c.sitemapComparison.sitemapUrls), 'measured')}${stat('Crawled pages', fmt(c.sitemapComparison.crawledUrls), 'measured')}${stat('Indexable not in sitemap', fmt(c.sitemapComparison.indexableNotInSitemap), 'calculated')}${stat('Sitemap URLs not reached', fmt(c.sitemapComparison.sitemapNotCrawled), 'calculated')}</div>` : ''}` : '<p class="fail">No sitemap found</p>'}</div></div>
    <h3>Issues</h3>${issuesFor(R, ['crawlability', 'indexability'])}`;
  },
  onpage: R => {
    const o = R.onpage;
    return `${head('On page SEO', 'measured')}
    <div class="grid">${stat('Pages with titles', fmt(o.titleStats.withTitle), 'measured')}${stat('Average title length', `${o.titleStats.avgLength} chars`, 'measured')}${stat('Brand suffix', esc(o.brandSuffix || 'None detected'), 'calculated')}${stat('Pages with OG image', fmt(o.social.withOg), 'measured')}${stat('Twitter cards', fmt(o.social.withTwitter), 'measured')}${stat('hreflang pages', fmt(o.international.pagesWithHreflang), 'measured')}</div>
    <h3>Issues</h3>${issuesFor(R, ['onpage', 'social', 'mobile', 'accessibility'])}`;
  },
  content: R => {
    const c = R.content;
    return `${head('Content', 'measured', `Industry profile detected: <strong>${esc(c.industry)}</strong> (calculated from vocabulary). Average ${fmt(c.avgWords)} unique words per page.`)}
    <div class="two"><div><h3>Unique words per page</h3>${bars(c.wordHistogram.map(h => [h.label, h.count]))}</div><div><h3>Page types</h3>${bars(Object.entries(c.pageTypes).sort((a, b) => b[1] - a[1]))}<h3>Search intent</h3>${bars(Object.entries(c.intents).sort((a, b) => b[1] - a[1]))}</div></div>
    <h3>Site topics ${basis('calculated')}</h3><div class="chips">${c.siteTopics.map(t => `<span class="chip">${esc(t.phrase)}</span>`).join('')}</div>
    <h3>Entities found ${basis('measured')}</h3><div class="chips">${c.entities.slice(0, 25).map(e => `<span class="chip" title="${esc(e.type)} from ${esc(e.sources.join(', '))}">${esc(e.name)}</span>`).join('') || '<span class="empty">No named entities detected</span>'}</div>
    <h3>Similar page pairs ${basis('calculated')}</h3>${table([{ label: 'Page A', cls: 'url', render: r => esc(path(r.a)) }, { label: 'Page B', cls: 'url', render: r => esc(path(r.b)) }, { label: 'Similarity', render: r => r.similarity + '%', cls: 'num' }], c.duplicatePairs.slice(0, 30), { empty: 'No pages above 60% similarity.' })}
    <h3>Issues</h3>${issuesFor(R, ['content'])}`;
  },
  links: R => {
    const l = R.links;
    return `${head('Internal links', 'measured')}
    <div class="grid">${stat('Orphan pages', fmt(l.orphans), 'calculated')}${stat('Weakly linked pages', fmt(l.weak), 'calculated')}${stat('Broken internal links', fmt(l.brokenInternal), 'measured')}${stat('Broken external links', fmt(l.brokenExternal), 'measured')}${stat('Links checked', fmt(l.checkedLinks), 'measured')}${stat('Not checked (cap)', fmt(l.uncheckedLinks), 'measured')}</div>
    <div class="two"><div><h3>Click depth</h3>${bars(Object.entries(l.depthDistribution).sort())}</div><div><h3>Hub pages</h3>${table([{ label: 'Page', cls: 'url', render: r => esc(path(r.url)) }, { label: 'Linking pages', key: 'inlinkPages', cls: 'num' }, { label: 'Type', key: 'pageType' }], l.hubs)}</div></div>
    <h3>Site architecture ${basis('calculated')}</h3>${table([{ label: 'Section', key: 'seg' }, { label: 'Pages', key: 'count', cls: 'num' }, { label: 'Avg click depth', key: 'avgDepth', cls: 'num' }, { label: 'Page types', render: r => esc(Object.entries(r.types).map(([k, v]) => `${k} ${v}`).join(', ')) }], Object.entries(l.architecture).map(([seg, v]) => ({ seg: '/' + (seg === '(home)' ? '' : seg), ...v })).sort((a, b) => b.count - a.count))}
    <h3>Issues</h3>${issuesFor(R, ['links'])}`;
  },
  schema: R => {
    const s = R.schema;
    return `${head('Structured data', 'measured')}
    <div class="grid">${stat('Indexable pages with schema', `${fmt(s.pagesWithSchema)} of ${fmt(s.pagesTotal)}`, 'measured')}${stat('JSON-LD pages', fmt(s.formats.jsonld), 'measured')}${stat('Microdata pages', fmt(s.formats.microdata), 'measured')}${stat('Organization entity', s.organization ? esc(s.organization.name || 'Unnamed') : 'None', 'measured')}${stat('sameAs profiles', fmt(s.organization?.sameAs?.length || 0), 'measured')}</div>
    <h3>Types found</h3>${bars(Object.entries(s.typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20), null)}
    <h3>Issues</h3>${issuesFor(R, ['schema'])}`;
  },
  performance: R => {
    const p = R.performance; const m = p.pageSpeed.mobile; const d = p.pageSpeed.desktop;
    const lab = x => x.available ? `<div class="grid">${stat('Performance', x.scores.performance, 'measured')}${stat('LCP', (x.lab.lcp / 1000).toFixed(1) + ' s', 'measured')}${stat('CLS', x.lab.cls?.toFixed(3), 'measured')}${stat('TBT', Math.round(x.lab.tbt) + ' ms', 'measured')}${stat('FCP', (x.lab.fcp / 1000).toFixed(1) + ' s', 'measured')}${stat('Speed Index', (x.lab.speedIndex / 1000).toFixed(1) + ' s', 'measured')}${stat('Requests', fmt(x.lab.requests), 'measured')}${stat('Page weight', Math.round(x.lab.totalBytes / 1024) + ' KB', 'measured')}</div>` : `<p>${basis('unavailable')} ${esc(x.reason)}</p>`;
    const field = m.available && m.field ? table([{ label: 'Real user metric (p75)', key: 'k' }, { label: 'Value', key: 'p75', cls: 'num' }, { label: 'Rating', key: 'category' }], Object.entries(m.field).map(([k, v]) => ({ k, ...v }))) : `<p>${basis('unavailable')} Chrome UX Report field data is not available for this URL (not enough real user traffic or PageSpeed unavailable).</p>`;
    return `${head('Performance', null, esc(p.note))}
    <h3>Mobile lab data (homepage)</h3>${lab(m)}<h3>Desktop lab data (homepage)</h3>${lab(d)}
    <h3>Core Web Vitals field data</h3>${field}
    ${m.available && m.opportunities.length ? `<h3>Top Lighthouse opportunities</h3>${table([{ label: 'Opportunity', key: 'title' }, { label: 'Potential saving', render: r => esc(r.display || r.savingsMs + ' ms') }], m.opportunities)}` : ''}
    <h3>Measured from raw HTML (median across pages)</h3><div class="grid">${stat('TTFB', p.medians.ttfb + ' ms', 'measured')}${stat('HTML size', p.medians.htmlKb + ' KB', 'measured')}${stat('DOM elements', fmt(p.medians.domElements), 'measured')}${stat('Scripts', p.medians.scripts, 'measured')}${stat('Render blocking', p.medians.renderBlocking, 'measured')}</div>
    <h3>Issues</h3>${issuesFor(R, ['performance'])}`;
  },
  images: R => {
    const s = R.onpage.imageStats; const sv = R.links.imageSavings;
    return `${head('Images', 'measured')}
    <div class="grid">${stat('Images found', fmt(s.total), 'measured')}${stat('Missing alt', fmt(s.missingAlt), 'measured')}${stat('Decorative (empty alt)', fmt(s.emptyAlt), 'measured')}${stat('WebP, AVIF or SVG', fmt(s.modernFormat), 'measured')}${stat('Lazy loaded', fmt(s.lazy), 'measured')}${stat('With dimensions', fmt(s.withDimensions), 'measured')}${stat('Potential savings', `${Math.round(sv.estimatedBytes / 1024)} KB`, 'estimated')}</div>
    <p class="fine" style="margin-top:10px">${esc(sv.method)} ${fmt(sv.sampledImages)} images sampled.</p>
    <h3>Issues</h3>${R.issues.filter(i => i.id.startsWith('img-') || i.id === 'heavy-images').map(oppItem).join('') || '<p class="empty">No image issues found.</p>'}`;
  },
  local: R => {
    const l = R.local;
    return `${head('Local SEO signals', 'measured', esc(l.note))}
    ${l.isLocal ? `<div class="grid">${stat('Local signal score', `${l.score} / 100`, 'calculated')}${stat('Phone numbers', fmt(l.phones.length), 'measured')}${stat('Addresses found', fmt(l.addresses.length), 'measured')}${stat('Location pages', fmt(l.locationPages.length), 'measured')}</div>
    <div class="two"><div><h3>Checks</h3>${checklist(l.checks)}</div><div><h3>NAP details found</h3>${l.schema ? `<p>Schema: ${esc([].concat(l.schema.type).join(', '))}, ${esc(l.schema.name)}, ${esc(l.schema.telephone || 'no phone')}</p>` : ''}${table([{ label: 'Phone', key: 'number' }, { label: 'Pages', key: 'pages', cls: 'num' }], l.phones)}<p class="fine">${esc(l.addresses.join(' / '))}</p></div></div>` : '<p class="empty">No local business signals (address, maps links, LocalBusiness schema or location pages) were found, so no local score is given.</p>'}
    <h3>Issues</h3>${issuesFor(R, ['local'])}`;
  },
  aeo: R => `${head('Answer engine optimization', 'calculated', esc(R.aeo.label))}
    <div class="grid">${stat('AEO readiness', `${R.aeo.score} / 100`, 'calculated')}</div>
    <h3>Lowest scoring pages</h3>${table([{ label: 'Page', cls: 'url', render: r => esc(path(r.url)) }, { label: 'Type', key: 'pageType' }, { label: 'Score', key: 'score', cls: 'num' }], R.aeo.pages.slice(0, 20))}
    <h3>Issues</h3>${R.issues.filter(i => i.id.startsWith('aeo-')).map(oppItem).join('') || '<p class="empty">No AEO issues found.</p>'}`,
  geo: R => `${head('GEO and AI search readiness', 'calculated', esc(R.geo.label))}
    <div class="grid">${stat('AI search readiness', `${R.geo.score} / 100`, 'calculated')}</div>
    <h3>Factors</h3>${table([{ label: 'Factor', key: 'label' }, { label: 'Signal strength', render: r => `<div class="meterbar" style="min-width:120px"><i style="width:${r.value}%;background:${scoreColor(r.value)}"></i></div>` }, { label: '%', key: 'value', cls: 'num' }, { label: 'Weight', key: 'weight', cls: 'num' }], R.geo.factors)}
    <h3>Issues</h3>${R.issues.filter(i => i.id.startsWith('geo-')).map(oppItem).join('') || '<p class="empty">No GEO issues found.</p>'}`,
  llms: R => {
    const L = R.llms; const f = L.files;
    const fileRow = (name, x) => ({ name, status: x.status, exists: x.exists, bytes: x.bytes, type: x.contentType, note: x.htmlFallback ? 'HTML page returned (soft 404)' : x.redirected ? `Redirects to ${x.finalUrl}` : '' });
    return `${head('llms.txt', null, esc(L.basisNote))}
    <div class="grid">${stat('/llms.txt', f.llms.exists ? '<span class="pass">Found</span>' : '<span class="fail">Not found</span>', 'measured')}${stat('/llms-full.txt', f.llmsFull.exists ? '<span class="pass">Found</span>' : 'Not found', 'measured')}${stat('LLM readiness of file', f.llms.exists ? `${L.score} / 100` : '0 / 100', 'calculated')}${L.links ? stat('Links in file', `${L.links.total} (${L.links.broken} broken)`, 'measured') : ''}${L.coverage ? stat('Important page coverage', `${L.coverage.percent}%`, 'calculated') : ''}</div>
    <h3>Files checked</h3>${table([{ label: 'File', key: 'name' }, { label: 'Status', key: 'status', cls: 'num' }, { label: 'Valid file', render: r => r.exists ? '<span class="pass">Yes</span>' : '<span class="fail">No</span>' }, { label: 'Size', render: r => !r.exists ? '' : r.bytes < 1024 ? r.bytes + ' bytes' : Math.round(r.bytes / 1024) + ' KB', cls: 'num' }, { label: 'Content type', key: 'type' }, { label: 'Note', key: 'note' }], [fileRow('/llms.txt', f.llms), fileRow('/llms-full.txt', f.llmsFull), fileRow('/.well-known/llms.txt', f.wellKnown)])}
    ${L.parsed ? `<h3>Structure ${basis('measured')}</h3><div class="grid">${stat('H1 title', esc(L.parsed.h1 || 'Missing'), 'measured')}${stat('Summary', L.parsed.summary ? 'Present' : 'Missing', 'measured')}${stat('Sections', fmt(L.parsed.sections.length), 'measured')}${stat('Links with descriptions', `${L.links.withDescriptions} of ${L.links.total}`, 'measured')}</div>
      ${table([{ label: 'Section', key: 'name' }, { label: 'Links', key: 'links', cls: 'num' }, { label: 'Line', key: 'line', cls: 'num' }], L.parsed.sections)}
      <h3>Score breakdown ${basis('calculated')}</h3>${table([{ label: 'Check', key: 'label' }, { label: '%', key: 'value', cls: 'num' }, { label: 'Weight', key: 'weight', cls: 'num' }], L.scoreBreakdown)}
      ${L.coverage ? `<h3>Coverage by page type ${basis('calculated')}</h3>${table([{ label: 'Page type', key: 't' }, { label: 'On site', key: 'total', cls: 'num' }, { label: 'Listed', key: 'listed', cls: 'num' }], Object.entries(L.coverage.byType).map(([t, v]) => ({ t, ...v })))}` : ''}
      <details class="ev"><summary>View current file</summary><pre class="code">${esc(L.raw)}</pre></details>` : ''}
    ${L.full ? `<h3>llms-full.txt ${basis('measured')}</h3><div class="grid">${stat('Words', fmt(L.full.words), 'measured')}${stat('Headings', fmt(L.full.headings), 'measured')}${stat('Site URLs referenced', fmt(L.full.sameSiteUrls), 'measured')}</div>` : ''}
    <h3>Suggested llms.txt ${basis('generated')}</h3><p class="fine">${esc(L.suggested.note)}</p>
    <div class="actions" style="margin:8px 0"><a class="btn ghost" href="/api/analysis/${state.id}/llms.txt">Download llms.txt</a><button class="btn ghost" id="copyllms">Copy</button></div>
    <pre class="code" id="llmscode">${esc(L.suggested.content)}</pre>
    <h3>Issues</h3>${issuesFor(R, ['llms'])}`;
  },
  trust: R => `${head('Trust and experience signals', 'measured', esc(R.trust.note))}
    <div class="grid">${stat('Detected trust signals', `${R.trust.passed} / ${R.trust.total}`, 'measured')}</div>
    <h3>Signals</h3>${checklist(R.trust.checks)}
    <h3>Issues</h3>${issuesFor(R, ['trust'])}`,
  opportunities: R => {
    const g = R.opportunities.groups;
    return `${head('Opportunities', 'calculated', 'Every issue, ordered by severity, then impact, then lowest effort.')}
    ${Object.entries(g).map(([name, items]) => `<h3>${esc(name)} (${items.length})</h3>${items.length ? items.map(o => oppItem({ ...o, title: o.issue, severity: name === 'Critical' ? 'critical' : name === 'High impact' ? 'high' : name.toLowerCase() })).join('') : '<p class="empty">None.</p>'}`).join('')}`;
  },
  issues: R => `${head('All issues', null, 'Filter by severity, category or URL. Export the full list with evidence as CSV.')}
    <div class="filters"><input id="iq" type="search" placeholder="Filter by URL or text" aria-label="Filter issues"><select id="isev" aria-label="Severity"><option value="">All severities</option><option>critical</option><option>high</option><option>medium</option><option>low</option></select><select id="icat" aria-label="Category"><option value="">All categories</option>${[...new Set(R.issues.map(i => i.category))].sort().map(c => `<option>${esc(c)}</option>`).join('')}</select><select id="ibasis" aria-label="Evidence basis"><option value="">Any basis</option><option>measured</option><option>calculated</option></select></div>
    <div id="issuetable"></div>`,
  pages: R => `${head('Pages', 'measured', 'Select a row for the page level report.')}
    <div class="filters"><input id="pq" type="search" placeholder="Filter by URL or title" aria-label="Filter pages"><select id="ptype" aria-label="Page type"><option value="">All page types</option>${[...new Set(R.pages.map(p => p.pageType).filter(Boolean))].sort().map(t => `<option>${esc(t)}</option>`).join('')}</select><select id="pidx" aria-label="Indexability"><option value="">Any status</option><option value="yes">Indexable</option><option value="no">Not indexable</option></select></div>
    <div id="pagetable"></div>`,
  crawl: R => `${head('Crawl data', 'measured')}
    <div class="grid">${stat('URLs crawled', fmt(R.meta.pagesCrawled), 'measured')}${stat('HTML pages', fmt(R.meta.htmlPages), 'measured')}${stat('Blocked by robots.txt (not fetched)', fmt(R.meta.blockedByRobots), 'measured')}${stat('Queued beyond limit', fmt(R.meta.notCrawledInBudget), 'measured')}${stat('User agent', esc(R.meta.userAgent), null)}</div>
    <h3>Redirects</h3>${table([{ label: 'From', cls: 'url', render: r => esc(path(r.url)) }, { label: 'To', cls: 'url', render: r => esc(r.finalUrl) }, { label: 'Hops', key: 'hops', cls: 'num' }], R.technical.redirects, { empty: 'No redirects found in the crawl.' })}
    <h3>Blocked by robots.txt</h3>${table([{ label: 'URL', cls: 'url', render: r => esc(r.url) }, { label: 'Rule', render: r => r.rule ? esc(`${r.rule.type}: ${r.rule.path}`) : '' }], R.crawl.blockedByRobots, { empty: 'Nothing was blocked.' })}
    <h3>Sitemap URLs (first 500)</h3><details class="ev"><summary>Show ${fmt(R.crawl.sitemapUrls.length)} URLs</summary>${table([{ label: 'URL', cls: 'url', key: 'url' }, { label: 'lastmod', key: 'lastmod' }, { label: 'Problems', render: r => esc(r.problems.join(', ')) }], R.crawl.sitemapUrls)}</details>`,
  unavailable: R => `${head('Not measurable from a URL', 'unavailable', 'These are shown as unavailable instead of being guessed. Estimates elsewhere in the report are clearly labeled.')}
    ${table([{ label: 'Metric', key: 'metric' }, { label: 'What it requires', key: 'requires' }], R.unavailable)}
    <h3>Potential competitors ${basis('unavailable')}</h3><p>${esc(R.competitors.reason)}</p><p>${esc(R.competitors.howToFind)}</p><div class="chips">${R.competitors.profile.topics.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>`,
};

function bindReport() {
  const R = state.report;
  document.getElementById('print').onclick = () => { document.querySelectorAll('details').forEach(d => d.open = true); window.print(); };
  document.getElementById('del').onclick = async () => { if (!confirm('Delete this analysis from the server? This cannot be undone.')) return; await fetch(`/api/analysis/${state.id}`, { method: 'DELETE' }); history.pushState({}, '', '/'); renderStart('Analysis deleted.'); };
  const copy = document.getElementById('copyllms'); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(R.llms.suggested.content); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; } };

  // Issue table filters
  const drawIssues = () => {
    const q = document.getElementById('iq').value.toLowerCase(); const sev = document.getElementById('isev').value; const cat = document.getElementById('icat').value; const b = document.getElementById('ibasis').value;
    const rows = R.issues.flatMap(i => i.evidence.map(e => ({ ...i, url: e.url, detail: e.detail }))).filter(r => (!sev || r.severity === sev) && (!cat || r.category === cat) && (!b || r.basis === b) && (!q || `${r.url} ${r.title} ${r.detail}`.toLowerCase().includes(q)));
    const order = { critical: 0, high: 1, medium: 2, low: 3 }; rows.sort((a, b) => order[a.severity] - order[b.severity]);
    document.getElementById('issuetable').innerHTML = `<p class="fine">${fmt(rows.length)} rows${rows.length > 400 ? ', showing first 400' : ''}</p>` + table([{ label: 'Severity', render: r => `<span class="sev ${r.severity}">${r.severity}</span>` }, { label: 'Issue', key: 'title' }, { label: 'URL', cls: 'url', render: r => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(path(r.url))}</a>` }, { label: 'Evidence', key: 'detail' }, { label: 'Category', key: 'category' }], rows.slice(0, 400), { empty: 'No issues match these filters.' });
  };
  ['iq', 'isev', 'icat', 'ibasis'].forEach(id => document.getElementById(id).addEventListener('input', drawIssues)); drawIssues();

  const drawPages = () => {
    const q = document.getElementById('pq').value.toLowerCase(); const t = document.getElementById('ptype').value; const ix = document.getElementById('pidx').value;
    const rows = R.pages.map((p, i) => ({ ...p, i })).filter(p => (!t || p.pageType === t) && (!ix || (ix === 'yes') === !!p.indexability?.indexable) && (!q || `${p.url} ${p.finalUrl} ${p.title || ''}`.toLowerCase().includes(q)));
    document.getElementById('pagetable').innerHTML = table([
      { label: 'URL', cls: 'url', render: p => p.redirected ? `${esc(path(p.url))} <span class="fine">redirects to ${esc(path(p.finalUrl))}</span>` : esc(path(p.finalUrl)) }, { label: 'Status', render: p => p.redirected ? (p.redirectChain?.[0]?.status || 301) : (p.status || esc(p.error || 'failed')), cls: 'num' }, { label: 'Type', render: p => esc(p.pageType || '') },
      { label: 'Indexable', render: p => p.indexability?.indexable ? '<span class="pass">Yes</span>' : `<span class="fail" title="${esc(p.indexability?.reasons?.join(', '))}">No</span>` },
      { label: 'Score', render: p => p.score != null ? `<span style="color:${scoreColor(p.score)}">${p.score}</span>` : '', cls: 'num' }, { label: 'Words', render: p => fmt(p.content?.uniqueWords), cls: 'num' },
      { label: 'Inlinks', render: p => fmt(p.linkStats?.uniqueInlinkPages), cls: 'num' }, { label: 'Depth', render: p => p.clickDepth ?? '', cls: 'num' }, { label: 'Issues', render: p => fmt(p.issues?.length), cls: 'num' },
    ], rows, { onRow: p => p.i });
    document.querySelectorAll('#pagetable tr[data-row]').forEach(tr => { const open = () => openPage(R.pages[tr.dataset.row]); tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); }; });
  };
  ['pq', 'ptype', 'pidx'].forEach(id => document.getElementById(id).addEventListener('input', drawPages)); drawPages();

  // Active nav on scroll
  const links = [...document.querySelectorAll('[data-nav]')];
  const obs = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('active', a.dataset.nav === en.target.id)); }), { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('section.sec').forEach(s => obs.observe(s));
  const drawer = document.getElementById('drawer');
  drawer.addEventListener('click', e => { if (e.target === drawer) closeDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}

function closeDrawer() { const d = document.getElementById('drawer'); if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); } }

function openPage(p) {
  const d = document.getElementById('drawer'); const sheet = d.querySelector('.sheet');
  const pf = v => v ? '<span class="pass">Pass</span>' : '<span class="fail">Fail</span>';
  const sub = p.subScores || {};
  sheet.innerHTML = `<button class="btn ghost" id="closeDrawer" style="float:right">Close</button>
    <p class="fine">${esc(p.pageType || 'page')} page ${basis('measured')}</p><h2 id="drawer-title">${esc(path(p.redirected ? p.url : p.finalUrl))}</h2>${p.redirected ? `<p>Redirects to ${esc(p.finalUrl)} through ${p.redirectChain.length} hop(s): ${esc(p.redirectChain.map(c => c.status).join(', '))}</p>` : ''}
    <p><a href="${esc(p.finalUrl)}" target="_blank" rel="noopener">Open page</a></p>
    ${!p.title && !p.redirected && p.status !== 200 ? `<p>Status ${esc(p.status || 'failed')} ${esc(p.error || '')}</p>` : ''}
    <div class="grid">${stat('Page score', p.score ?? 'n/a', 'calculated')}${stat('Title', pf(p.checks?.title), 'measured')}${stat('Meta', pf(p.checks?.meta), 'measured')}${stat('H1', pf(p.checks?.h1), 'measured')}${stat('Content', sub.content ?? 'n/a', 'calculated')}${stat('Internal links', sub.internalLinks ?? 'n/a', 'calculated')}${stat('Schema', sub.schema ?? 'n/a', 'calculated')}${stat('Performance', sub.performance ?? 'n/a', 'calculated')}${stat('AEO', p.aeo ?? 'n/a', 'calculated')}</div>
    ${p.estimate ? `<h3>Model estimate ${basis('estimated')}</h3><p>Topic "${esc(p.estimate.topic)}", likely ranking band ${esc(p.estimate.ranking)}, estimated ${range(p.estimate.traffic)} visits a month. Low confidence.</p>` : ''}
    <h3>Issues</h3>${p.issues?.length ? table([{ label: 'Severity', render: r => `<span class="sev ${r.severity}">${r.severity}</span>` }, { label: 'Issue', key: 'title' }, { label: 'Detail', key: 'detail' }], p.issues) : '<p class="empty">No page level issues.</p>'}
    <h3>Technical</h3>${table([{ label: 'Field', key: 'k' }, { label: 'Value', key: 'v' }], [
      ['Status', p.status], ['Response time', `${p.ttfb} ms`], ['Click depth', p.clickDepth], ['In sitemap', p.inSitemap ? 'Yes' : 'No'], ['Indexable', p.indexability?.indexable ? 'Yes' : `No: ${p.indexability?.reasons?.join(', ')}`], ['Canonical', p.canonical || 'None'], ['Meta robots', p.robots?.meta || 'None'], ['X-Robots-Tag', p.robots?.header || 'None'], ['Language', p.lang || 'None'], ['HTML size', p.htmlBytes ? Math.round(p.htmlBytes / 1024) + ' KB' : ''], ['DOM elements', p.domElements], ['Scripts / stylesheets', `${p.scripts} / ${p.stylesheets}`],
    ].map(([k, v]) => ({ k, v })))}
    <h3>Title and description</h3><p><strong>${esc(p.title || 'No title')}</strong> <span class="fine">(${(p.title || '').length} chars)</span></p><p>${esc(p.metaDescription || 'No meta description')} <span class="fine">(${(p.metaDescription || '').length} chars)</span></p>
    <h3>Detected topics ${basis('calculated')}</h3>${p.topics ? `<p>Primary: <strong>${esc(p.topics.primary)}</strong>, alignment ${esc(p.topics.alignmentLevel)} (${p.topics.alignmentScore}%), intent ${esc(p.topics.intent)}</p><div class="chips">${p.topics.secondary.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : '<p class="empty">n/a</p>'}
    <h3>Content</h3>${p.content ? `<div class="grid">${stat('Words (main)', fmt(p.content.words), 'measured')}${stat('Unique words', fmt(p.content.uniqueWords), 'calculated')}${stat('Boilerplate', p.content.boilerplatePct + '%', 'calculated')}${stat('Reading ease', p.content.readingEase ?? 'n/a', 'calculated')}${stat('Text to HTML', Math.round((p.content.textRatio || 0) * 100) + '%', 'measured')}</div>` : ''}
    <h3>Headings</h3>${p.headings?.length ? `<pre class="code">${esc(p.headings.map(h => `${'  '.repeat(h.level - 1)}H${h.level} ${h.text}`).join('\n'))}</pre>` : '<p class="empty">No headings.</p>'}
    <h3>Links</h3><p>${fmt(p.linkStats?.uniqueInlinkPages)} pages link here (${fmt(p.linkStats?.contextualInlinks)} from content). Outgoing: ${fmt(p.linkStats?.uniqueInternal)} internal, ${fmt(p.linkStats?.uniqueExternal)} external.</p>
    ${p.linkStats?.topAnchors?.length ? `<p class="fine">Anchors used to link here: ${esc(p.linkStats.topAnchors.map(a => `"${a.text}"`).join(', '))}</p>` : ''}
    <details class="ev"><summary>Internal links out (${p.internalLinksOut?.length || 0})</summary>${table([{ label: 'URL', cls: 'url', render: r => esc(path(r.href)) }, { label: 'Anchor', key: 'text' }, { label: 'Region', key: 'region' }], p.internalLinksOut || [])}</details>
    <details class="ev"><summary>External links (${p.externalLinksOut?.length || 0})</summary>${table([{ label: 'URL', cls: 'url', key: 'href' }, { label: 'Anchor', key: 'text' }, { label: 'Nofollow', render: r => r.nofollow ? 'Yes' : '' }], p.externalLinksOut || [])}</details>
    <h3>Schema</h3>${p.schemaReport?.entities?.length ? table([{ label: 'Type', key: 'type' }, { label: 'Missing required', render: r => esc(r.missingRequired.join(', ')) }, { label: 'Missing recommended', render: r => esc(r.missingRecommended.join(', ')) }], p.schemaReport.entities.filter(e => !e.nested || e.missingRequired.length)) : '<p class="empty">No structured data.</p>'}
    <h3>Images (${fmt(p.imageCount)})</h3>${table([{ label: 'File', cls: 'url', render: r => esc(r.file || r.src) }, { label: 'Alt', render: r => r.hasAlt ? esc(r.alt || '(empty)') : '<span class="fail">Missing</span>' }, { label: 'Size attrs', render: r => r.width && r.height ? `${esc(r.width)}x${esc(r.height)}` : '' }, { label: 'Lazy', render: r => r.loading ? 'Yes' : '' }], p.images || [], { empty: 'No images.' })}`;
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  document.getElementById('closeDrawer').onclick = closeDrawer; document.getElementById('closeDrawer').focus();
}

// ---------- Boot ----------
const id = new URLSearchParams(location.search).get('id');
if (id) poll(id); else renderStart();
window.addEventListener('popstate', () => { const i = new URLSearchParams(location.search).get('id'); if (i) poll(i); else renderStart(); });
