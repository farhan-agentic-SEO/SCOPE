// HTTP layer: manual redirect tracking, timing, body limits, SSRF protection.
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export const USER_AGENT = 'Mozilla/5.0 (compatible; SEOScopeBot/1.0; free URL audit)';
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_HOSTS === 'true';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

const dnsCache = new Map();
export async function assertPublicHost(hostname) {
  if (ALLOW_PRIVATE) return;
  if (dnsCache.has(hostname)) { const r = dnsCache.get(hostname); if (r !== true) throw r; return; }
  try {
    const addrs = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
    if (addrs.some(a => isPrivateIp(a.address))) {
      const e = new Error(`Blocked private or local address for ${hostname}`); e.code = 'PRIVATE_HOST';
      dnsCache.set(hostname, e); throw e;
    }
    dnsCache.set(hostname, true);
  } catch (e) {
    if (e.code === 'PRIVATE_HOST') throw e;
    const err = new Error(`DNS lookup failed for ${hostname}`); err.code = 'DNS_FAILURE'; throw err;
  }
}

const TEXT_TYPES = /(text\/|html|xml|json|javascript|markdown)/i;

/**
 * Fetch a URL, following redirects manually so the full chain is recorded.
 * Never throws: failures come back as { ok:false, error, errorCode }.
 */
export async function fetchUrl(url, opts = {}) {
  const { method = 'GET', timeout = 15000, maxBytes = 3_000_000, followRedirects = true, maxRedirects = 10, readBody = true } = opts;
  const chain = [];
  const seen = new Set();
  let current = url;
  const started = performance.now();
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const u = new URL(current);
      if (!/^https?:$/.test(u.protocol)) return fail('Unsupported protocol', 'PROTOCOL');
      await assertPublicHost(u.hostname);
      if (seen.has(current)) return { ...fail('Redirect loop detected', 'REDIRECT_LOOP'), chain };
      seen.add(current);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const hopStart = performance.now();
      let res;
      try {
        res = await fetch(current, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5' } });
      } finally { clearTimeout(timer); }
      const ttfb = Math.round(performance.now() - hopStart);
      const headers = Object.fromEntries(res.headers.entries());
      const loc = headers.location;
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, current).href;
        chain.push({ url: current, status: res.status, location: next });
        try { await res.body?.cancel(); } catch {}
        if (!followRedirects) return { ok: true, url, finalUrl: current, status: res.status, headers, chain, ttfb, time: Math.round(performance.now() - started), body: '', bytes: 0, contentType: headers['content-type'] || '' };
        current = next;
        continue;
      }
      const contentType = headers['content-type'] || '';
      let body = ''; let bytes = 0; let truncated = false;
      if (readBody && method !== 'HEAD' && res.body) {
        if (TEXT_TYPES.test(contentType) || !contentType) {
          const reader = res.body.getReader(); const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > maxBytes) { truncated = true; try { await reader.cancel(); } catch {} break; }
            chunks.push(value);
          }
          body = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
        } else {
          bytes = Number(headers['content-length'] || 0);
          try { await res.body.cancel(); } catch {}
        }
      } else {
        bytes = Number(headers['content-length'] || 0);
        try { await res.body?.cancel(); } catch {}
      }
      return { ok: true, url, finalUrl: current, status: res.status, headers, chain, ttfb, time: Math.round(performance.now() - started), body, bytes, truncated, contentType };
    }
    return { ...fail('Too many redirects', 'TOO_MANY_REDIRECTS'), chain };
  } catch (e) {
    const code = e.code || e.cause?.code || (e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
    const map = { ENOTFOUND: 'DNS_FAILURE', EAI_AGAIN: 'DNS_FAILURE', ECONNREFUSED: 'CONNECTION_REFUSED', ECONNRESET: 'CONNECTION_RESET', UND_ERR_CONNECT_TIMEOUT: 'TIMEOUT' };
    const errorCode = map[code] || code;
    return { ...fail(e.name === 'AbortError' ? 'Request timed out' : (e.cause?.message || e.message), errorCode), chain };
  }
  function fail(error, errorCode) {
    return { ok: false, url, finalUrl: current, status: 0, headers: {}, chain, ttfb: 0, time: Math.round(performance.now() - started), body: '', bytes: 0, contentType: '', error, errorCode };
  }
}

/** Lightweight status check for link validation (HEAD, falling back to GET). */
export async function checkUrl(url, timeout = 8000) {
  let r = await fetchUrl(url, { method: 'HEAD', timeout, readBody: false });
  if (!r.ok || r.status === 405 || r.status === 403 || r.status === 501) {
    const g = await fetchUrl(url, { method: 'GET', timeout, maxBytes: 200_000 });
    if (g.ok || !r.ok) r = g;
  }
  return { url, status: r.status, finalUrl: r.finalUrl, chain: r.chain, error: r.error, errorCode: r.errorCode, bytes: r.bytes || Number(r.headers?.['content-length'] || 0), contentType: r.contentType };
}

/** Read the TLS certificate for a host (expiry, issuer). */
export async function getCertificate(hostname, port = 443) {
  try { await assertPublicHost(hostname); } catch (e) { return { error: e.message }; }
  return new Promise(resolve => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      socket.end();
      if (!cert || !cert.valid_to) return resolve({ error: 'No certificate returned' });
      const validTo = new Date(cert.valid_to);
      resolve({ issuer: cert.issuer?.O || cert.issuer?.CN, subject: cert.subject?.CN, validFrom: cert.valid_from, validTo: cert.valid_to, daysRemaining: Math.floor((validTo - Date.now()) / 86400000), authorized, authorizationError: socket.authorizationError ? String(socket.authorizationError) : null });
    });
    socket.on('error', e => resolve({ error: e.message }));
    socket.on('timeout', () => { socket.destroy(); resolve({ error: 'TLS timeout' }); });
  });
}

/** Run async tasks with a concurrency cap. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}
