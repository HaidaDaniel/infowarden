import { Prisma } from '@prisma/client';

const SECRET_METADATA_KEY_PATTERN = /(api[-_]?key|token|secret|password|credential|authorization)/i;

export class PortableMetadataSanitizer {
  sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_METADATA_KEY_PATTERN.test(key) ? '[redacted]' : this.sanitize(nestedValue);
    }
    return result as Prisma.JsonObject;
  }

  sanitizeUri(uri: string): string {
    try {
      const parsed = new URL(uri);
      if (parsed.username || parsed.password) {
        parsed.username = '';
        parsed.password = '';
      }
      return parsed.toString();
    } catch {
      return uri;
    }
  }

  plainObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  removeRedacted(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (nestedValue === '[redacted]') continue;
      result[key] =
        nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)
          ? this.removeRedacted(nestedValue)
          : nestedValue;
    }
    return result;
  }

  hasRedactedSecret(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some((item) => this.hasRedactedSecret(item));
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) => {
      if (SECRET_METADATA_KEY_PATTERN.test(key) && nestedValue === '[redacted]') return true;
      return this.hasRedactedSecret(nestedValue);
    });
  }
}
