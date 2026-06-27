import { createOverlayStyles } from './overlay-styles.js';

const assetBadgeMaxWidth = 300;
const assetBadgeMinWidth = 180;
const badgeHostAttribute = 'data-atlas-extension-badge-host';
const compactBadgeHeight = 50;
const compactBadgeWidth = 40;
const maximumAncestorDepth = 5;
const videoControlOffset = 48;

export function createBadgeHostManager({
  documentContext = document,
  getComputedStyle = globalThis.getComputedStyle?.bind(globalThis),
} = {}) {
  const hostsById = new Map();
  const retainedOwners = new WeakMap();

  function placeBadge(id, element, asset = {}, options = {}) {
    const owner = resolveBadgeContainer(element, { getComputedStyle });

    if (owner === null) {
      remove(id);

      return null;
    }

    const host = ensureHost(id, owner);
    const placement = createPlacementStyles({
      asset,
      element,
      owner,
      variant: options.variant,
      viewportPadding: options.viewportPadding ?? 0,
    });

    if (placement === null) {
      remove(id);

      return null;
    }

    Object.assign(host.host.style, placement.hostStyle);

    return {
      badgeStyle: placement.badgeStyle,
      hostStyle: placement.hostStyle,
      portalTarget: host.portalTarget,
    };
  }

  function ensureHost(id, owner) {
    const existingHost = hostsById.get(id);

    if (existingHost !== undefined) {
      if (existingHost.owner !== owner) {
        releaseOwner(existingHost.owner);
        retainOwner(owner);
        owner.append(existingHost.host);
        existingHost.owner = owner;
      }

      return existingHost;
    }

    const host = documentContext.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const portalTarget = documentContext.createElement('div');

    host.setAttribute(badgeHostAttribute, 'true');
    shadowRoot.append(createOverlayStyles(documentContext), portalTarget);
    owner.append(host);
    retainOwner(owner);

    const hostEntry = {
      host,
      owner,
      portalTarget,
    };

    hostsById.set(id, hostEntry);

    return hostEntry;
  }

  function remove(id) {
    const existingHost = hostsById.get(id);

    if (existingHost === undefined) {
      return;
    }

    existingHost.host.remove();
    releaseOwner(existingHost.owner);
    hostsById.delete(id);
  }

  function retainOwner(owner) {
    const current = retainedOwners.get(owner);

    if (current !== undefined) {
      current.count += 1;

      return;
    }

    retainedOwners.set(owner, {
      count: 1,
      originalPosition: owner.style?.position ?? '',
    });

    if (stylePositionFor(owner, getComputedStyle) === 'static' && owner.style) {
      owner.style.position = 'relative';
    }
  }

  function releaseOwner(owner) {
    const current = retainedOwners.get(owner);

    if (current === undefined) {
      return;
    }

    current.count -= 1;

    if (current.count > 0) {
      return;
    }

    if (owner.style && owner.style.position === 'relative') {
      owner.style.position = current.originalPosition;
    }
    retainedOwners.delete(owner);
  }

  return {
    placeBadge,
    remove,
  };
}

export function resolveBadgeContainer(element, {
  getComputedStyle = globalThis.getComputedStyle?.bind(globalThis),
} = {}) {
  const directParent = normalizeContainerCandidate(element?.parentElement);

  if (isVisualContainer(directParent, element, { direct: true, getComputedStyle })) {
    return directParent;
  }

  let candidate = normalizeContainerCandidate(directParent?.parentElement);
  let depth = 0;

  while (candidate !== null && depth < maximumAncestorDepth) {
    if (isVisualContainer(candidate, element, { direct: false, getComputedStyle })) {
      return candidate;
    }

    candidate = normalizeContainerCandidate(candidate.parentElement);
    depth += 1;
  }

  return isUsableContainer(directParent) ? directParent : null;
}

