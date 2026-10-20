import axios from 'axios';
import winston from 'winston';
import { createTestContext } from '../test';
import { CountryCode } from '../types';
import { Fetcher, FetcherMock, ImdbId } from '../utils';
import { resolveRedirectUrl } from './hd-hub-helper';
import { HDHub4u, resetCdnCache } from './HDHub4u';
import { Source, SourceResult } from './Source';

jest.mock('./hd-hub-helper', () => ({
  resolveRedirectUrl: jest.fn(),
}));

const ctx = createTestContext();
const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

describe('HDHub4u', () => {
  let source: HDHub4u;

  beforeEach(() => {
    Source.resetCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    SourceClass.evictionCallbacks = new Map();
    SourceClass.evictionCallbacks.set('hdhub', resetCdnCache);
    resetCdnCache();

    source = new HDHub4u(new FetcherMock(`${__dirname}/__fixtures__/HDHub4u`));
  });

  test('handle superman 2025', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt5950044', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handle the bone temple 2026', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt32141377', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handle stranger things s05e05', async () => {
    const streams = await source.handle(ctx, 'series', new ImdbId('tt4574334', 5, 5));
    expect(streams).toMatchSnapshot();
  });

  test('handle stranger things s05e07', async () => {
    const streams = await source.handle(ctx, 'series', new ImdbId('tt4574334', 5, 7));
    expect(streams).toMatchSnapshot();
  });
});

