export function listAssetElements(root, assetSelector) {
  const assets = [];

  collectAssetElements(root, assetSelector, assets, new Set());

  return assets;
}

function collectAssetElements(root, assetSelector, assets, visitedRoots) {
  if (!root || visitedRoots.has(root)) {
    return;
  }

  visitedRoots.add(root);

  if (root?.matches?.(assetSelector)) {
    assets.push(root);
  }

  assets.push(...(root?.querySelectorAll?.(assetSelector) ?? []));
  collectShadowAssets(root, assetSelector, assets, visitedRoots);

  for (const element of root?.querySelectorAll?.('*') ?? []) {
    collectShadowAssets(element, assetSelector, assets, visitedRoots);
  }
}

function collectShadowAssets(element, assetSelector, assets, visitedRoots) {
  if (!element?.shadowRoot) {
    return;
  }

  collectAssetElements(element.shadowRoot, assetSelector, assets, visitedRoots);
}

export function watchAssetReadiness(element, onReady) {
  element.addEventListener('load', onReady, { once: true });
  element.addEventListener('loadedmetadata', onReady, { once: true });
}
