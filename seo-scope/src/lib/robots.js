import { fetchUrl } from './http.js';

const KNOWN = new Set(['user-agent', 'disallow', 'allow', 'sitemap', 'crawl-delay', 'host', 'noindex', 'clean-param', 'request-rate', 'visit-time']);

export function parseRobots(text) {
  const groups = []; const sitemaps = []; const problems = [];
  let current = null; let lastWasAgent = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const raw = line.replace(/#.*$/, '').trim();
    if (!raw) return;
    const m = raw.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) { problems.push({ line: i + 1, text: line.trim(), problem: 'Line is not in "field: value" form' }); return; }
    const field = m[1].toLowerCase(); const value = m[2].trim();
    if (!KNOWN.has(field)) problems.push({ line: i + 1, text: line.trim(), problem: `Unknown directive "${m[1]}"` });
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase()); lastWasAgent = true; return;
    }
    lastWasAgent = false;
    if (field === 'sitemap') { sitemaps.push(value); return; }
    if (!current) { if (field === 'allow' || field === 'disallow') problems.push({ line: i + 1, text: line.trim(), problem: 'Rule appears before any User-agent line' }); return; }
    if (field === 'allow' || field === 'disallow') current.rules.push({ type: field, path: value, line: i + 1 });
    if (field === 'crawl-delay') current.crawlDelay = Number(value);
    if (field === 'noindex') problems.push({ line: i + 1, text: line.trim(), problem: 'Noindex in robots.txt is not supported by Google' });
  });
  return { groups, sitemaps, problems };
}

function patternToRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function groupFor(parsed, agent) {
  const a = agent.toLowerCase();
  const specific = parsed.groups.filter(g => g.agents.some(x => x !== '*' && a.includes(x)));
  if (specific.length) return { rules: specific.flatMap(g => g.rules), matchedAgent: specific[0].agents.join(', ') };
  const star = parsed.groups.filter(g => g.agents.includes('*'));
  return { rules: star.flatMap(g => g.rules), matchedAgent: star.length ? '*' : null };
}

/** Google style matching: longest matching rule wins, allow wins ties. */
export function isAllowed(parsed, url, agent = 'googlebot') {
  if (!parsed) return { allowed: true };
  const u = new URL(url); const target = u.pathname + u.search;
  const { rules } = groupFor(parsed, agent);
  let best = null;
  for (const r of rules) {
    if (r.type === 'disallow' && r.path === '') continue;
    if (patternToRegex(r.path).test(target)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === 'allow')) best = r;
    }
  }
  return { allowed: !best || best.type === 'allow', rule: best };
}

function findConflicts(parsed) {
  const out = [];
  for (const g of parsed.groups) {
    const allows = g.rules.filter(r => r.type === 'allow'); const dis = g.rules.filter(r => r.type === 'disallow' && r.path);
    for (const a of allows) for (const d of dis) if (a.path === d.path) out.push({ agents: g.agents.join(', '), path: a.path, lines: [a.line, d.line] });
  }
  return out;
}

export async function loadRobots(origin) {
  const url = new URL('/robots.txt', origin).href;
  const res = await fetchUrl(url, { timeout: 10000, maxBytes: 500_000 });
  const exists = res.ok && res.status === 200 && !/<html/i.test(res.body.slice(0, 500));
  const result = { url, status: res.status, error: res.error, exists, redirected: res.chain.length > 0, contentType: res.contentType, raw: exists ? res.body.slice(0, 20000) : '', size: res.bytes };
  if (!exists) return { ...result, parsed: null, sitemaps: [], problems: [], conflicts: [], wildcardRules: 0, agents: [] };
  const parsed = parseRobots(res.body);
  const allRules = parsed.groups.flatMap(g => g.rules);
  return {
    ...result, parsed, sitemaps: parsed.sitemaps, problems: parsed.problems, conflicts: findConflicts(parsed),
    agents: [...new Set(parsed.groups.flatMap(g => g.agents))],
    wildcardRules: allRules.filter(r => r.path.includes('*') || r.path.endsWith('$')).length,
    crawlDelays: parsed.groups.filter(g => g.crawlDelay).map(g => ({ agents: g.agents.join(', '), delay: g.crawlDelay })),
    blocksEverything: groupFor(parsed, 'googlebot').rules.some(r => r.type === 'disallow' && r.path === '/'),
    ruleCount: allRules.length,
  };
}
