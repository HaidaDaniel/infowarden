import * as crypto from 'crypto';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileEntry } from './local-folder.scanner';
import { OutboundUrlPolicy } from './outbound-url-policy';

export type UrlCrawlOptions = {
  maxPages?: number;
  maxBytesPerPage?: number;
  totalMaxBytes?: number;
  timeoutMs?: number;
  sameHost?: boolean;
  respectRobots?: boolean;
};

export type UrlCrawlRuntimeMetadata = Required<UrlCrawlOptions> & {
  startUrl: string;
  fetchedUrls: string[];
};

type RobotsRules = {
  disallow: string[];
};

type CrawlResult = {
  files: FileEntry[];
  metadata: UrlCrawlRuntimeMetadata;
};

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
const TEXT_CONTENT_TYPES = ['text/plain', 'text/markdown'];

@Injectable()
export class UrlCrawler {
  constructor(
    private readonly configService: ConfigService,
    private readonly outboundUrlPolicy: OutboundUrlPolicy,
  ) {}

  async crawl(startUri: string, options: UrlCrawlOptions = {}): Promise<CrawlResult> {
    const startUrl = this.normalizeHttpUrl(startUri);
    const limits = this.resolveLimits(options);
    const queue = [startUrl];
    const visited = new Set<string>();
    const files: FileEntry[] = [];
    const fetchedUrls: string[] = [];
    const robots = limits.respectRobots ? await this.fetchRobotsRules(startUrl, limits.timeoutMs) : undefined;
    let totalBytes = 0;

    while (queue.length > 0 && fetchedUrls.length < limits.maxPages) {
      const currentUrl = queue.shift() as string;
      if (visited.has(currentUrl)) {
        continue;
      }
      visited.add(currentUrl);

      if (limits.sameHost && new URL(currentUrl).host !== new URL(startUrl).host) {
        continue;
      }

      if (robots && !this.isAllowedByRobots(currentUrl, robots)) {
        files.push(this.skippedEntry(currentUrl, 'URL is disallowed by robots.txt', 'url_robots_disallowed'));
        continue;
      }

      const fetched = await this.fetchPage(currentUrl, limits.timeoutMs, limits.maxBytesPerPage);
      totalBytes += fetched.bytes;
      if (totalBytes > limits.totalMaxBytes) {
        files.push(
          this.skippedEntry(
            currentUrl,
            `URL crawl exceeded total byte limit (${limits.totalMaxBytes} bytes)`,
            'url_total_bytes_exceeded',
          ),
        );
        break;
      }

      if (fetched.status < 200 || fetched.status >= 300) {
        files.push(
          this.skippedEntry(currentUrl, `URL returned HTTP ${fetched.status}`, 'url_http_error', {
            status: fetched.status,
          }),
        );
        continue;
      }

      if (!this.isSupportedContentType(fetched.contentType)) {
        files.push(
          this.skippedEntry(
            currentUrl,
            `Unsupported URL content type: ${fetched.contentType || 'unknown'}`,
            'url_unsupported_content',
            {
              contentType: fetched.contentType || undefined,
              status: fetched.status,
            },
          ),
        );
        continue;
      }

      const text = this.toNormalizedText(fetched.body, fetched.contentType, currentUrl);
      if (!text.trim()) {
        files.push(
          this.skippedEntry(currentUrl, 'URL produced no indexable text', 'url_empty_content', {
            contentType: fetched.contentType || undefined,
            status: fetched.status,
          }),
        );
        continue;
      }

      fetchedUrls.push(currentUrl);
      files.push({
        relativePath: this.relativePathForUrl(currentUrl, fetched.contentType),
        absolutePath: currentUrl,
        size: fetched.bytes,
        mtime: new Date(),
        content: Buffer.from(text, 'utf8'),
        metadata: {
          sourceUrl: currentUrl,
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          contentType: fetched.contentType || undefined,
        },
      });

      if (this.isHtmlContentType(fetched.contentType)) {
        for (const nextUrl of this.extractLinks(fetched.body.toString('utf8'), currentUrl)) {
          if (!visited.has(nextUrl) && queue.length + fetchedUrls.length < limits.maxPages) {
            queue.push(nextUrl);
          }
        }
      }
    }

    return {
      files,
      metadata: {
        ...limits,
        startUrl,
        fetchedUrls,
      },
    };
  }

  private resolveLimits(options: UrlCrawlOptions): Required<UrlCrawlOptions> {
    return {
      maxPages: this.clampInt(options.maxPages, this.configService.get<number>('URL_SOURCE_MAX_PAGES') || 25, 1, 100),
      maxBytesPerPage: this.clampInt(
        options.maxBytesPerPage,
        this.configService.get<number>('URL_SOURCE_MAX_BYTES_PER_PAGE') || 1024 * 1024,
        1024,
        10 * 1024 * 1024,
      ),
      totalMaxBytes: this.clampInt(
        options.totalMaxBytes,
        this.configService.get<number>('URL_SOURCE_TOTAL_MAX_BYTES') || 5 * 1024 * 1024,
        1024,
        50 * 1024 * 1024,
      ),
      timeoutMs: this.clampInt(
        options.timeoutMs,
        this.configService.get<number>('URL_SOURCE_TIMEOUT_MS') || 10000,
        250,
        60000,
      ),
      sameHost: options.sameHost ?? this.configService.get<boolean>('URL_SOURCE_SAME_HOST') ?? true,
      respectRobots: options.respectRobots ?? this.configService.get<boolean>('URL_SOURCE_RESPECT_ROBOTS') ?? true,
    };
  }

