const TRACKING = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_cid|mc_eid|_ga|yclid|ref)$/i;
const SESSION = /^(sid|sessionid|session_id|phpsessid|jsessionid)$/i;
export const NON_HTML_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mp3|wav|ogg|zip|rar|7z|gz|tar|exe|dmg|docx?|xlsx?|pptx?|csv|txt|xml|json|css|js|woff2?|ttf|otf|eot)$/i;

export function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Enter a website URL.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('That does not look like a public website address.');
  u.hash = '';
  return u.href;
}

/** Canonical form used for deduplication inside the crawler. */
export function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    if (!u.pathname) u.pathname = '/';
    return u.href;
  } catch { return null; }
}

export const stripWww = h => h.replace(/^www\./, '');
export function sameSite(a, b) {
  try { return stripWww(new URL(a).hostname) === stripWww(new URL(b).hostname); } catch { return false; }
}

export function urlFlags(href) {
  const u = new URL(href);
  const params = [...u.searchParams.keys()];
  return {
    length: href.length,
    hasUppercase: /[A-Z]/.test(u.pathname),
    hasSpaces: /%20|\s/.test(u.pathname),
    hasSpecial: /[^a-zA-Z0-9\-._~/%]/.test(decodeURIComponent(u.pathname).replace(/[\u00C0-\uFFFF]/g, '')),
    hasUnderscore: u.pathname.includes('_'),
    paramCount: params.length,
    hasTracking: params.some(p => TRACKING.test(p)),
    hasSession: params.some(p => SESSION.test(p)) || /;jsessionid=/i.test(href),
    depth: u.pathname.split('/').filter(Boolean).length,
    dateBased: /\/(19|20)\d{2}\/\d{1,2}\//.test(u.pathname),
    numericSlug: /\/\d+\/?$/.test(u.pathname),
    trailingSlash: u.pathname.length > 1 && u.pathname.endsWith('/'),
    isFileLike: /\.[a-z0-9]{2,5}$/i.test(u.pathname),
  };
}

export const pathOf = href => { try { const u = new URL(href); return u.pathname + u.search; } catch { return href; } };
