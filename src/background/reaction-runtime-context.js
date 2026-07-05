export async function collectReactionRuntimeContext(message, options = {}) {
  const context = {};
  const userAgent = normalizeUserAgent(options.userAgent ?? globalThis.navigator?.userAgent);

  if (userAgent !== null) {
    context.user_agent = userAgent;
  }

  if (message?.reactionType === 'blacklist') {
    return context;
  }

  const cookies = await collectCookiesForUrls(reactionCookieUrls(message), options);

  if (cookies.length > 0) {
    context.cookies = cookies;
  }

  return context;
}

export async function collectCookiesForUrls(urls, options = {}) {
  const normalizedUrls = uniqueCookieUrls(urls);

  if (normalizedUrls.length === 0) {
    return [];
  }

  const cookieLists = await Promise.all(
    normalizedUrls.map((url) => readCookiesForUrl(url, options.chromeApi ?? globalThis.chrome)),
  );
  const byKey = new Map();

  for (const cookieList of cookieLists) {
    for (const cookie of cookieList) {
      byKey.set(cookieKey(cookie), cookie);
    }
  }

  return [...byKey.values()];
}

function reactionCookieUrls(message) {
  if (message?.type === 'atlas-extension.asset-reaction-batch') {
    return (message.items ?? []).flatMap((item) => [
      item?.asset?.source,
      item?.referrerUrl,
    ]);
  }

  return [
    message?.asset?.source,
    message?.referrerUrl,
  ];
}

function uniqueCookieUrls(urls) {
  return [...new Set((urls ?? [])
    .map((url) => normalizeCookieUrl(url))
    .filter((url) => url !== null))];
}

function normalizeCookieUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    url.hash = '';

    return url.href;
  } catch {
    return null;
  }
}

function readCookiesForUrl(url, chromeApi) {
  return new Promise((resolve) => {
    if (typeof chromeApi?.cookies?.getAll !== 'function') {
      resolve([]);

      return;
    }

    chromeApi.cookies.getAll({ url }, (cookies) => {
      if (chromeApi.runtime?.lastError || !Array.isArray(cookies)) {
        resolve([]);

        return;
      }

      resolve(cookies
        .map((cookie) => mapRuntimeCookie(cookie))
        .filter((cookie) => cookie !== null));
    });
  });
}

function mapRuntimeCookie(cookie) {
  const name = typeof cookie?.name === 'string' ? cookie.name.trim() : '';
  const value = typeof cookie?.value === 'string' ? cookie.value : '';
  const domain = typeof cookie?.domain === 'string'
    ? cookie.domain.trim().toLowerCase().replace(/^\.+/, '')
    : '';
  const path = normalizeCookiePath(cookie?.path);
  const expiresAt = typeof cookie?.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)
    ? Math.floor(cookie.expirationDate)
    : null;

  if (name === '' || domain === '') {
    return null;
  }

  return {
    domain,
    expires_at: expiresAt,
    host_only: cookie?.hostOnly === true,
    http_only: cookie?.httpOnly === true,
    name,
    path,
    secure: cookie?.secure === true,
    value,
  };
}

function normalizeCookiePath(value) {
  const path = typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : '/';

  return path.startsWith('/') ? path : `/${path}`;
}

function cookieKey(cookie) {
  return [
    cookie.domain,
    cookie.path,
    cookie.name,
    cookie.value,
    cookie.secure ? '1' : '0',
    cookie.http_only ? '1' : '0',
    cookie.host_only ? '1' : '0',
    cookie.expires_at === null ? 'null' : String(cookie.expires_at),
  ].join('|');
}

function normalizeUserAgent(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}