  private normalizeHttpUrl(uri: string): string {
    return this.outboundUrlPolicy.normalizeAndValidateUrl(uri);
  }

  private async fetchPage(url: string, timeoutMs: number, maxBytes: number) {
    const response = await this.outboundUrlPolicy.fetchUrl(url, { timeoutMs, maxBytes });

    return {
      status: response.status,
      finalUrl: response.finalUrl || url,
      contentType: this.normalizeContentType(response.headers['content-type']),
      body: response.body,
      bytes: response.bytes,
    };
  }

  private async fetchRobotsRules(startUrl: string, timeoutMs: number): Promise<RobotsRules | undefined> {
    const url = new URL(startUrl);
    const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;

    try {
      const response = await this.outboundUrlPolicy.fetchUrl(robotsUrl, {
        timeoutMs,
        maxBytes: 128 * 1024,
      });
      if (response.status < 200 || response.status >= 300) {
        return undefined;
      }
      return this.parseRobotsTxt(response.body.toString('utf8'));
    } catch {
      return undefined;
    }
  }

  private parseRobotsTxt(text: string): RobotsRules {
    const disallow: string[] = [];
    let appliesToAll = false;

    for (const line of text.split(/\r?\n/)) {
      const cleaned = line.split('#')[0].trim();
      const [rawKey, ...rawValue] = cleaned.split(':');
      const key = rawKey?.trim().toLowerCase();
      const value = rawValue.join(':').trim();

      if (key === 'user-agent') {
        appliesToAll = value === '*';
      } else if (key === 'disallow' && appliesToAll && value) {
        disallow.push(value);
      }
    }

    return { disallow };
  }

  private isAllowedByRobots(url: string, rules: RobotsRules): boolean {
    const pathname = new URL(url).pathname || '/';
    return !rules.disallow.some((rule) => pathname.startsWith(rule));
  }

  private toNormalizedText(body: Buffer, contentType: string, url: string): string {
    const text = body.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!this.isHtmlContentType(contentType)) {
      return text;
    }

    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const cleaned = text
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|br|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ');
    const parts = [
      `URL: ${url}`,
      title ? `Title: ${this.decodeEntities(title)}` : undefined,
      this.decodeEntities(cleaned),
    ]
      .filter(Boolean)
      .join('\n\n');

    return parts.trim();
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const links = new Set<string>();

    for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
      try {
        const next = new URL(this.decodeEntities(match[1]), baseUrl);
        if (!['http:', 'https:'].includes(next.protocol)) {
          continue;
        }
        next.hash = '';
        links.add(next.toString());
      } catch {
        continue;
      }
    }

    return [...links].sort();
  }

  private relativePathForUrl(urlValue: string, contentType: string): string {
    const url = new URL(urlValue);
    const ext = this.extensionForContentType(contentType);
    const pathname = decodeURIComponent(url.pathname || '/');
    let relative = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

    if (!relative) {
      relative = 'index';
    }

    relative = relative
      .split('/')
      .map((segment) => segment.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'page')
      .join('/');

    const parsed = path.posix.parse(relative);
    if (!parsed.ext) {
      relative = `${relative}${ext}`;
    }

    if (url.search) {
      const hash = crypto.createHash('sha256').update(url.search, 'utf8').digest('hex').slice(0, 8);
      const withExt = path.posix.parse(relative);
      relative = path.posix.join(withExt.dir, `${withExt.name}__query-${hash}${withExt.ext}`);
    }

    return relative;
  }

  private skippedEntry(
    url: string,
    skipReason: string,
    code: string,
    metadata: Record<string, unknown> = {},
  ): FileEntry {
    return {
      relativePath: this.relativePathForUrl(url, 'text/plain'),
      absolutePath: url,
      size: 0,
      mtime: new Date(),
      skipReason,
      metadata: {
        code,
        sourceUrl: url,
        ...metadata,
      },
    };
  }

  private isSupportedContentType(contentType: string): boolean {
    return this.isHtmlContentType(contentType) || TEXT_CONTENT_TYPES.some((type) => contentType.startsWith(type));
  }

  private isHtmlContentType(contentType: string): boolean {
    return HTML_CONTENT_TYPES.some((type) => contentType.startsWith(type));
  }

  private extensionForContentType(contentType: string): string {
    if (contentType.startsWith('text/plain')) {
      return '.txt';
    }
    if (contentType.startsWith('text/markdown')) {
      return '.md';
    }
    return '.html';
  }

  private normalizeContentType(value: string | string[] | number | undefined): string {
    const header = Array.isArray(value) ? value[0] : value;
    return String(header || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  private clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
  }
}
