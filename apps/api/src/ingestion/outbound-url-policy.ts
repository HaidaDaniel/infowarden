import * as dns from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { IncomingHttpHeaders } from 'http';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, getErrorMessage } from '../common/app-error';

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type OutboundHttpResponse = {
  status: number;
  finalUrl: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  bytes: number;
};

export type OutboundUrlPolicyOptions = {
  timeoutMs: number;
  maxBytes: number;
};

type RuntimePolicy = {
  allowPrivateNetworks: boolean;
  allowedHosts: string[];
  deniedHosts: string[];
  allowedPorts: number[];
  maxRedirects: number;
  maxHeaderBytes: number;
};

const DEFAULT_ALLOWED_PORTS = [80, 443];
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;

const BLOCKED_INTERNAL_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'host.docker.internal',
  'gateway.docker.internal',
  'docker',
  'postgres',
  'postgresql',
  'redis',
  'qdrant',
  'api',
  'web',
  'mcp',
  'mcp-server',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

@Injectable()
export class OutboundUrlPolicy {
  constructor(private readonly configService: ConfigService) {}

  normalizeAndValidateUrl(uri: string): string {
    let url: URL;
    try {
      url = new URL(uri.trim());
    } catch {
      throw new AppException(
        'url_source_invalid_uri',
        'URL source URI must be a valid URL',
        'validate_url_source',
        false,
      );
    }

    this.validateUrl(url);
    url.hash = '';
    return url.toString();
  }

  async fetchUrl(uri: string, options: OutboundUrlPolicyOptions): Promise<OutboundHttpResponse> {
    let currentUrl = this.normalizeAndValidateUrl(uri);
    const policy = this.resolvePolicy();

    for (let redirects = 0; redirects <= policy.maxRedirects; redirects += 1) {
      const url = new URL(currentUrl);
      const resolved = await this.resolveAndValidate(url, policy);
      const response = await this.requestOnce(url, resolved, options, policy);

      if (this.isRedirect(response.status)) {
        const location = this.headerValue(response.headers.location);
        if (!location) {
          throw new AppException(
            'url_redirect_missing_location',
            'URL redirect did not include a Location header',
            'fetch_url_source',
            false,
            { url: this.safeUrlForDetails(url) },
          );
        }

        if (redirects >= policy.maxRedirects) {
          throw new AppException(
            'url_redirect_limit_exceeded',
            'URL redirect limit exceeded',
            'fetch_url_source',
            false,
            { url: this.safeUrlForDetails(url), maxRedirects: policy.maxRedirects },
          );
        }

        currentUrl = this.normalizeAndValidateUrl(new URL(location, url).toString());
        continue;
      }

      return {
        ...response,
        finalUrl: currentUrl,
      };
    }

    throw new AppException('url_redirect_limit_exceeded', 'URL redirect limit exceeded', 'fetch_url_source', false, {
      maxRedirects: policy.maxRedirects,
    });
  }

  async resolveAndValidate(url: URL, policy: RuntimePolicy = this.resolvePolicy()): Promise<ResolvedAddress> {
    this.validateUrl(url, policy);

    const hostname = this.normalizedHostname(url.hostname);
    const directFamily = net.isIP(hostname);
    const answers: ResolvedAddress[] = directFamily
      ? [{ address: hostname, family: directFamily as 4 | 6 }]
      : await this.resolveHostname(hostname);

    if (answers.length === 0) {
      throw new AppException('url_dns_empty', 'URL hostname did not resolve', 'fetch_url_source', true, {
        host: hostname,
      });
    }

    const blocked = answers.find((answer) => !policy.allowPrivateNetworks && this.isProhibitedAddress(answer));
    if (blocked) {
      throw new AppException(
        'url_network_prohibited',
        'URL resolved to a prohibited network address',
        'fetch_url_source',
        false,
        { host: hostname, family: blocked.family, reason: this.prohibitedAddressReason(blocked) },
      );
    }

    return answers[0];
  }

  private validateUrl(url: URL, policy: RuntimePolicy = this.resolvePolicy()): void {
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppException(
        'url_source_unsupported_scheme',
        'URL source URI must use http or https',
        'validate_url_source',
        false,
        {
          scheme: url.protocol.replace(/:$/, ''),
        },
      );
    }

