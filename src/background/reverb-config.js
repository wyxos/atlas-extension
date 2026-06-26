import { normalizeDomain } from '../options/connection.js';

export async function resolveReverbConnectionConfig(config, options = {}) {
  if (!config || typeof config !== 'object') {
    return null;
  }

  if (hasUsableReverbConfig(config)) {
    return config;
  }

  const domain = normalizeDomain(config.domain);
  const apiKey = String(config.apiKey ?? '').trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (domain === null || apiKey === '' || typeof fetchImpl !== 'function') {
    return config;
  }

  try {
    const response = await fetchImpl(`${domain}/api/extension/ping`, {
      headers: {
        Accept: 'application/json',
        'X-Atlas-Api-Key': apiKey,
      },
      method: 'GET',
    });
    const payload = await readJson(response);

    if (!response.ok || payload?.ok !== true || !payload?.reverb) {
      return {
        ...config,
        domain,
      };
    }

    return {
      ...config,
      domain,
      reverb: payload.reverb,
    };
  } catch {
    return {
      ...config,
      domain,
    };
  }
}

function hasUsableReverbConfig(config) {
  const reverb = config.reverb;

  return Boolean(reverb?.enabled && reverb.channel && reverb.host && reverb.key);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
