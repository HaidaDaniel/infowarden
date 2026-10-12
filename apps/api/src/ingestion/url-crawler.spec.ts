import * as http from 'http';
import * as dns from 'dns/promises';
import { AppException } from '../common/app-error';
import { OutboundUrlPolicy } from './outbound-url-policy';
import { UrlCrawler } from './url-crawler';

describe('UrlCrawler', () => {
  let server: http.Server;
  let baseUrl: string;

  afterEach(async () => {
    jest.restoreAllMocks();
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('crawls bounded same-host HTML pages into in-memory file entries', async () => {
    await startServer((req, res) => {
      if (req.url === '/robots.txt') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><title>Home</title><style>.x{}</style></head><body><h1>Hello</h1><a href="/docs">Docs</a><a href="https://other.example/page">Offsite</a><script>bad()</script></body></html>');
        return;
      }
      if (req.url === '/docs') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<article><h2>Docs</h2><p>Indexable docs text.</p></article>');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const crawler = createCrawler({ allowPrivateNetworks: true, allowedPorts: [portFromUrl(baseUrl)] });
    const result = await crawler.crawl(`${baseUrl}/`, {
      maxPages: 2,
      respectRobots: false,
    });

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({
      relativePath: 'index.html',
      absolutePath: `${baseUrl}/`,
      metadata: expect.objectContaining({
        sourceUrl: `${baseUrl}/`,
        contentType: 'text/html',
      }),
    });
    expect(result.files[0].content?.toString('utf8')).toContain('Hello');
    expect(result.files[0].content?.toString('utf8')).not.toContain('bad()');
    expect(result.metadata).toMatchObject({
      startUrl: `${baseUrl}/`,
      fetchedUrls: [`${baseUrl}/`, `${baseUrl}/docs`],
      maxPages: 2,
      sameHost: true,
    });
  });

  it('records unsupported content as a skipped file entry', async () => {
    await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end('%PDF');
    });

    const crawler = createCrawler({ allowPrivateNetworks: true, allowedPorts: [portFromUrl(baseUrl)] });
    const result = await crawler.crawl(`${baseUrl}/manual.pdf`, {
      maxPages: 1,
      respectRobots: false,
    });

    expect(result.files).toEqual([
      expect.objectContaining({
        relativePath: 'manual.pdf',
        skipReason: 'Unsupported URL content type: application/pdf',
        metadata: expect.objectContaining({
          code: 'url_unsupported_content',
          contentType: 'application/pdf',
        }),
      }),
    ]);
    expect(result.metadata.fetchedUrls).toEqual([]);
  });

  it('fails with a structured exception when a URL cannot be fetched', async () => {
    const crawler = createCrawler({ allowPrivateNetworks: true, allowedPorts: [1] });

    await expect(
      crawler.crawl('http://127.0.0.1:1/unreachable', {
        timeoutMs: 250,
        respectRobots: false,
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('fails before accepting a page that exceeds the per-page byte limit', async () => {
    await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(2048));
    });
    const crawler = createCrawler({ allowPrivateNetworks: true, allowedPorts: [portFromUrl(baseUrl)] });

    await expect(
      crawler.crawl(`${baseUrl}/large.txt`, {
        maxBytesPerPage: 1024,
        respectRobots: false,
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('rejects non-HTTP URL schemes', async () => {
    const crawler = createCrawler();

    await expect(crawler.crawl('file:///etc/passwd')).rejects.toBeInstanceOf(AppException);
  });

  it('rejects private, loopback, metadata, and encoded loopback URLs before connecting', async () => {
    const crawler = createCrawler();

    await expect(crawler.crawl('http://10.0.0.5/docs')).rejects.toMatchObject({ code: 'url_network_prohibited' });
    await expect(crawler.crawl('http://127.0.0.1/docs')).rejects.toMatchObject({ code: 'url_network_prohibited' });
    await expect(crawler.crawl('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject({
      code: 'url_network_prohibited',
    });
    await expect(crawler.crawl('http://2130706433/encoded')).rejects.toMatchObject({
      code: 'url_network_prohibited',
    });
    await expect(crawler.crawl('http://[::1]/docs')).rejects.toMatchObject({ code: 'url_network_prohibited' });
    await expect(crawler.crawl('http://[fc00::1]/docs')).rejects.toMatchObject({ code: 'url_network_prohibited' });
  });

  it('rejects localhost aliases and internal service hostnames by policy', async () => {
    const crawler = createCrawler({ allowedPorts: [80, 443, 6333] });

    await expect(crawler.crawl('http://localhost/docs')).rejects.toMatchObject({ code: 'url_hostname_internal' });
    await expect(crawler.crawl('http://host.docker.internal/docs')).rejects.toMatchObject({
      code: 'url_hostname_internal',
    });
    await expect(crawler.crawl('http://qdrant:6333/collections')).rejects.toMatchObject({
      code: 'url_hostname_internal',
    });
  });

  it('fails closed when DNS returns mixed public and private answers', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ] as any);
    const policy = createPolicy();

    await expect(policy.resolveAndValidate(new URL('https://docs.example.test/page'))).rejects.toMatchObject({
      code: 'url_network_prohibited',
    });
  });

  it('revalidates DNS state on each request to fail DNS rebinding closed', async () => {
    const lookup = jest
      .spyOn(dns, 'lookup')
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as any);
    const policy = createPolicy();

    await expect(policy.resolveAndValidate(new URL('https://docs.example.test/page'))).resolves.toMatchObject({
      address: '93.184.216.34',
    });
    await expect(policy.resolveAndValidate(new URL('https://docs.example.test/page'))).rejects.toMatchObject({
      code: 'url_network_prohibited',
    });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('validates redirect targets with the same hostname policy', async () => {
    await startServer((_req, res) => {
      res.writeHead(302, { location: `${baseUrl}/private` });
      res.end();
    });
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
    const crawler = createCrawler({
      allowPrivateNetworks: true,
      allowedHosts: ['public.example.test', '127.0.0.1'],
      deniedHosts: ['127.0.0.1'],
      allowedPorts: [portFromUrl(baseUrl)],
    });

    await expect(crawler.crawl(`http://public.example.test:${portFromUrl(baseUrl)}/redirect`, {
      respectRobots: false,
    })).rejects.toMatchObject({ code: 'url_hostname_denied' });
  });

  it('accepts a valid public DNS answer without contacting it during policy validation', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    const policy = createPolicy();

    await expect(policy.resolveAndValidate(new URL('https://docs.example.test/page'))).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    });
  });

  async function startServer(handler: http.RequestListener): Promise<void> {
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

type TestPolicyOptions = {
  allowPrivateNetworks?: boolean;
  allowedHosts?: string[];
  deniedHosts?: string[];
  allowedPorts?: number[];
};

function createCrawler(options: TestPolicyOptions = {}) {
  const config = createConfig(options);
  return new UrlCrawler(config as any, new OutboundUrlPolicy(config as any));
}

function createPolicy(options: TestPolicyOptions = {}) {
  return new OutboundUrlPolicy(createConfig(options) as any);
}

function createConfig(options: TestPolicyOptions = {}) {
  return {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        URL_SOURCE_MAX_PAGES: 25,
        URL_SOURCE_MAX_BYTES_PER_PAGE: 1024 * 1024,
        URL_SOURCE_TOTAL_MAX_BYTES: 5 * 1024 * 1024,
        URL_SOURCE_TIMEOUT_MS: 10000,
        URL_SOURCE_SAME_HOST: true,
        URL_SOURCE_RESPECT_ROBOTS: true,
        URL_SOURCE_ALLOW_PRIVATE_NETWORKS: options.allowPrivateNetworks ?? false,
        URL_SOURCE_ALLOWED_HOSTS: options.allowedHosts?.join(',') || '',
        URL_SOURCE_DENIED_HOSTS: options.deniedHosts?.join(',') || '',
        URL_SOURCE_ALLOWED_PORTS: options.allowedPorts?.join(',') || '80,443',
        URL_SOURCE_MAX_REDIRECTS: 5,
        URL_SOURCE_MAX_HEADER_BYTES: 64 * 1024,
      };
      return values[key];
    }),
  };
}

function portFromUrl(value: string): number {
  return Number(new URL(value).port);
}
