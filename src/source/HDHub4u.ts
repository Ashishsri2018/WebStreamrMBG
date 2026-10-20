import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode, Meta } from '../types';
import { DEAD_HUBCLOUD_HOSTS, Fetcher, findCountryCodes, getImdbId, HUB_HOST_PATTERN, Id, ImdbId } from '../utils';
import { resolveRedirectUrl } from './hd-hub-helper';
import { Source, SourceResult } from './Source';

interface CdnHostResponse {
  h?: string;
  c?: string;
  t?: number;
}

interface SearchResponsePartial {
  hits: {
    document: {
      imdb_id: string;
      permalink: string;
      post_title: string;
    };
  }[];
}

const CDN_HOST_URL = 'https://cdn.hdhub4u.glass/host/';
const CDN_HOST_TTL = 4 * 60 * 60 * 1000;

const DOMAINS_JSON_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
const DOMAINS_JSON_KEY = 'HDHUB4u';
const DOMAINS_JSON_TTL = 4 * 60 * 60 * 1000;

let cdnDiscoveredUrl: string | null = null;
let cdnDiscoveryTs = 0;
let cdnVerifiedAliveAt = 0;
let domainsJsonUrl: string | null = null;
let domainsJsonTs = 0;
export const CDN_VERIFY_INTERVAL = 5 * 60 * 1000;

export function resetCdnCache(): string | undefined {
  let evictedHost: string | undefined;
  if (cdnDiscoveredUrl) {
    try {
      evictedHost = new URL(cdnDiscoveredUrl).hostname;
    } catch { /* invalid CDN URL */ }
  }
  cdnDiscoveredUrl = null;
  cdnDiscoveryTs = 0;
  cdnVerifiedAliveAt = 0;
  domainsJsonUrl = null;
  domainsJsonTs = 0;
  return evictedHost;
}

Source.evictionCallbacks.set('hdhub', resetCdnCache);

const EXCLUDED_HREF_PATTERNS = ['gadgetsweb', '4khdhub', 'linksly', 'shareus', 'dood', 'desiupload', 'megaup', 'filepress', 'mediashore', 'ninjastream', 'hubstream'];

/** Canonical identity key — strips ephemeral query params for HubCloud (keeps from_ac), keeps full href otherwise. */
const getCanonicalKey = (url: URL): string => {
  if (/hubcloud/.test(url.hostname)) {
    const u = new URL(url);
    const fromAc = u.searchParams.get('from_ac');
    u.search = '';
    if (fromAc) u.searchParams.set('from_ac', fromAc);
    return u.href;
  }
  return url.href;
};

