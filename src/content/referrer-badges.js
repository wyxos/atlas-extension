import { describeReferrerAssetElement } from './assets.js';
import { createReferrerBadgePresentation } from './badge-model.js';
import { resolveReferrerBadgeState } from './referrer-state.js';

export function createReferrerBadgeManager({
  getCurrentPageUrl = () => globalThis.location?.href ?? '',
  getOverlayController,
  getVisibleRect,
  queueStatusCheck,
  removeDirectBadge,
  removeOverlayBadge,
  viewportPadding,
}) {
  const assetIds = new Map();
  const assetsById = new Map();
  const elementsById = new Map();
  const renderedIds = new Set();
  const statesById = new Map();
  const originalOpacityByElement = new WeakMap();
  let nextAssetId = 0;
  let openCounts = {};

  function sync(element) {
    const asset = describeReferrerAssetElement(element);

    if (asset === null || !element?.isConnected) {
      remove(element);

      return false;
    }

    removeDirectBadge(element);

    const id = getAssetId(element);
    const nextState = stateForSyncedAsset(assetsById.get(id), asset, statesById.get(id));

    assetsById.set(id, asset);
    if (nextState === null) {
      statesById.delete(id);
    } else {
      statesById.set(id, nextState);
    }

    render(id, nextState ?? {});
    queueStatusCheck(asset.referrerUrl);

    return getVisibleRect(element) !== null;
  }

  function remove(element) {
    const id = assetIds.get(element);

    if (id === undefined) {
      restoreOpacity(element);

      return;
    }

    if (renderedIds.has(id)) {
      removeOverlayBadge(id);
      renderedIds.delete(id);
    }

    assetIds.delete(element);
    assetsById.delete(id);
    elementsById.delete(id);
    statesById.delete(id);
    restoreOpacity(element);
  }

  function positionKnown() {
    for (const element of assetIds.keys()) {
      if (!element.isConnected || describeReferrerAssetElement(element) === null) {
        remove(element);

        continue;
      }

      sync(element);
    }
  }

  function updateByReferrerUrl(referrerUrl, nextState) {
    for (const [id, asset] of assetsById.entries()) {
      if (asset.referrerUrl === referrerUrl) {
        update(id, nextState);
      }
    }
  }

  function replaceByReferrerUrl(referrerUrl, nextState) {
    for (const [id, asset] of assetsById.entries()) {
      if (asset.referrerUrl === referrerUrl) {
        render(id, nextState);
      }
    }
  }

  function updateByDownloadEvent(payload) {
    const assetUrl = typeof payload?.assetUrl === 'string' ? payload.assetUrl : null;
    const referrerUrl = typeof payload?.referrerUrl === 'string' ? payload.referrerUrl : null;
    const fileId = Number(payload?.file?.id ?? payload?.download?.file_id);

    for (const [id, asset] of assetsById.entries()) {
      const currentFileId = resolveStateFileId(statesById.get(id) ?? {});
      const matchesFile = Number.isInteger(fileId) && fileId > 0 && currentFileId === fileId;
      const matchesReferrer = referrerUrl !== null && asset.referrerUrl === referrerUrl;
      const matchesSource = assetUrl !== null && asset.source === assetUrl;

      if (matchesFile || matchesReferrer || matchesSource) {
        update(id, withoutUndefinedValues({
          download: payload.download,
          file: payload.file,
          reaction: payload.reaction,
        }));
      }
    }
  }

  function getAssetId(element) {
    const existingId = assetIds.get(element);

    if (existingId !== undefined) {
      return existingId;
    }

    const id = `referrer-asset-${nextAssetId}`;

    nextAssetId += 1;
    assetIds.set(element, id);
    elementsById.set(id, element);

    return id;
  }

  function update(id, nextState) {
    render(id, {
      ...(statesById.get(id) ?? {}),
      ...nextState,
    });
  }

  function render(id, nextState) {
    const element = elementsById.get(id);
    const asset = assetsById.get(id);

    if (element === undefined || asset === undefined) {
      return;
    }

    statesById.set(id, nextState);

    const displayState = resolveDisplayState(asset, nextState);

    if (displayState === null) {
      if (renderedIds.has(id)) {
        removeOverlayBadge(id);
        renderedIds.delete(id);
      }

      restoreOpacity(element);

      return;
    }

    dim(element);
    getOverlayController().upsertBadge(
      id,
      createReferrerBadgePresentation(
        asset,
        getVisibleRect(element),
        viewportPadding,
        displayState,
      ),
    );
    renderedIds.add(id);
  }

  function resolveDisplayState(asset, atlasState) {
    return resolveReferrerBadgeState({
      atlasState,
      currentPageUrl: getCurrentPageUrl(),
      openCounts,
      referrerUrl: asset.referrerUrl,
    });
  }

  function updateOpenCounts(nextOpenCounts) {
    openCounts = nextOpenCounts && typeof nextOpenCounts === 'object' ? nextOpenCounts : {};

    for (const id of assetsById.keys()) {
      render(id, statesById.get(id) ?? {});
    }
  }

  function getAtlasStateByReferrerUrl(referrerUrl) {
    for (const [id, asset] of assetsById.entries()) {
      if (asset.referrerUrl === referrerUrl) {
        return statesById.get(id) ?? {};
      }
    }

    return {};
  }

  function dim(element) {
    if (!originalOpacityByElement.has(element)) {
      originalOpacityByElement.set(element, element.style?.opacity ?? '');
    }

    if (element?.style) {
      element.style.opacity = '0.3';
    }
  }

  function restoreOpacity(element) {
    if (!originalOpacityByElement.has(element) || !element?.style) {
      return;
    }

    element.style.opacity = originalOpacityByElement.get(element);
    originalOpacityByElement.delete(element);
  }

  return {
    positionKnown,
    getAtlasStateByReferrerUrl,
    remove,
    replaceByReferrerUrl,
    sync,
    updateByDownloadEvent,
    updateByReferrerUrl,
    updateOpenCounts,
  };
}

function withoutUndefinedValues(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function stateForSyncedAsset(previousAsset, nextAsset, currentState) {
  if (
    !previousAsset
    || (previousAsset.source === nextAsset.source && previousAsset.referrerUrl === nextAsset.referrerUrl)
  ) {
    return currentState ?? null;
  }

  return null;
}

function resolveStateFileId(state) {
  const id = Number(state.file?.id ?? state.download?.file_id ?? state.download?.fileId);

  return Number.isInteger(id) && id > 0 ? id : null;
}