    if (url.username || url.password) {
      throw new AppException(
        'url_source_credentials_rejected',
        'URL source URI must not include credentials',
        'validate_url_source',
        false,
        { host: url.host },
      );
    }

    const hostname = this.normalizedHostname(url.hostname);
    if (!hostname) {
      throw new AppException(
        'url_source_invalid_hostname',
        'URL source URI must include a hostname',
        'validate_url_source',
        false,
      );
    }

    if (this.matchesHost(hostname, policy.deniedHosts)) {
      throw new AppException(
        'url_hostname_denied',
        'URL hostname is denied by outbound policy',
        'validate_url_source',
        false,
        { host: hostname },
      );
    }

    if (policy.allowedHosts.length > 0 && !this.matchesHost(hostname, policy.allowedHosts)) {
      throw new AppException(
        'url_hostname_not_allowed',
        'URL hostname is not allowed by outbound policy',
        'validate_url_source',
        false,
        { host: hostname },
      );
    }

    if (!policy.allowPrivateNetworks && this.isInternalHostname(hostname)) {
      throw new AppException(
        'url_hostname_internal',
        'URL hostname is reserved for local or internal services',
        'validate_url_source',
        false,
        { host: hostname },
      );
    }

    const port = this.effectivePort(url);
    if (!policy.allowedPorts.includes(port)) {
      throw new AppException(
        'url_port_not_allowed',
        'URL port is not allowed by outbound policy',
        'validate_url_source',
        false,
        { host: hostname, port },
      );
    }
  }

  private async requestOnce(
    url: URL,
    resolved: ResolvedAddress,
    options: OutboundUrlPolicyOptions,
    policy: RuntimePolicy,
  ): Promise<Omit<OutboundHttpResponse, 'finalUrl'>> {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          request.destroy(new Error('URL request timed out'));
          reject(
            new AppException('url_source_fetch_timeout', 'URL source request timed out', 'fetch_url_source', true, {
              url: this.safeUrlForDetails(url),
              timeoutMs: options.timeoutMs,
            }),
          );
        }
      }, options.timeoutMs);

      const request: http.ClientRequest = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: this.effectivePort(url),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          servername: this.normalizedHostname(url.hostname),
          maxHeaderSize: policy.maxHeaderBytes,
          headers: {
            host: url.host,
            'user-agent': 'InfoWarden URL crawler',
            accept: 'text/html,text/plain,text/markdown,application/xhtml+xml;q=0.9,*/*;q=0.1',
            'accept-encoding': 'identity',
          },
          lookup: (_hostname, optionsOrCallback, maybeCallback) => {
            const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
            if (typeof optionsOrCallback === 'object' && optionsOrCallback?.all) {
              callback(null, [{ address: resolved.address, family: resolved.family }]);
              return;
            }
            callback(null, resolved.address, resolved.family);
          },
        },
        (response) => {
          const encoding = this.headerValue(response.headers['content-encoding']);
          if (encoding && !['identity', 'none'].includes(encoding.toLowerCase())) {
            response.resume();
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              reject(
                new AppException(
                  'url_compressed_response_unsupported',
                  'Compressed URL responses are not accepted by the bounded crawler',
                  'fetch_url_source',
                  false,
                  { url: this.safeUrlForDetails(url), encoding },
                ),
              );
            }
            return;
          }

          const contentLength = Number(this.headerValue(response.headers['content-length']) || 0);
          if (contentLength > options.maxBytes) {
            response.resume();
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              reject(
                new AppException(
                  'url_source_page_too_large',
                  'URL response exceeds per-page byte limit',
                  'fetch_url_source',
                  false,
                  { url: this.safeUrlForDetails(url), contentLength, maxBytes: options.maxBytes },
                ),
              );
            }
            return;
          }

          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > options.maxBytes) {
              response.destroy(
                new AppException(
                  'url_source_page_too_large',
                  'URL response exceeds per-page byte limit',
                  'fetch_url_source',
                  false,
                  { url: this.safeUrlForDetails(url), bytes, maxBytes: options.maxBytes },
                ),
              );
              return;
            }
            chunks.push(buffer);
          });
          response.on('end', () => {
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
                bytes,
              });
            }
          });
          response.on('error', (error) => {
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              reject(error);
            }
          });
        },
      );

      request.on('error', (error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          if (error instanceof AppException) {
            reject(error);
            return;
          }
          reject(
            new AppException('url_source_fetch_failed', 'URL source could not be fetched', 'fetch_url_source', true, {
              url: this.safeUrlForDetails(url),
              cause: getErrorMessage(error),
            }),
          );
        }
      });

      request.end();
    });
  }

  private async resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
    try {
      return (await dns.lookup(hostname, { all: true, verbatim: true })).map((answer) => ({
        address: answer.address,
        family: answer.family as 4 | 6,
      }));
    } catch (error) {
      throw new AppException('url_dns_lookup_failed', 'URL hostname could not be resolved', 'fetch_url_source', true, {
        host: hostname,
        cause: getErrorMessage(error),
      });
    }
  }

  private isRedirect(status: number): boolean {
    return [301, 302, 303, 307, 308].includes(status);
  }

  private isInternalHostname(hostname: string): boolean {
    if (BLOCKED_INTERNAL_HOSTS.has(hostname)) {
      return true;
    }
    if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return true;
    }
    return net.isIP(hostname) === 0 && !hostname.includes('.');
  }

  private isProhibitedAddress(answer: ResolvedAddress): boolean {
    return this.prohibitedAddressReason(answer) !== undefined;
  }

  private prohibitedAddressReason(answer: ResolvedAddress): string | undefined {
    const address = this.normalizedHostname(answer.address);

    if (answer.family === 4) {
      return this.prohibitedIpv4Reason(address);
    }

    const bytes = this.ipv6ToBytes(address);
    if (!bytes) {
      return 'invalid_ipv6';
    }

    const mapped = this.ipv4FromMappedIpv6(bytes);
    if (mapped) {
      return this.prohibitedIpv4Reason(mapped) ? `mapped_${this.prohibitedIpv4Reason(mapped)}` : undefined;
    }

    if (this.ipv6Matches(bytes, '::', 128)) return 'unspecified';
    if (this.ipv6Matches(bytes, '::1', 128)) return 'loopback';
    if (this.ipv6Matches(bytes, 'fc00::', 7)) return 'unique_local';
    if (this.ipv6Matches(bytes, 'fe80::', 10)) return 'link_local';
    if (this.ipv6Matches(bytes, 'ff00::', 8)) return 'multicast';
    if (this.ipv6Matches(bytes, '2001:db8::', 32)) return 'documentation';
    if (this.ipv6Matches(bytes, '2001:2::', 48)) return 'benchmark';
    if (this.ipv6Matches(bytes, '64:ff9b::', 96)) return 'translation';

    return undefined;
  }

  private prohibitedIpv4Reason(address: string): string | undefined {
    const value = this.ipv4ToInt(address);
    if (value === undefined) return 'invalid_ipv4';
    if (this.ipv4InRange(value, '0.0.0.0', 8)) return 'unspecified';
    if (this.ipv4InRange(value, '10.0.0.0', 8)) return 'private';
    if (this.ipv4InRange(value, '100.64.0.0', 10)) return 'carrier_grade_nat';
    if (this.ipv4InRange(value, '127.0.0.0', 8)) return 'loopback';
    if (this.ipv4InRange(value, '169.254.0.0', 16)) return 'link_local_or_metadata';
    if (this.ipv4InRange(value, '172.16.0.0', 12)) return 'private';
    if (this.ipv4InRange(value, '192.0.0.0', 24)) return 'reserved';
    if (this.ipv4InRange(value, '192.0.2.0', 24)) return 'documentation';
    if (this.ipv4InRange(value, '192.168.0.0', 16)) return 'private';
    if (this.ipv4InRange(value, '198.18.0.0', 15)) return 'benchmark';
    if (this.ipv4InRange(value, '198.51.100.0', 24)) return 'documentation';
    if (this.ipv4InRange(value, '203.0.113.0', 24)) return 'documentation';
    if (this.ipv4InRange(value, '224.0.0.0', 4)) return 'multicast_or_reserved';
    if (value === this.ipv4ToInt('255.255.255.255')) return 'broadcast';
    return undefined;
  }

  private resolvePolicy(): RuntimePolicy {
    return {
      allowPrivateNetworks: this.booleanConfig('URL_SOURCE_ALLOW_PRIVATE_NETWORKS', false),
      allowedHosts: this.listConfig('URL_SOURCE_ALLOWED_HOSTS'),
      deniedHosts: this.listConfig('URL_SOURCE_DENIED_HOSTS'),
      allowedPorts: this.numberListConfig('URL_SOURCE_ALLOWED_PORTS', DEFAULT_ALLOWED_PORTS),
      maxRedirects: this.intConfig('URL_SOURCE_MAX_REDIRECTS', DEFAULT_MAX_REDIRECTS, 0, 10),
      maxHeaderBytes: this.intConfig('URL_SOURCE_MAX_HEADER_BYTES', DEFAULT_MAX_HEADER_BYTES, 4096, 256 * 1024),
    };
  }

  private matchesHost(hostname: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1);
        return hostname.endsWith(suffix) && hostname.length > suffix.length;
      }
      return hostname === pattern;
    });
  }

  private headerValue(value: string | string[] | number | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return value;
  }

  private effectivePort(url: URL): number {
    if (url.port) {
      return Number(url.port);
    }
    return url.protocol === 'https:' ? 443 : 80;
  }

  private safeUrlForDetails(url: URL): string {
    return `${url.protocol}//${url.host}${url.pathname}`;
  }

  private normalizedHostname(value: string): string {
    return value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
  }

  private ipv4ToInt(address: string): number | undefined {
    const parts = address.split('.');
    if (parts.length !== 4) return undefined;
    let value = 0;
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return undefined;
      const octet = Number(part);
      if (octet < 0 || octet > 255) return undefined;
      value = (value << 8) + octet;
    }
    return value >>> 0;
  }

  private ipv4InRange(value: number, base: string, prefix: number): boolean {
    const baseValue = this.ipv4ToInt(base);
    if (baseValue === undefined) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  }

  private ipv6Matches(bytes: number[], base: string, prefix: number): boolean {
    const baseBytes = this.ipv6ToBytes(base);
    if (!baseBytes) return false;
    let remaining = prefix;
    for (let index = 0; index < bytes.length && remaining > 0; index += 1) {
      const bits = Math.min(8, remaining);
      const mask = (0xff << (8 - bits)) & 0xff;
      if ((bytes[index] & mask) !== (baseBytes[index] & mask)) {
        return false;
      }
      remaining -= bits;
    }
    return true;
  }

  private ipv4FromMappedIpv6(bytes: number[]): string | undefined {
    const mappedPrefix = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
    if (!mappedPrefix) {
      return undefined;
    }
    return bytes.slice(12).join('.');
  }

  private ipv6ToBytes(address: string): number[] | undefined {
    const clean = this.normalizedHostname(address);
    const parts = clean.split('::');
    if (parts.length > 2) return undefined;

    const left = this.parseIpv6Part(parts[0]);
    const right = parts.length === 2 ? this.parseIpv6Part(parts[1]) : [];
    if (!left || !right) return undefined;

    const missing = 8 - left.length - right.length;
    if (missing < 0 || (parts.length === 1 && missing !== 0)) return undefined;

    const groups = [...left, ...Array(missing).fill(0), ...right];
    if (groups.length !== 8) return undefined;

    return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
  }

  private parseIpv6Part(value: string): number[] | undefined {
    if (!value) return [];
    const groups: number[] = [];
    for (const raw of value.split(':')) {
      if (!raw) return undefined;
      if (raw.includes('.')) {
        const ipv4 = this.ipv4ToInt(raw);
        if (ipv4 === undefined) return undefined;
        groups.push((ipv4 >> 16) & 0xffff, ipv4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(raw)) return undefined;
      groups.push(parseInt(raw, 16));
    }
    return groups;
  }

  private listConfig(key: string): string[] {
    const value = this.configService.get<string>(key);
    if (!value) return [];
    return value
      .split(',')
      .map((item) => this.normalizedHostname(item))
      .filter(Boolean);
  }

  private numberListConfig(key: string, fallback: number[]): number[] {
    const parsed = this.listConfig(key)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0 && item <= 65535);
    return parsed.length > 0 ? parsed : fallback;
  }

  private booleanConfig(key: string, fallback: boolean): boolean {
    const value = this.configService.get<string | boolean>(key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    return fallback;
  }

  private intConfig(key: string, fallback: number, min: number, max: number): number {
    const value = Number(this.configService.get<number | string>(key));
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(value)));
  }
}
