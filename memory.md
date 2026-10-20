# WebStreamrMBG Memory

## [2026-10-20] — HDHub4u search and rotating-domain fix

- **Problem**: HDHub4u stopped returning streams. The old search host
  (`search.hdhub4u.glass`) was dead, and search results carried absolute
  permalinks on dead `*.hdhub4u.free` hosts even when the site itself was
  reachable. The shared Anshu provider list also pointed at a dead domain.
- **Search**: switched to the site's `search.pingora.fyi` Typesense endpoint with
  its full parameter set (`query_by`, weights, date sort, limit 15). Results are
  still filtered by exact `imdb_id` and season.
- **Permalinks**: absolute result URLs are reduced to path + query and
  re-anchored to the probed base URL (`toBaseUrl`).
- **Domains**: base is now `new8.hdhub4u.cl`. Added phisher98/TVVVV
  `domains.json` (`HDHUB4u`) as a cached (4 h) secondary source, tried before
  the static fallback list. CDN discovery now uses a 5 s timeout.
- **Fixtures/tests**: live-refreshed search/page/HEAD fixtures and snapshots;
  added tests for permalink re-anchoring, phisher98 caching/fallbacks, non-string
  and unreachable payloads. `FetcherMock` live-fixture refresh now uses
  `Fetcher.fetch` so Cloudflare-protected hosts can use the got-scraping
  fallback.
- **Verification**: `npm test` 585 passed with 100% coverage,
  `npm run analyse` and `npm run lint` clean.