/** Deduplicate SourceResults by canonical URL. */
const deduplicateSourceResults = (results: SourceResult[]): SourceResult[] => {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = getCanonicalKey(r.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export class HDHub4u extends Source {
  public readonly id = 'hdhub4u';

  public readonly label = 'HDHub4u';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.gu, CountryCode.hi, CountryCode.ml, CountryCode.pa, CountryCode.ta, CountryCode.te];

  public readonly baseUrl = 'https://new8.hdhub4u.cl';

  protected override readonly domainKey = 'hdhub';

  private readonly FALLBACK_CANDIDATES = [
    'https://new8.hdhub4u.cl',
    'https://new1.hdhub4u.limo',
    'https://new1.hdhub4u.fo',
    'https://new2.hdhub4u.fo',
    'https://new3.hdhub4u.fo',
    'https://new4.hdhub4u.fo',
    'https://new5.hdhub4u.fo',
    'https://new6.hdhub4u.fo',
    'https://new7.hdhub4u.fo',
    'https://new8.hdhub4u.fo',
    'https://new9.hdhub4u.fo',
    'https://new10.hdhub4u.fo',
  ];

  private readonly searchUrl = 'https://search.pingora.fyi';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();

    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const imdbId = await getImdbId(ctx, this.fetcher, id);

    const pageUrls = await this.fetchPageUrls(ctx, imdbId);

    return deduplicateSourceResults(
      (await Promise.all(
        pageUrls.map(async (pageUrl) => {
          return await this.handlePage(ctx, pageUrl, imdbId);
        }),
      )).flat(),
    );
  };

  private readonly handlePage = async (ctx: Context, pageUrl: URL, imdbId: ImdbId): Promise<SourceResult[]> => {
    const html = await this.fetcher.text(ctx, pageUrl);

    const $ = cheerio.load(html);

    const meta = {
      countryCodes: [CountryCode.multi, ...findCountryCodes($('div:contains("Language"):not(:has(div)):first').text())],
    };

    if (!imdbId.episode) {
      return [
        ...this.extractHubDriveUrlResults(html, meta),
        ...(await Promise.all(
          $('a[href*="gadgetsweb"]').map((_i, el) => this.handleHubLinks(ctx, new URL($(el).attr('href') as string), pageUrl, meta)),
        )).flat(),
      ];
    }

    const ep = imdbId.episode;
    const epPadded = String(ep).padStart(2, '0');
    const episodeSelector = [
      `h3:contains("EP-${epPadded}")`,
      `h3:contains("EPiSODE ${ep}")`,
      `h3:contains("EPiSODE ${epPadded}")`,
      `h3:contains("Episode ${ep}")`,
      `h3:contains("Episode ${epPadded}")`,
      `h4:contains("EP-${epPadded}")`,
      `h4:contains("EPiSODE ${ep}")`,
      `h4:contains("E${epPadded} ")`,
      `h4:contains("E${ep} ")`,
      `h4:contains("EPiSODE ${epPadded}")`,
      `h4:contains("Episode ${ep}")`,
      `h4:contains("Episode ${epPadded}")`,
      `h2:contains("EPiSODE ${ep}")`,
      `h2:contains("EPiSODE ${epPadded}")`,
      `h2:contains("Episode ${ep}")`,
      `h2:contains("Episode ${epPadded}")`,
    ].join(', ');

    const heading = $(episodeSelector).first();
    const headingAndAfterHtml = $.html(heading)
      + heading.nextUntil('hr').map((_i, el) => $.html(el)).get().join('');

    // Episode-scoped gadgetsweb links
    const episodeSection$ = cheerio.load(headingAndAfterHtml);
    const episodeGadgetHrefs = episodeSection$('a[href*="gadgetsweb"]')
      .map((_i, el) => episodeSection$(el).attr('href'))
      .toArray()
      .filter((h): h is string => !!h);

    // Pack-level gadgetsweb links: inside headings that don't mention any episode
    const packGadgetHrefs = $('h2:has(a[href*="gadgetsweb"]), h3:has(a[href*="gadgetsweb"]), h4:has(a[href*="gadgetsweb"]), h5:has(a[href*="gadgetsweb"])')
      .filter((_i, el) => !/EPiSODE\s+\d|EP-\d+|E\d{2}\s|Episode\s+\d/i.test($(el).text()))
      .find('a[href*="gadgetsweb"]')
      .map((_i, el) => $(el).attr('href'))
      .toArray()
      .filter((h): h is string => !!h);

    const allGadgetHrefs = [...new Set([...episodeGadgetHrefs, ...packGadgetHrefs])];

    return [
      ...this.extractHubDriveUrlResults(headingAndAfterHtml, meta),
      ...(await Promise.all(
        allGadgetHrefs.map(href => this.handleHubLinks(ctx, new URL(href), pageUrl, meta)),
      )).flat(),
    ];
  };

  private readonly handleHubLinks = async (ctx: Context, redirectUrl: URL, refererUrl: URL, meta: Meta): Promise<SourceResult[]> => {
    let resolvedUrl: URL;
    try {
      resolvedUrl = await resolveRedirectUrl(ctx, this.fetcher, redirectUrl);
    } catch {
      return [];
    }

    if (!resolvedUrl) {
      return [];
    }

    if (HUB_HOST_PATTERN.test(resolvedUrl.hostname)) {
      if (!DEAD_HUBCLOUD_HOSTS.has(resolvedUrl.hostname)) {
        return [{ url: resolvedUrl, meta: { ...meta, referer: refererUrl.href } }];
      }
      return [];
    }

    const hubLinksHtml = await this.fetcher.text(ctx, resolvedUrl, { headers: { Referer: refererUrl.href } });

    return [
      ...this.extractHubDriveUrlResults(hubLinksHtml, { ...meta, referer: resolvedUrl.href }),
    ];
  };

  private readonly extractHubDriveUrlResults = (html: string, meta: Meta): SourceResult[] => {
    const $ = cheerio.load(html);
    const allLinks = $('a').filter((_i, el) => {
      const href = ($(el).attr('href') ?? '').toLowerCase();
      if (!href) return false;
      if (EXCLUDED_HREF_PATTERNS.some(p => href.includes(p))) return false;
      return HUB_HOST_PATTERN.test(href);
    });
    const filteredLinks = allLinks.not(':contains("⚡")');

    return filteredLinks
      .map((_i, el) => {
        try {
          const url = new URL($(el).attr('href') as string);
          if (DEAD_HUBCLOUD_HOSTS.has(url.hostname)) return null;
          return { url, meta };
        } catch {
          return null;
        }
      })
      .toArray()
      .filter((r): r is SourceResult => r !== null);
  };

  private readonly fetchPageUrls = async (ctx: Context, imdbId: ImdbId): Promise<URL[]> => {
    const baseUrl = await this.getBaseUrl(ctx);

    const results = await this.fetchPageUrlsFromSearch(ctx, imdbId, baseUrl);
    if (results.length > 0) {
      return results;
    }

    return this.fetchPageUrlsFromSiteSearch(ctx, imdbId, baseUrl);
  };

  private readonly fetchPageUrlsFromSearch = async (ctx: Context, imdbId: ImdbId, baseUrl: URL): Promise<URL[]> => {
    try {
      const searchUrl = new URL('/collections/post/documents/search', this.searchUrl);
      searchUrl.searchParams.set('q', imdbId.id);
      searchUrl.searchParams.set('query_by', 'post_title,category,stars,director,imdb_id');
      searchUrl.searchParams.set('query_by_weights', '4,2,2,2,4');
      searchUrl.searchParams.set('sort_by', 'sort_by_date:desc');
      searchUrl.searchParams.set('limit', '15');
      searchUrl.searchParams.set('highlight_fields', 'none');
      searchUrl.searchParams.set('use_cache', 'true');
      searchUrl.searchParams.set('page', '1');

      const searchResponse = await this.fetcher.json(ctx, searchUrl, { headers: { Referer: baseUrl.href } }) as SearchResponsePartial;

      return searchResponse.hits
        .filter(hit =>
          hit.document.imdb_id === imdbId.id
          && (
            !imdbId.season
            || hit.document.post_title.includes(`Season ${imdbId.season}`)
            || hit.document.post_title.includes(`S${String(imdbId.season)}`)
            || hit.document.post_title.includes(`S${String(imdbId.season).padStart(2, '0')}`)
          ),
        )
        .map(hit => this.toBaseUrl(hit.document.permalink, baseUrl));
    } catch {
      return [];
    }
  };

  /**
   * Search results carry absolute permalinks on rotating hosts (often a dead
   * `*.hdhub4u.free` domain). Keep only the path and query, then re-anchor it
   * to the base URL that was probed alive.
   */
  private readonly toBaseUrl = (permalink: string, baseUrl: URL): URL => {
    const resolved = new URL(permalink, baseUrl);

    return new URL(`${resolved.pathname}${resolved.search}`, baseUrl);
  };

  private readonly fetchPageUrlsFromSiteSearch = async (ctx: Context, imdbId: ImdbId, baseUrl: URL): Promise<URL[]> => {
    try {
      const siteSearchUrl = new URL(`/?s=${encodeURIComponent(imdbId.id)}`, baseUrl);
      const html = await this.fetcher.text(ctx, siteSearchUrl);
      const $ = cheerio.load(html);

      return $('a')
        .filter((_i, el) => {
          const href = $(el).attr('href') ?? '';
          const text = $(el).text();
          return href.startsWith(baseUrl.origin)
            && (text.includes(imdbId.id) || href.includes(imdbId.id));
        })
        .map((_i, el) => new URL($(el).attr('href') as string))
        .toArray();
    } catch {
      return [];
    }
  };

  private async discoverFromCdn(ctx: Context): Promise<string | null> {
    if (cdnDiscoveredUrl && Date.now() - cdnDiscoveryTs < CDN_HOST_TTL) {
      return cdnDiscoveredUrl;
    }

    try {
      const d = new Date();
      const seed = (d.getFullYear() * 1000000) + ((d.getMonth() + 1) * 10000) + (d.getDate() * 100) + d.getHours() + 1;
      const url = new URL(`?v=${seed}`, CDN_HOST_URL);
      const response = await this.fetcher.json(ctx, url, { timeout: 5000 }) as CdnHostResponse;

      if (response.c) {
        const decoded = atob(response.c.replace(/\/$/, ''));
        const baseUrl = decoded.replace(/[?&]utm=[^&]*/, '').replace(/\/$/, '');
        cdnDiscoveredUrl = baseUrl;
        cdnDiscoveryTs = Date.now();
        return baseUrl;
      }
    } catch { /* CDN endpoint unreachable */ }

    return null;
  }

  /**
   * Secondary domain source. The shared provider list is stale for HDhub4u,
   * while phisher98's list is updated with the rotating `HDHUB4u` host.
   */
  private readonly discoverFromDomainsJson = async (ctx: Context): Promise<string | null> => {
    if (domainsJsonUrl && Date.now() - domainsJsonTs < DOMAINS_JSON_TTL) {
      return domainsJsonUrl;
    }

    try {
      const response = await this.fetcher.json(ctx, new URL(DOMAINS_JSON_URL)) as Record<string, unknown>;
      const entry = response[DOMAINS_JSON_KEY];
      const url = typeof entry === 'string' ? entry : null;

      if (url) {
        domainsJsonUrl = url;
        domainsJsonTs = Date.now();
        return url;
      }
    } catch { /* domains list unreachable */ }

    return null;
  };

  private readonly getBaseUrl = async (ctx: Context) => {
    const cdnUrl = await this.discoverFromCdn(ctx);
    if (cdnUrl) {
      const hostname = (() => {
        try {
          return new URL(cdnUrl).hostname;
        } catch {
          return '';
        }
      })();
      const diedAt = hostname ? Source.deadDomains.get(hostname) : undefined;
      const isKnownDead = diedAt && Date.now() - diedAt < Source.DEAD_DOMAIN_TTL;

      if (!isKnownDead) {
        const needsVerify = Date.now() - cdnVerifiedAliveAt >= CDN_VERIFY_INTERVAL;
        if (Source.isFailing(this.domainKey) || needsVerify) {
          if (await this.isDomainAlive(ctx, this.fetcher, cdnUrl)) {
            Source.recordSuccess(this.domainKey);
            cdnVerifiedAliveAt = Date.now();
          } else {
            if (hostname) Source.deadDomains.set(hostname, Date.now());
            resetCdnCache();
            return this.probeBaseUrl(ctx, this.fetcher, this.domainKey, this.FALLBACK_CANDIDATES);
          }
        }
        try {
          return new URL(cdnUrl);
        } catch {
          // invalid CDN URL, fall through to probeBaseUrl
        }
      }
    }

    const discoveredDomain = await this.discoverFromDomainsJson(ctx);
    if (discoveredDomain) {
      try {
        return await this.probeBaseUrl(ctx, this.fetcher, this.domainKey, [discoveredDomain]);
      } catch { /* stale domains entry, fall through to static candidates */ }
    }

    return this.probeBaseUrl(ctx, this.fetcher, this.domainKey, this.FALLBACK_CANDIDATES);
  };
}
