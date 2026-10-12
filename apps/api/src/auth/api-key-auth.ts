export function extractApiKey(headers: Record<string, unknown>): string | undefined {
  const headerKey = firstHeader(headers['x-api-key']);
  if (headerKey) {
    return headerKey;
  }

  const authorization = firstHeader(headers.authorization);
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function firstHeader(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return undefined;
}
