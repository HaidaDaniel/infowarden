import * as crypto from 'crypto';

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  attributes: Record<string, string | number | boolean>;
};

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const SECRET_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const CONTENT_KEY_PATTERN = /(content|text|body|document|chunk|prompt|input|payload|raw|sample)/i;
const SECRET_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._~+/-]+=*|sk-[a-z0-9_-]+|gh[pousr]_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|api[_-]?key=|token=|password=|authorization=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const CONTENT_VALUE_PATTERN = /(source content|document body|chunk text|prompt sample|raw prompt|raw document)/i;

export function parseTraceparent(value?: string | string[]): TraceContext | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }
  const match = raw.trim().match(TRACEPARENT_PATTERN);
  if (!match) {
    return undefined;
  }
  return {
    traceId: match[1].toLowerCase(),
    spanId: randomHex(8),
    parentSpanId: match[2].toLowerCase(),
    sampled: (Number.parseInt(match[3], 16) & 1) === 1,
    attributes: {},
  };
}

export function createTraceContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId || randomHex(16),
    spanId: randomHex(8),
    parentSpanId: parent?.spanId || parent?.parentSpanId,
    sampled: parent?.sampled ?? true,
    attributes: {},
  };
}

export function toTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

export function sanitizeAttributes(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY_PATTERN.test(key) || CONTENT_KEY_PATTERN.test(key) || value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string') {
      output[key] = sanitizeStringValue(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = `[array:${value.length}]`;
    } else {
      output[key] = '[object]';
    }
  }
  return output;
}

function sanitizeStringValue(value: string): string {
  const sanitizedUrl = sanitizeUrl(value);
  if (sanitizedUrl) {
    return sanitizedUrl.length > 160 ? `${sanitizedUrl.slice(0, 157)}...` : sanitizedUrl;
  }

  if (SECRET_VALUE_PATTERN.test(value) || CONTENT_VALUE_PATTERN.test(value)) {
    return '[redacted]';
  }

  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function sanitizeUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return undefined;
  }

  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
  }
  for (const [key, parameterValue] of parsed.searchParams.entries()) {
    if (
      SECRET_KEY_PATTERN.test(key) ||
      CONTENT_KEY_PATTERN.test(key) ||
      SECRET_VALUE_PATTERN.test(parameterValue) ||
      CONTENT_VALUE_PATTERN.test(parameterValue)
    ) {
      parsed.searchParams.set(key, '[redacted]');
    }
  }
  return parsed.toString();
}

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString('hex');
}
