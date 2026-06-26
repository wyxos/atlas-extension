const comparableProtocols = new Set(['http:', 'https:']);

export function normalizeComparableUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    const parsed = new URL(trimmed);

    if (!comparableProtocols.has(parsed.protocol) || isPlainRootUrl(parsed)) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function isPlainRootUrl(parsed) {
  return parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
}
