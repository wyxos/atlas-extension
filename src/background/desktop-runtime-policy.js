import { createDesktopContractError } from '../shared/desktop-contract.js';
import { applySettingsBundle } from '../shared/settings-bundle.js';
import {
  loadDesktopConnectionState,
  patchDesktopConnectionState,
} from './desktop-connection-state.js';
import { saveCloseTabModeForSiteDomain } from '../shared/close-tab-preferences.js';

export async function syncDesktopRuntimePolicy({
  credentials,
  storage = globalThis.chrome?.storage?.local,
  transport,
}) {
  const data = await transport.runtimePolicy(credentials);
  const revision = normalizeRevision(data?.revision);
  const state = await loadDesktopConnectionState(storage);

  if (
    Number.isInteger(state.runtimePolicyRevision)
    && revision < state.runtimePolicyRevision
  ) {
    throw createDesktopContractError(
      'STALE_RUNTIME_POLICY',
      'Atlas Desktop returned an older runtime policy.',
      true,
      { current_revision: state.runtimePolicyRevision, received_revision: revision },
    );
  }

  await applySettingsBundle(data?.settings, { storage });
  await patchDesktopConnectionState({ runtimePolicyRevision: revision }, storage);

  return {
    revision,
    settings: data.settings,
  };
}

export async function updateDesktopCloseTabMode({
  credentials,
  mode,
  siteDomain,
  storage = globalThis.chrome?.storage?.local,
  transport,
}) {
  let state = await loadDesktopConnectionState(storage);

  if (!Number.isInteger(state.runtimePolicyRevision)) {
    await syncDesktopRuntimePolicy({ credentials, storage, transport });
    state = await loadDesktopConnectionState(storage);
  }

  let result;
  try {
    result = await transport.updateCloseTabMode(credentials, {
      expected_revision: state.runtimePolicyRevision,
      mode,
      site_domain: siteDomain,
    });
  } catch (error) {
    if (error?.code !== 'POLICY_REVISION_CONFLICT') {
      throw error;
    }

    await syncDesktopRuntimePolicy({ credentials, storage, transport });
    state = await loadDesktopConnectionState(storage);
    result = await transport.updateCloseTabMode(credentials, {
      expected_revision: state.runtimePolicyRevision,
      mode,
      site_domain: siteDomain,
    });
  }

  const revision = normalizeRevision(result?.revision);
  await saveCloseTabModeForSiteDomain(siteDomain, result?.mode, storage);
  await patchDesktopConnectionState({ runtimePolicyRevision: revision }, storage);

  return {
    mode: result.mode,
    revision,
    siteDomain: result.site_domain,
  };
}

function normalizeRevision(value) {
  const revision = Number(value);

  if (!Number.isInteger(revision) || revision < 0) {
    throw createDesktopContractError(
      'INVALID_RUNTIME_POLICY',
      'Atlas Desktop returned an invalid runtime policy revision.',
      true,
    );
  }

  return revision;
}
