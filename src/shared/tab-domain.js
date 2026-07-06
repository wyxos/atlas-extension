const tabDomainProtocols = new Set(['http:', 'https:']);

export function normalizeTabDomain(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(value.trim());

    if (!tabDomainProtocols.has(parsed.protocol)) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');

    return hostname.replace(/^www\./u, '') || null;
  } catch {
    return null;
  }
}
