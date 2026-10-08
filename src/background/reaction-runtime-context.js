import { createDesktopContractError } from '../shared/desktop-contract.js';

export async function collectReactionRuntimeContext(message, options = {}) {
  const context = {};
  const userAgent = normalizeUserAgent(options.userAgent ?? globalThis.navigator?.userAgent);

  if (userAgent !== null) {
    context.user_agent = userAgent;
  }

  if (message?.reactionType === 'blacklist') {
    return context;
  }

  const scope = await resolveCookieScope(options);
  const urls = reactionCookieUrls(message);
  const requestHeaders = options.requestCapture?.snapshot(options.tabId, urls, {
    frameId: options.frameId ?? 0, documentId: options.documentId,
    topPageUrl: message?.asset?.topPageUrl ?? message?.items?.[0]?.asset?.topPageUrl,
  }) ?? [];
  const cookies = await collectCookiesForUrls([...urls, ...requestHeaders.map(record => record.url)], { ...options, scope });

  if (cookies.length > 0) {
    context.cookies = cookies;
  }
  context.browser_session = {
    version: 1,
    captured_at: Math.floor((options.now?.() ?? Date.now()) / 1000),
    cookie_scope: {
      partition_supported: Boolean(scope.partitionKey),
      ...(scope.partitionKey ? {
        top_level_site: scope.partitionKey.topLevelSite,
        ...(typeof scope.partitionKey.hasCrossSiteAncestor === 'boolean'
          ? { has_cross_site_ancestor: scope.partitionKey.hasCrossSiteAncestor } : {}),
      } : {}),
    },
    request_headers: requestHeaders,
  };
  if (new globalThis.TextEncoder().encode(JSON.stringify(context)).length > 256 * 1024) {
    throw sessionError('BROWSER_SESSION_TOO_LARGE', 'The browser session exceeds supported limits.');
  }

  return context;
}

export async function collectCookiesForUrls(urls, options = {}) {
  const normalizedUrls = uniqueCookieUrls(urls);

  if (normalizedUrls.length === 0) {
    return [];
  }

  const scope = options.scope ?? await resolveCookieScope(options);
  const cookieLists = await Promise.all(normalizedUrls.flatMap(url => [
    readCookiesForUrl({ url, ...(scope.storeId ? { storeId: scope.storeId } : {}) }, options.chromeApi ?? globalThis.chrome),
    ...(scope.partitionKey ? [readCookiesForUrl({ url, storeId: scope.storeId, partitionKey: scope.partitionKey },
      options.chromeApi ?? globalThis.chrome)] : []),
  ]));
  const byKey = new Map();

  for (const cookieList of cookieLists) {
    for (const cookie of cookieList) {
      const partition = cookie.partition_key;
      if (partition && (!scope.partitionKey || partition.top_level_site !== scope.partitionKey.topLevelSite
        || partition.has_cross_site_ancestor !== scope.partitionKey.hasCrossSiteAncestor)) continue;
      const key = [cookie.domain, cookie.path, cookie.name].join('|');
      const previous = byKey.get(key);
      if (previous) {
        // A partitioned session belongs to the actual sending frame. Flattening
        // both values into yt-dlp's cookie jar would select an arbitrary login.
        if (partition && !previous.partition_key) { byKey.set(key, cookie); continue; }
        if (!partition && previous.partition_key) continue;
        if (cookieKey(previous) !== cookieKey(cookie)) {
          throw sessionError('BROWSER_SESSION_AMBIGUOUS', 'The browser returned conflicting session cookies. Refresh the page and retry.');
        }
      }
      byKey.set(key, cookie);
    }
  }

  const result = [...byKey.values()];
  if (result.length > 300 || new globalThis.TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024) {
    throw sessionError('BROWSER_SESSION_TOO_LARGE', 'The browser session exceeds supported limits.');
  }
  return result;
}

async function resolveCookieScope(options) {
  const chromeApi = options.chromeApi ?? globalThis.chrome;
  if (!Number.isInteger(options.tabId)) {
    if (options.requireTab === true) throw sessionError('BROWSER_SESSION_UNAVAILABLE', 'The originating browser tab is unavailable.');
    return {};
  }
  const stores = await chromeCookieCall(chromeApi, 'getAllCookieStores');
  const store = Array.isArray(stores) ? stores.find(value => value.tabIds?.includes(options.tabId)) : null;
  if (!store || typeof store.id !== 'string' || !store.id) {
    throw sessionError('BROWSER_SESSION_UNAVAILABLE', 'The originating browser cookie store is unavailable. Refresh the page and retry.');
  }
  let partitionKey;
  if (typeof chromeApi?.cookies?.getPartitionKey === 'function') {
    try {
      const result = await chromeApi.cookies.getPartitionKey({ tabId: options.tabId, frameId: options.frameId ?? 0,
        ...(options.documentId ? { documentId: options.documentId } : {}),
      });
      partitionKey = result?.partitionKey;
      if (!partitionKey || typeof partitionKey.topLevelSite !== 'string' || !partitionKey.topLevelSite) throw new Error();
    } catch {
      throw sessionError('BROWSER_SESSION_UNAVAILABLE', 'The browser cookie partition is unavailable. Refresh the page and retry.');
    }
  }
  return { storeId: store.id, partitionKey };
}

function sessionError(code, message) { return createDesktopContractError(code, message, true); }

function chromeCookieCall(chromeApi, method, details) {
  return new Promise((resolve, reject) => {
    if (typeof chromeApi?.cookies?.[method] !== 'function') {
      reject(sessionError('BROWSER_SESSION_UNAVAILABLE', 'Browser cookie access is unavailable. Check extension permissions and retry.'));
      return;
    }
    const done = value => {
      if (chromeApi.runtime?.lastError || !Array.isArray(value)) {
        reject(sessionError('BROWSER_SESSION_UNAVAILABLE', 'Browser cookies could not be read. Check extension permissions and retry.'));
      } else resolve(value);
    };
    try {
      if (details === undefined) chromeApi.cookies[method](done);
      else chromeApi.cookies[method](details, done);
    } catch {
      reject(sessionError('BROWSER_SESSION_UNAVAILABLE', 'Browser cookies could not be read. Check extension permissions and retry.'));
    }
  });
}

function reactionCookieUrls(message) {
  if (message?.type === 'atlas-extension.asset-reaction-batch') {
    return (message.items ?? []).flatMap((item) => [
      item?.asset?.source,
      item?.referrerUrl,
      item?.asset?.topPageUrl,
    ]);
  }

  return [
    message?.asset?.source,
    message?.referrerUrl,
    message?.asset?.topPageUrl,
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

async function readCookiesForUrl(details, chromeApi) {
  return (await chromeCookieCall(chromeApi, 'getAll', details))
    .map(cookie => mapRuntimeCookie(cookie)).filter(cookie => cookie !== null);
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
    ...(cookie.partitionKey ? { partition_key: {
      top_level_site: cookie.partitionKey.topLevelSite,
      ...(typeof cookie.partitionKey.hasCrossSiteAncestor === 'boolean'
        ? { has_cross_site_ancestor: cookie.partitionKey.hasCrossSiteAncestor } : {}),
    } } : {}),
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
    JSON.stringify(cookie.partition_key ?? null),
  ].join('|');
}

function normalizeUserAgent(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}
