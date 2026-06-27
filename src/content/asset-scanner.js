export function listAssetElements(root, assetSelector) {
  const assets = [];

  if (root?.matches?.(assetSelector)) {
    assets.push(root);
  }

  assets.push(...(root?.querySelectorAll?.(assetSelector) ?? []));

  return assets;
}

export function watchAssetReadiness(element, onReady) {
  element.addEventListener('load', onReady, { once: true });
  element.addEventListener('loadedmetadata', onReady, { once: true });
}
