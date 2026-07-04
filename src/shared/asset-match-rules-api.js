import {
  loadConnectionConfig,
  normalizeDomain,
} from '../options/connection.js';
import { assetMatchRuleDigest } from './asset-match-identity.js';

export async function applyAssetMatchRule({
  domain,
  fetchImpl = globalThis.fetch,
  matching,
  storage = getExtensionStorage(),
} = {}) {
  const rule = buildAssetMatchRulePayload({ domain, matching });

  return atlasAssetMatchRuleRequest({
    body: { rule },
    fetchImpl,
    method: 'POST',
    path: '/asset-match-rules/apply',
    storage,
  });
}

export function buildAssetMatchRulePayload({ domain, matching }) {
  return {
    cleanup: matching?.cleanup ?? {},
    domain,
    match_by: matching?.matchBy ?? 'source',
    rule_digest: assetMatchRuleDigest({
      matching,
      siteDomain: domain,
    }),
    ...(matching?.ruleId ? { rule_id: matching.ruleId } : {}),
  };
}

async function atlasAssetMatchRuleRequest({
  body,
  fetchImpl,
  method,
  path,
  storage,
}) {
  const config = await loadConnectionConfig(storage);
  const domain = normalizeDomain(config?.domain);
  const apiKey = String(config?.apiKey ?? '').trim();

  if (domain === null || apiKey === '' || typeof fetchImpl !== 'function') {
    throw new Error('Atlas extension connection is not configured.');
  }

  const response = await fetchImpl(`${domain}/api/extension${path}`, {
    body: JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Atlas-Api-Key': apiKey,
    },
    method,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Atlas asset match rule request failed.');
  }

  return payload ?? {};
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getExtensionStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}
