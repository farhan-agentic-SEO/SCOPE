# SEO Scope

Free, URL only SEO audit. Enter a website address and get a crawl based report covering technical SEO, indexability, on page SEO, content, internal links, schema, performance, local signals, AEO, AI search readiness and llms.txt. No login, no API keys.

Every number in the report carries a label: Measured, Calculated, Estimated or Unavailable.

## Run it

Requires Node.js 18.17 or newer.

    npm install
    npm run dev

Open http://localhost:3000. Copy `.env.example` to `.env` only if you want to change defaults (load it with `node --env-file=.env src/server.js`).

To see a full audit without touching a real site:

    npm run test:fixture

This starts a small local website with planted problems and prints the findings.

## How it works

1. `src/lib/http.js` fetches with manual redirect tracking, timing, size limits and private address blocking.
2. `src/lib/robots.js` and `src/lib/sitemap.js` read crawl rules and discover sitemaps.
3. `src/lib/crawler.js` runs a priority crawl (homepage, navigation, sitemap, deeper links) within the crawl limit.
4. `src/lib/extract.js` pulls every measurable fact from each page.
5. `src/lib/analyze/*` turn facts into issues with evidence, why it matters and a fix.
6. `src/lib/scoring.js` calculates SEO Health (weights: technical 15, crawlability 10, indexability 10, on page 15, content 15, internal links 10, schema 8, performance 7, mobile 3, trust 3, AEO/GEO 4). Traffic is excluded.
7. `src/lib/seo-estimator` produces traffic, keyword, ranking band and traffic value ranges. Every estimate returns value, min, max, confidence, methodology and signals.
8. `src/server.js` exposes the API and `public/` is the dashboard.

## API

    POST   /api/analyze                 { "url": "https://example.com", "limit": 100 }
    GET    /api/analysis/:id            status, then the full report
    GET    /api/analysis/:id/issues.csv
    GET    /api/analysis/:id/export.json
    GET    /api/analysis/:id/llms.txt   suggested llms.txt
    DELETE /api/analysis/:id

## Known limits

JavaScript is not executed; client rendered pages are flagged from raw HTML signals. Lighthouse data covers the homepage and depends on the free PageSpeed Insights quota. Estimates have no Search Console, ranking or backlink data behind them and are labeled low confidence. Competitors are marked unavailable rather than guessed.

## Roadmap

Playwright rendering for JavaScript sites, optional local AI model for topic labels, Search Console and GA4 connectors to replace estimates with real data, and a database queue for hosted use.
