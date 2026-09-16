import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.env.DATA_DIR || './data');
const TTL_HOURS = Number(process.env.REPORT_TTL_HOURS || 24);
const PERSIST = process.env.PERSIST_REPORTS !== 'false';
const jobs = new Map();

export const store = {
  async init() { if (PERSIST) await fs.mkdir(DIR, { recursive: true }); setInterval(() => this.cleanup(), 3600_000).unref(); await this.cleanup(); },
  create(id, input) { const job = { id, input, status: 'queued', stage: 'Queued', progress: 0, log: [], createdAt: Date.now(), report: null, error: null }; jobs.set(id, job); return job; },
  get(id) { return jobs.get(id); },
  update(id, patch) { const j = jobs.get(id); if (j) Object.assign(j, patch); return j; },
  log(id, msg) { const j = jobs.get(id); if (j) { j.log.push({ t: Date.now(), msg }); if (j.log.length > 60) j.log.shift(); } },
  async save(id) { const j = jobs.get(id); if (!PERSIST || !j?.report) return; await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(j.report)); },
  async load(id) {
    if (jobs.has(id)) return jobs.get(id);
    if (!PERSIST || !/^[a-z0-9-]+$/i.test(id)) return null;
    try { const report = JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), 'utf8')); const job = { id, status: 'done', progress: 100, stage: 'Done', report, log: [], createdAt: report.meta.startedAt }; jobs.set(id, job); return job; } catch { return null; }
  },
  async delete(id) { jobs.delete(id); if (PERSIST && /^[a-z0-9-]+$/i.test(id)) { try { await fs.unlink(path.join(DIR, `${id}.json`)); } catch {} } return true; },
  async cleanup() {
    const cutoff = Date.now() - TTL_HOURS * 3600_000;
    for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
    if (!PERSIST) return;
    try { for (const f of await fs.readdir(DIR)) { const st = await fs.stat(path.join(DIR, f)); if (st.mtimeMs < cutoff) await fs.unlink(path.join(DIR, f)); } } catch {}
  },
  running() { return [...jobs.values()].filter(j => j.status === 'running' || j.status === 'queued').length; },
};
