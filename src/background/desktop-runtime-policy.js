import { createDesktopContractError } from '../shared/desktop-contract.js';
import { applySettingsBundle } from '../shared/settings-bundle.js';
import {
  loadDesktopConnectionState,
  patchDesktopConnectionState,
} from './desktop-connection-state.js';

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
