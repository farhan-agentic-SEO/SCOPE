import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit, STAGES } from './lib/pipeline.js';
import { store } from './lib/store.js';
import { normalizeInput } from './lib/url.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_AUDITS || 2);
const MAX_LIMIT = Number(process.env.MAX_CRAWL_LIMIT || 500);

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Minimal per IP rate limit for the free public tool
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip; const now = Date.now(); const windowMs = 3600_000; const max = Number(process.env.AUDITS_PER_HOUR || 20);
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs); arr.push(now); hits.set(ip, arr);
  if (arr.length > max) return res.status(429).json({ error: `Limit of ${max} audits per hour reached. Try again later.` });
  next();
}

app.post('/api/analyze', rateLimit, (req, res) => {
  let url;
  try { url = normalizeInput(req.body?.url); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (store.running() >= MAX_CONCURRENT) return res.status(503).json({ error: 'The analyzer is busy with other audits. Try again in a minute.' });
  const limit = Math.max(5, Math.min(MAX_LIMIT, Number(req.body?.limit) || Number(process.env.CRAWL_LIMIT || 100)));
  const id = crypto.randomUUID();
  store.create(id, url);
  store.update(id, { status: 'running' });
  runAudit(url, {
    limit,
    onStage: s => store.update(id, { stage: s.stage, progress: s.progress }),
    onLog: m => store.log(id, m),
  }).then(async report => {
    report.meta.id = id;
    store.update(id, { status: 'done', progress: 100, stage: 'Done', report });
    await store.save(id);
  }).catch(e => { console.error(e); store.update(id, { status: 'error', error: e.message }); });
  res.status(202).json({ id, stages: STAGES });
});

app.get('/api/analysis/:id', async (req, res) => {
  const job = await store.load(req.params.id);
  if (!job) return res.status(404).json({ error: 'Analysis not found. It may have been deleted or expired.' });
  const { report, ...status } = job;
  if (job.status !== 'done') return res.json(status);
  res.json({ ...status, report });
});

app.get('/api/analysis/:id/export.json', async (req, res) => {
  const job = await store.load(req.params.id);
  if (!job?.report) return res.status(404).json({ error: 'Report not ready' });
  res.setHeader('content-disposition', `attachment; filename="seo-report-${new URL(job.report.meta.homeUrl).hostname}.json"`);
  res.json(job.report);
});

app.get('/api/analysis/:id/issues.csv', async (req, res) => {
  const job = await store.load(req.params.id);
  if (!job?.report) return res.status(404).json({ error: 'Report not ready' });
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['priority', 'severity', 'category', 'issue', 'url', 'evidence', 'why', 'fix', 'impact', 'effort', 'basis']];
  job.report.issues.forEach(i => i.evidence.forEach(e => rows.push([i.severity === 'critical' ? 'Critical' : i.severity, i.severity, i.category, i.title, e.url, e.detail, i.why, i.fix, i.impact, i.effort, i.basis])));
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="seo-issues-${new URL(job.report.meta.homeUrl).hostname}.csv"`);
  res.send(rows.map(r => r.map(esc).join(',')).join('\n'));
});

app.get('/api/analysis/:id/llms.txt', async (req, res) => {
  const job = await store.load(req.params.id);
  if (!job?.report) return res.status(404).send('Report not ready');
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="llms.txt"');
  res.send(job.report.llms.suggested.content);
});

app.delete('/api/analysis/:id', async (req, res) => { await store.delete(req.params.id); res.json({ deleted: true }); });

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

await store.init();
app.listen(PORT, () => console.log(`SEO Scope running at http://localhost:${PORT}`));