describe('HDHub4u internal methods', () => {
  let source: HDHub4u;
  let fetcher: Fetcher;

  beforeEach(() => {
    Source.resetCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    SourceClass.evictionCallbacks = new Map();
    SourceClass.evictionCallbacks.set('hdhub', resetCdnCache);

    resetCdnCache();

    fetcher = new Fetcher(axios.create(), logger);
    source = new HDHub4u(fetcher);
  });

  test('extractHubDriveUrlResults finds hub drive links', () => {
    const html = `<html><body>
      <a href="https://hubdrive.dad/file/123">HubDrive Link</a>
      <a href="https://hubcloud.foo/drive/abc">HubCloud Link</a>
      <a href="https://example.com/other">Other</a>
      <a>No href attribute</a>
    </body></html>`;
    const results = source['extractHubDriveUrlResults'](html, { countryCodes: [CountryCode.multi] });
    expect(results).toHaveLength(2);
    expect(results.some(r => r.url.href.includes('hubdrive'))).toBe(true);
    expect(results.some(r => r.url.href.includes('hubcloud'))).toBe(true);
  });

  test('extractHubDriveUrlResults excludes dead domains', () => {
    const html = `<html><body>
      <a href="https://hubcloud.ink/drive/abc">Dead Domain</a>
      <a href="https://hubcloud.foo/drive/xyz">Live Domain</a>
    </body></html>`;
    const results = source['extractHubDriveUrlResults'](html, { countryCodes: [CountryCode.multi] });
    expect(results).toHaveLength(1);
    expect(results.some(r => r.url.href.includes('hubcloud.foo'))).toBe(true);
  });

  test('extractHubDriveUrlResults excludes patterns and lightning bolt links', () => {
    const html = `<html><body>
      <a href="https://hubdrive.dad/file/123">⚡ Fast</a>
      <a href="https://gadgetsweb.xyz/id=abc">GadgetsWeb</a>
      <a href="https://hubdrive.dad/file/456">Normal Link</a>
    </body></html>`;
    const results = source['extractHubDriveUrlResults'](html, { countryCodes: [CountryCode.multi] });
    expect(results).toHaveLength(1);
    expect(results.some(r => r.url.href.includes('456'))).toBe(true);
  });

  test('extractHubDriveUrlResults skips invalid URLs', () => {
    const html = `<html><body>
      <a href="https://hubdrive.dad/file/123">Valid</a>
      <a href="https://hubdrive.dad:invalid/file">Invalid Port</a>
    </body></html>`;
    const results = source['extractHubDriveUrlResults'](html, { countryCodes: [CountryCode.multi] });
    expect(results).toHaveLength(1);
    expect(results.some(r => r.url.href.includes('hubdrive.dad/file/123'))).toBe(true);
  });

  test('handlePage for movie extracts hub links', async () => {
    const pageUrl = new URL('https://new6.hdhub4u.fo/superman-2025');
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <div>Language: Hindi</div>
      <a href="https://hubdrive.dad/file/123">HubDrive</a>
      <a href="https://hubcloud.foo/drive/abc">HubCloud</a>
      <a href="https://gadgetsweb.xyz/?id=testid">GadgetWeb Link</a>
    </body></html>`);

    (resolveRedirectUrl as jest.Mock).mockResolvedValue(new URL('https://hubdrive.dad/file/999'));

    const results = await source['handlePage'](ctx, pageUrl, imdbId);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test('handlePage for series extracts episode links', async () => {
    const pageUrl = new URL('https://new6.hdhub4u.fo/stranger-things');
    const imdbId = new ImdbId('tt4574334', 5, 1);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <div>Language: English</div>
      <h4>EPiSODE 1 - Chapter One</h4>
      <a href="https://hubdrive.dad/file/999">HubDrive Ep1</a>
      <hr>
    </body></html>`);

    const results = await source['handlePage'](ctx, pageUrl, imdbId);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('handlePage for series matches h3 EP-XX heading format', async () => {
    const pageUrl = new URL('https://new6.hdhub4u.fo/stranger-things');
    const imdbId = new ImdbId('tt4574334', 5, 8);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <div>Language: Hindi</div>
      <h3><a href="https://gadgetsweb.xyz/?id=ep8link"><span><strong>EP-08 [FINAL EP]</strong></span></a></h3>
      <hr>
    </body></html>`);

    (resolveRedirectUrl as jest.Mock).mockResolvedValue(new URL('https://hubdrive.dad/file/ep8'));

    const results = await source['handlePage'](ctx, pageUrl, imdbId);
    const hubUrls = results.map(r => r.url.href);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/ep8'))).toBe(true);
  });

  test('handlePage excludes EP-XX headings from pack gadgetsweb links', async () => {
    const pageUrl = new URL('https://new6.hdhub4u.fo/stranger-things');
    const imdbId = new ImdbId('tt4574334', 5, 5);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <div>Language: Hindi</div>
      <h3><a href="https://gadgetsweb.xyz/?id=ep5link">EP-05</a></h3>
      <h4><a href="https://gadgetsweb.xyz/?id=packlink">720p Pack</a></h4>
      <hr>
    </body></html>`);

    (resolveRedirectUrl as jest.Mock).mockImplementation(async (_ctx: unknown, _fetcher: unknown, url: URL) => {
      if (url.href.includes('ep5link')) return new URL('https://hubdrive.dad/file/ep5');
      if (url.href.includes('packlink')) return new URL('https://hubdrive.dad/file/pack');
      return new URL('https://hubdrive.dad/file/unknown');
    });

    const results = await source['handlePage'](ctx, pageUrl, imdbId);
    const hubUrls = results.map(r => r.url.href);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/ep5'))).toBe(true);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/pack'))).toBe(true);
  });

  test('handlePage for series finds gadgetsweb pack links and episode hub links', async () => {
    const pageUrl = new URL('https://new6.hdhub4u.fo/stranger-things');
    const imdbId = new ImdbId('tt4574334', 5, 5);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <div>Language: Hindi</div>
      <h3><a href="https://gadgetsweb.xyz/?id=pack480p">480p Pack</a></h3>
      <h4><a href="https://gadgetsweb.xyz/?id=pack1080p">1080p Pack</a></h4>
      <hr>
      <h2>Single Episode Links</h2>
      <hr>
      <h4>EPiSODE 5</h4>
      <a href="https://hubdrive.dad/file/ep5-720">720p Drive</a>
      <a href="https://hubcdn.fans/file/ep5-instant">720p Instant</a>
      <hr>
    </body></html>`);

    (resolveRedirectUrl as jest.Mock).mockImplementation(async (_ctx: unknown, _fetcher: unknown, url: URL) => {
      if (url.href.includes('pack480p')) return new URL('https://hubdrive.dad/file/pack480');
      if (url.href.includes('pack1080p')) return new URL('https://hubdrive.dad/file/pack1080');
      return new URL('https://hubdrive.dad/file/unknown');
    });

    const results = await source['handlePage'](ctx, pageUrl, imdbId);
    const hubUrls = results.map(r => r.url.href);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/ep5-720'))).toBe(true);
    expect(hubUrls.some(u => u.includes('hubcdn.fans'))).toBe(true);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/pack480'))).toBe(true);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/pack1080'))).toBe(true);
  });

  test('handlePage for series scopes gadgetsweb links to requested episode', async () => {
    const pageUrl = new URL('https://new6.hdhub4u.fo/stranger-things');
    const imdbId = new ImdbId('tt4574334', 5, 5);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <div>Language: Hindi</div>
      <h4><a href="https://gadgetsweb.xyz/?id=pack">Pack</a></h4>
      <hr>
      <h4>EPiSODE 5</h4>
      <a href="https://gadgetsweb.xyz/?id=ep5">EP5 Gadget</a>
      <hr>
      <h4>EPiSODE 6</h4>
      <a href="https://gadgetsweb.xyz/?id=ep6">EP6 Gadget</a>
      <hr>
    </body></html>`);

    (resolveRedirectUrl as jest.Mock).mockImplementation(async (_ctx: unknown, _fetcher: unknown, url: URL) => {
      if (url.href.includes('pack')) return new URL('https://hubdrive.dad/file/pack');
      if (url.href.includes('ep5')) return new URL('https://hubdrive.dad/file/ep5');
      if (url.href.includes('ep6')) return new URL('https://hubdrive.dad/file/ep6');
      return new URL('https://hubdrive.dad/file/unknown');
    });

    const results = await source['handlePage'](ctx, pageUrl, imdbId);
    const hubUrls = results.map(r => r.url.href);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/pack'))).toBe(true);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/ep5'))).toBe(true);
    expect(hubUrls.some(u => u.includes('hubdrive.dad/file/ep6'))).toBe(false);
  });

  test('handleHubLinks returns hub URL when redirect resolves to hub host', async () => {
    const redirectUrl = new URL('https://gadgetsweb.xyz/id=abc');
    const refererUrl = new URL('https://new6.hdhub4u.fo/superman');
    const meta = { countryCodes: [CountryCode.multi] };

    (resolveRedirectUrl as jest.Mock).mockResolvedValue(new URL('https://hubdrive.dad/file/123'));

    const results = await source['handleHubLinks'](ctx, redirectUrl, refererUrl, meta);
    expect(results).toHaveLength(1);
    expect(results.some(r => r.url.href.includes('hubdrive.dad'))).toBe(true);
    expect(results.every(r => r.meta.referer === refererUrl.href)).toBe(true);
  });

  test('handleHubLinks fetches page when redirect resolves to non-hub host', async () => {
    const redirectUrl = new URL('https://gadgetsweb.xyz/id=abc');
    const refererUrl = new URL('https://new6.hdhub4u.fo/superman');
    const meta = { countryCodes: [CountryCode.multi] };

    (resolveRedirectUrl as jest.Mock).mockResolvedValue(new URL('https://hblinks.dad/archives/123'));

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <a href="https://hubdrive.dad/file/456">HubDrive</a>
    </body></html>`);

    const results = await source['handleHubLinks'](ctx, redirectUrl, refererUrl, meta);
    expect(results).toHaveLength(1);
    expect(results.some(r => r.url.href.includes('hubdrive.dad'))).toBe(true);
    expect(results.every(r => r.meta.referer?.includes('hblinks.dad'))).toBe(true);
  });

  test('handleHubLinks returns empty for dead hub host', async () => {
    const redirectUrl = new URL('https://gadgetsweb.xyz/id=abc');
    const refererUrl = new URL('https://new6.hdhub4u.fo/superman');
    const meta = { countryCodes: [CountryCode.multi] };

    (resolveRedirectUrl as jest.Mock).mockResolvedValue(new URL('https://hubcloud.ink/drive/abc'));

    const results = await source['handleHubLinks'](ctx, redirectUrl, refererUrl, meta);
    expect(results).toEqual([]);
  });

  test('handleHubLinks returns empty when resolveRedirectUrl throws', async () => {
    const redirectUrl = new URL('https://gadgetsweb.xyz/id=abc');
    const refererUrl = new URL('https://new6.hdhub4u.fo/superman');
    const meta = { countryCodes: [CountryCode.multi] };

    (resolveRedirectUrl as jest.Mock).mockRejectedValue(new Error('Network error'));

    const results = await source['handleHubLinks'](ctx, redirectUrl, refererUrl, meta);
    expect(results).toEqual([]);
  });

  test('handleHubLinks returns empty when resolveRedirectUrl returns undefined', async () => {
    const redirectUrl = new URL('https://gadgetsweb.xyz/id=abc');
    const refererUrl = new URL('https://new6.hdhub4u.fo/superman');
    const meta = { countryCodes: [CountryCode.multi] };

    (resolveRedirectUrl as jest.Mock).mockResolvedValue(undefined);

    const results = await source['handleHubLinks'](ctx, redirectUrl, refererUrl, meta);
    expect(results).toEqual([]);
  });

  test('fetchPageUrlsFromSearch returns matching results', async () => {
    const baseUrl = new URL('https://new6.hdhub4u.fo/');
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    jest.spyOn(fetcher, 'json').mockResolvedValue({
      hits: [
        { document: { imdb_id: 'tt5950044', permalink: '/superman-2025', post_title: 'Superman 2025' } },
        { document: { imdb_id: 'tt9999999', permalink: '/other', post_title: 'Other' } },
      ],
    });

    const results = await source['fetchPageUrlsFromSearch'](ctx, imdbId, baseUrl);
    expect(results).toHaveLength(1);
    expect(results.some(r => r.href.includes('superman-2025'))).toBe(true);
  });

  test('fetchPageUrlsFromSearch filters by season', async () => {
    const baseUrl = new URL('https://new6.hdhub4u.fo/');
    const imdbId = new ImdbId('tt4574334', 5, 1);

    jest.spyOn(fetcher, 'json').mockResolvedValue({
      hits: [
        { document: { imdb_id: 'tt4574334', permalink: '/stranger-things-s05', post_title: 'Stranger Things Season 5' } },
        { document: { imdb_id: 'tt4574334', permalink: '/stranger-things-s01', post_title: 'Stranger Things Season 1' } },
      ],
    });

    const results = await source['fetchPageUrlsFromSearch'](ctx, imdbId, baseUrl);
    expect(results).toHaveLength(1);
    expect(results.some(r => r.href.includes('s05'))).toBe(true);
  });

  test('fetchPageUrlsFromSearch re-anchors absolute dead-host permalinks to the base URL', async () => {
    const baseUrl = new URL('https://new8.hdhub4u.cl/');
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    jest.spyOn(fetcher, 'json').mockResolvedValue({
      hits: [
        { document: { imdb_id: 'tt5950044', permalink: 'https://new2.hdhub4u.free/superman-2025?x=1', post_title: 'Superman 2025' } },
      ],
    });

    const results = await source['fetchPageUrlsFromSearch'](ctx, imdbId, baseUrl);
    expect(results).toHaveLength(1);
    expect(results[0]?.href).toBe('https://new8.hdhub4u.cl/superman-2025?x=1');
  });

  test('discoverFromDomainsJson caches the resolved domain', async () => {
    const json = jest.spyOn(fetcher, 'json').mockResolvedValue({ HDHUB4u: 'https://new8.hdhub4u.cl' });

    const first = await source['discoverFromDomainsJson'](ctx);
    const second = await source['discoverFromDomainsJson'](ctx);

    expect(first).toBe('https://new8.hdhub4u.cl');
    expect(second).toBe(first);
    expect(json).toHaveBeenCalledTimes(1);
  });

  test('discoverFromDomainsJson ignores non-string entries', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ HDHUB4u: { url: 'https://new8.hdhub4u.cl' } });

    expect(await source['discoverFromDomainsJson'](ctx)).toBeNull();
  });

  test('discoverFromDomainsJson returns null when the list is unreachable', async () => {
    jest.spyOn(fetcher, 'json').mockRejectedValue(new Error('network error'));

    expect(await source['discoverFromDomainsJson'](ctx)).toBeNull();
  });

  test('getBaseUrl prefers the phisher98 domain', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.href.includes('phisher98')) return { HDHUB4u: 'https://fresh.example' };
      return {};
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source['getBaseUrl'](ctx);

    expect(result.origin).toBe('https://fresh.example');
  });

  test('getBaseUrl falls back to static candidates when the phisher98 domain is dead', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.href.includes('phisher98')) return { HDHUB4u: 'https://dead.example' };
      return {};
    });
    jest.spyOn(fetcher, 'head').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'dead.example') throw new Error('unreachable');
      return {};
    });

    const result = await source['getBaseUrl'](ctx);

    expect(result.origin).not.toBe('https://dead.example');
  });

  test('fetchPageUrlsFromSiteSearch finds matching links', async () => {
    const baseUrl = new URL('https://new6.hdhub4u.fo/');
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    jest.spyOn(fetcher, 'text').mockResolvedValue(`<html><body>
      <a href="https://new6.hdhub4u.fo/superman-2025">Superman 2025 tt5950044</a>
      <a href="https://other.site/irrelevant">Other</a>
      <a href="https://new6.hdhub4u.fo/unrelated">Unrelated</a>
    </body></html>`);

    const results = await source['fetchPageUrlsFromSiteSearch'](ctx, imdbId, baseUrl);
    expect(results).toHaveLength(1);
    expect(results.some(r => r.href.includes('superman-2025'))).toBe(true);
  });

  test('getBaseUrl uses CDN discovery', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://new6.hdhub4u.fo'),
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source['getBaseUrl'](ctx);
    expect(result.href).toContain('hdhub4u');
  });

  test('getBaseUrl uses cached CDN URL on second call', async () => {
    const jsonSpy = jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://new6.hdhub4u.fo'),
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    await source['getBaseUrl'](ctx);
    jsonSpy.mockClear();

    const result = await source['getBaseUrl'](ctx);
    expect(result.href).toContain('hdhub4u');
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  test('getBaseUrl handles invalid CDN URL', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('not-a-valid-url'),
    });
    jest.spyOn(fetcher, 'text').mockResolvedValue('<html></html>');
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source['getBaseUrl'](ctx);
    expect(result).toBeDefined();
  });

  test('getBaseUrl skips CDN URL with dead domain', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Source as any).deadDomains.set('dead.hdhub4u.limo', Date.now());

    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://dead.hdhub4u.limo'),
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source['getBaseUrl'](ctx);
    expect(result).toBeDefined();
    expect(result.hostname).not.toBe('dead.hdhub4u.limo');
  });

  test('CDN cache is reset when recordFailure evicts baseUrlCache', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://dead.hdhub4u.fo'),
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    await source['getBaseUrl'](ctx);

    expect(SourceClass.evictionCallbacks.get('hdhub')).toBe(resetCdnCache);

    SourceClass.firstFailureAt.set('hdhub', Date.now() - 5 * 60 * 1000);
    Source.recordFailure('hdhub');

    expect(SourceClass.baseUrlCache.has('hdhub')).toBe(false);
  });

  test('resetCdnCache returns evicted hostname and recordFailure marks it dead', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://dead.hdhub4u.fo'),
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    await source['getBaseUrl'](ctx);

    SourceClass.firstFailureAt.set('hdhub', Date.now() - 5 * 60 * 1000);
    Source.recordFailure('hdhub');

    expect(SourceClass.deadDomains.has('dead.hdhub4u.fo')).toBe(true);
  });

  test('resetCdnCache returns undefined when CDN cache is empty', () => {
    expect(resetCdnCache()).toBeUndefined();
  });

  test('resetCdnCache returns undefined for invalid CDN URL', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('not-a-valid-url'),
    });
    jest.spyOn(fetcher, 'text').mockResolvedValue('<html></html>');
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    try {
      await source['getBaseUrl'](ctx);
    } catch { /* may throw */ }

    const result = resetCdnCache();
    expect(result).toBeUndefined();
  });

  test('getBaseUrl resets CDN cache and falls back when failing domain is dead', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    SourceClass.firstFailureAt.set('hdhub', Date.now());

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'cdn.hdhub4u.glass') return { c: btoa('https://dead.hdhub4u.fo') };
      return { hdhub: { name: 'HDHub4u', url: 'https://fallback.hdhub4u.fo' } };
    });
    jest.spyOn(fetcher, 'head').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'dead.hdhub4u.fo') throw new Error('ECONNREFUSED');
      return {};
    });

    const result = await source['getBaseUrl'](ctx);
    expect(result.hostname).not.toBe('dead.hdhub4u.fo');
    expect(SourceClass.deadDomains.has('dead.hdhub4u.fo')).toBe(true);
  });

  test('getBaseUrl records success when isFailing and CDN domain is alive', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    SourceClass.firstFailureAt.set('hdhub', Date.now());

    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://alive.hdhub4u.fo'),
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source['getBaseUrl'](ctx);
    expect(result.hostname).toBe('alive.hdhub4u.fo');
    expect(SourceClass.firstFailureAt.has('hdhub')).toBe(false);
  });

  test('getBaseUrl verifies CDN URL liveness periodically', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'cdn.hdhub4u.glass') return { c: btoa('https://dead.hdhub4u.fo') };
      return { hdhub: { name: 'HDHub4u', url: 'https://fallback.hdhub4u.fo' } };
    });
    const headSpy = jest.spyOn(fetcher, 'head').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'dead.hdhub4u.fo') throw new Error('ECONNREFUSED');
      return {};
    });

    // First call: CDN URL verified alive (isFailing=false, needsVerify=true initially)
    const result = await source['getBaseUrl'](ctx);
    expect(result.hostname).not.toBe('dead.hdhub4u.fo');
    expect(SourceClass.deadDomains.has('dead.hdhub4u.fo')).toBe(true);
    expect(headSpy).toHaveBeenCalled();
  });

  test('getBaseUrl skips HEAD check when CDN URL recently verified', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      c: btoa('https://alive.hdhub4u.fo'),
    });
    const headSpy = jest.spyOn(fetcher, 'head').mockResolvedValue({});

    // First call: verifies CDN URL via HEAD
    const result1 = await source['getBaseUrl'](ctx);
    expect(result1.hostname).toBe('alive.hdhub4u.fo');
    const headCallCount = headSpy.mock.calls.length;

    // Second call: CDN URL recently verified, no HEAD needed
    const result2 = await source['getBaseUrl'](ctx);
    expect(result2.hostname).toBe('alive.hdhub4u.fo');
    expect(headSpy.mock.calls.length).toBe(headCallCount);
  });

  test('getBaseUrl falls back when isFailing and CDN URL is invalid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    SourceClass.firstFailureAt.set('hdhub', Date.now());

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'cdn.hdhub4u.glass') return { c: btoa('not-a-url') };
      return { hdhub: { name: 'HDHub4u', url: 'https://fallback.hdhub4u.fo' } };
    });
    jest.spyOn(fetcher, 'head').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'fallback.hdhub4u.fo') return {};
      throw new Error('ECONNREFUSED');
    });

    const result = await source['getBaseUrl'](ctx);
    expect(result.hostname).toBe('fallback.hdhub4u.fo');
    expect(SourceClass.deadDomains.has('not-a-url')).toBe(false);
  });

  test('fetchPageUrls returns search results without site search', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'getBaseUrl').mockResolvedValue(new URL('https://new6.hdhub4u.fo/'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrlsFromSearch').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrlsFromSiteSearch');

    const results = await source['fetchPageUrls'](ctx, imdbId);
    expect(results).toHaveLength(1);
    expect(source['fetchPageUrlsFromSiteSearch']).not.toHaveBeenCalled();
  });

  test('handleInternal processes page URLs and returns results', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubdrive.dad/file/123'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(1);
  });

  test('handleInternal deduplicates exact same HubCloud URL from direct and redirect paths', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubcloud.one/drive/abc'), meta: { countryCodes: [CountryCode.multi] } },
      { url: new URL('https://hubcloud.one/drive/abc'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(1);
  });

  test('handleInternal deduplicates HubCloud URLs with same path but different tokens', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubcloud.one/drive/abc?token=xyz'), meta: { countryCodes: [CountryCode.multi] } },
      { url: new URL('https://hubcloud.one/drive/abc?token=def'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(1);
  });

  test('handleInternal keeps HubCloud search-recover URLs with different from_ac as separate results', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubcloud.foo/drive/search-recover.php?from_ac=abc123&q=720p'), meta: { countryCodes: [CountryCode.multi] } },
      { url: new URL('https://hubcloud.foo/drive/search-recover.php?from_ac=def456&q=1080p'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(2);
  });

  test('handleInternal deduplicates HubCloud search-recover URLs with same from_ac', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubcloud.foo/drive/search-recover.php?from_ac=abc123&q=720p'), meta: { countryCodes: [CountryCode.multi] } },
      { url: new URL('https://hubcloud.foo/drive/search-recover.php?from_ac=abc123&q=720p'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(1);
  });

  test('handleInternal keeps different HubCloud paths as separate results', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubcloud.one/drive/abc'), meta: { countryCodes: [CountryCode.multi] } },
      { url: new URL('https://hubcloud.one/drive/xyz'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(2);
  });

  test('handleInternal keeps HubCDN URLs with different link params as separate results', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockResolvedValue([
      { url: new URL('https://hubcdn.fans/dl/?link=hash1'), meta: { countryCodes: [CountryCode.multi] } },
      { url: new URL('https://hubcdn.fans/dl/?link=hash2'), meta: { countryCodes: [CountryCode.multi] } },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(2);
  });

  test('handleInternal deduplicates across multiple page URLs', async () => {
    const imdbId = new ImdbId('tt5950044', undefined, undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'fetchPageUrls').mockResolvedValue([
      new URL('https://new6.hdhub4u.fo/superman-2025'),
      new URL('https://new6.hdhub4u.fo/superman-2025-4k'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(source as any, 'handlePage').mockImplementation(async (): Promise<SourceResult[]> => {
      // Both pages return the same hubcloud URL
      return [{ url: new URL('https://hubcloud.one/drive/shared123'), meta: { countryCodes: [CountryCode.multi] } }];
    });

    const results = await source['handleInternal'](ctx, 'movie', imdbId);
    expect(results).toHaveLength(1);
  });
});

describe('HDHub4u search fallback', () => {
  beforeEach(() => {
    Source.resetCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SourceClass = Source as any;
    SourceClass.evictionCallbacks = new Map();
    SourceClass.evictionCallbacks.set('hdhub', resetCdnCache);
    resetCdnCache();
  });

  test('falls back to site search when pingora returns no hits', async () => {
    const fetcher = new Fetcher(axios.create(), logger);
    const source = new HDHub4u(fetcher);

    const imdbId = new ImdbId('tt1234567', undefined, undefined);

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('pingora')) return { hits: [] };
      if (url.href.includes('themoviedb')) return { movie_results: [{ id: 123, title: 'Test', release_date: '2024-01-01' }] };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('s=tt1234567')) {
        return `<html><body>
          <a href="https://new1.hdhub4u.fo/movie-test-tt1234567">Movie Test tt1234567</a>
          <a href="https://other.site/irrelevant">Other</a>
        </body></html>`;
      }
      return '<html><body></body></html>';
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source.handle(ctx, 'movie', imdbId);
    expect(result).toEqual([]);
  });

  test('falls back to site search when pingora throws', async () => {
    const fetcher = new Fetcher(axios.create(), logger);
    const source = new HDHub4u(fetcher);

    const imdbId = new ImdbId('tt9999999', undefined, undefined);

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('pingora')) throw new Error('network error');
      if (url.href.includes('themoviedb')) return { movie_results: [{ id: 999, title: 'Test', release_date: '2024-01-01' }] };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('s=tt9999999')) {
        return `<html><body>
          <a href="https://new1.hdhub4u.fo/movie-tt9999999">Test Movie tt9999999</a>
        </body></html>`;
      }
      return '<html><body></body></html>';
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source.handle(ctx, 'movie', imdbId);
    expect(result).toEqual([]);
  });

  test('returns empty when both pingora and site search fail', async () => {
    const fetcher = new Fetcher(axios.create(), logger);
    const source = new HDHub4u(fetcher);

    const imdbId = new ImdbId('tt0000000', undefined, undefined);

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('pingora')) throw new Error('network error');
      if (url.href.includes('themoviedb')) return { movie_results: [{ id: 0, title: 'Test', release_date: '2024-01-01' }] };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockRejectedValue(new Error('network error'));
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source.handle(ctx, 'movie', imdbId);
    expect(result).toEqual([]);
  });

  test('site search finds matching link by text content', async () => {
    const fetcher = new Fetcher(axios.create(), logger);
    const source = new HDHub4u(fetcher);

    const imdbId = new ImdbId('tt5555555', undefined, undefined);

    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('pingora')) return { hits: [] };
      if (url.href.includes('themoviedb')) return { movie_results: [{ id: 555, title: 'Test', release_date: '2024-01-01' }] };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('s=tt5555555')) {
        return `<html><body>
          <a href="https://new1.hdhub4u.fo/some-movie">Some Movie tt5555555 Download</a>
          <a href="https://other.site/irrelevant">Other Site</a>
          <a href="https://new1.hdhub4u.fo/unrelated">Unrelated Page</a>
          <a>Link without href</a>
        </body></html>`;
      }
      return '<html><body></body></html>';
    });
    jest.spyOn(fetcher, 'head').mockResolvedValue({});

    const result = await source.handle(ctx, 'movie', imdbId);
    expect(result).toEqual([]);
  });
});
