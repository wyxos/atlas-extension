// Player controls and transparent overlays are often siblings of the media,
// so their event paths never include the registered image/video/audio element.
export function findAssetShortcutFallback(event, { assetIds, isAssetVisible }) {
  if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) {
    return null;
  }

  const candidates = [];
  for (const [element, id] of assetIds) {
    if (!element?.isConnected || !pointInRect(event, element.getBoundingClientRect?.())) {
      continue;
    }
    if (!isAssetVisible(element)) {
      continue;
    }
    candidates.push({ element, id });
  }

  // Prefer the closest shared container. Never guess using the entire page,
  // blank space near a widget, or two overlapping media in the same container.
  for (const container of eventContainers(event)) {
    const matches = candidates.filter(({ element }) => containsMedia(container, element));
    if (matches.length > 0) {
      return matches.length === 1 ? matches[0].id : null;
    }
  }
  return null;
}

function pointInRect(event, rect) {
  return rect?.width > 0 && rect?.height > 0
    && event.clientX >= rect.left && event.clientX < rect.right
    && event.clientY >= rect.top && event.clientY < rect.bottom;
}

function* eventContainers(event) {
  const path = event.composedPath?.();
  const targets = Array.isArray(path) && path.length > 0 ? path : [event.target];
  const seen = new Set();
  for (const target of targets) {
    for (let container = target; container; container = composedParent(container)) {
      if (container.nodeType === 9 || ['BODY', 'HTML'].includes(container.tagName)) break;
      if (seen.has(container)) break;
      seen.add(container);
      yield container;
    }
  }
}

function containsMedia(container, element) {
  for (let current = element; current; current = composedParent(current)) {
    if (current === container) return true;
  }
  return false;
}

function composedParent(element) {
  return element.assignedSlot ?? element.parentNode ?? element.getRootNode?.()?.host ?? null;
}