function createPlacementStyles({
  asset,
  element,
  owner,
  variant,
  viewportPadding,
}) {
  const mediaRect = rectFor(element);
  const ownerRect = rectFor(owner);

  if (!hasUsableArea(mediaRect) || !hasUsableArea(ownerRect)) {
    return null;
  }

  const relativeLeft = mediaRect.left - ownerRect.left + Number(owner.scrollLeft ?? 0);
  const relativeTop = mediaRect.top - ownerRect.top + Number(owner.scrollTop ?? 0);
  const top = relativeTop + mediaRect.height - viewportPadding - badgeOffsetForAsset(asset);

  if (variant === 'referrer') {
    return {
      badgeStyle: {
        display: 'flex',
        height: `${compactBadgeHeight}px`,
        maxWidth: `${compactBadgeWidth}px`,
        position: 'static',
        transform: 'none',
        width: `${compactBadgeWidth}px`,
      },
      hostStyle: baseHostStyle({
        left: relativeLeft + mediaRect.width - viewportPadding,
        top,
        transform: 'translate(-100%, -100%)',
        width: compactBadgeWidth,
      }),
    };
  }

  const width = Math.min(
    assetBadgeMaxWidth,
    Math.max(assetBadgeMinWidth, mediaRect.width - (viewportPadding * 2)),
  );

  return {
    badgeStyle: {
      display: 'flex',
      maxWidth: '100%',
      position: 'static',
      transform: 'none',
      width: '100%',
    },
    hostStyle: baseHostStyle({
      left: relativeLeft + (mediaRect.width / 2),
      top,
      transform: 'translate(-50%, -100%)',
      width,
    }),
  };
}

function baseHostStyle({
  left,
  top,
  transform,
  width,
}) {
  return {
    display: 'block',
    left: `${Math.round(left)}px`,
    pointerEvents: 'none',
    position: 'absolute',
    top: `${Math.round(top)}px`,
    transform,
    width: `${Math.round(width)}px`,
    zIndex: '2147483647',
  };
}

function isVisualContainer(candidate, element, {
  direct,
  getComputedStyle,
}) {
  if (!isUsableContainer(candidate)) {
    return false;
  }

  const candidateRect = rectFor(candidate);
  const elementRect = rectFor(element);

  if (!containsRect(candidateRect, elementRect)) {
    return false;
  }

  if (direct) {
    return isReasonableWrapperSize(candidateRect, elementRect, 2.5);
  }

  return isReasonableWrapperSize(candidateRect, elementRect, 3.5)
    && hasVisualContainerCue(candidate, getComputedStyle);
}

function hasVisualContainerCue(element, getComputedStyle) {
  const style = getComputedStyle?.(element) ?? {};

  return ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflow)
    || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
    || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
    || hasNonZeroLength(style.borderRadius)
    || hasNonZeroLength(style.borderTopLeftRadius)
    || style.position !== 'static';
}

function normalizeContainerCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  if (['PICTURE', 'SOURCE'].includes(String(candidate.tagName ?? '').toUpperCase())) {
    return normalizeContainerCandidate(candidate.parentElement);
  }

  return candidate;
}

function isUsableContainer(candidate) {
  return Boolean(
    candidate?.append
      && candidate?.style
      && !['BODY', 'HTML', 'HEAD', 'SCRIPT', 'STYLE'].includes(String(candidate.tagName ?? '').toUpperCase()),
  );
}

function containsRect(containerRect, childRect) {
  const tolerance = 2;

  return hasUsableArea(containerRect)
    && hasUsableArea(childRect)
    && childRect.left >= containerRect.left - tolerance
    && childRect.right <= containerRect.right + tolerance
    && childRect.top >= containerRect.top - tolerance
    && childRect.bottom <= containerRect.bottom + tolerance;
}

function isReasonableWrapperSize(containerRect, childRect, multiplier) {
  return containerRect.width <= (childRect.width * multiplier) + 160
    && containerRect.height <= (childRect.height * multiplier) + 220;
}

function rectFor(element) {
  return element?.getBoundingClientRect?.() ?? null;
}

function hasUsableArea(rect) {
  return Number(rect?.width) > 0 && Number(rect?.height) > 0;
}

function stylePositionFor(element, getComputedStyle) {
  return getComputedStyle?.(element)?.position || element?.style?.position || 'static';
}

function hasNonZeroLength(value) {
  return typeof value === 'string' && value !== '' && value !== '0px' && value !== '0';
}

function badgeOffsetForAsset(asset) {
  return asset?.type === 'video' ? videoControlOffset : 0;
}
