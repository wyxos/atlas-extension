import { getAssetReferrerHref } from './assets.js';
import { shouldConfirmReferrerOpen } from './referrer-state.js';

export function createReferrerOpenGuard({
  confirmOpen,
  getAtlasState,
  getCurrentPageUrl,
  getOpenCounts,
  navigate,
  openInNewTab,
}) {
  async function handleEvent(event) {
    const anchor = resolveAnchor(event);

    if (anchor === null) {
      return false;
    }

    const referrerUrl = anchor.href;
    const reason = shouldConfirmReferrerOpen({
      atlasState: getAtlasState(referrerUrl) ?? {},
      currentPageUrl: getCurrentPageUrl(),
      openCounts: getOpenCounts(),
      referrerUrl,
    });

    if (reason === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();

    const disposition = resolveDisposition(event, anchor);
    const confirmed = await confirmOpen({ disposition, reason, url: referrerUrl });

    if (confirmed !== true) {
      return true;
    }

    if (disposition === 'new-tab') {
      openInNewTab(referrerUrl);
    } else {
      navigate(referrerUrl);
    }

    return true;
  }

  function handleBrowserEvent(event) {
    void handleEvent(event);
  }

  return {
    handleBrowserEvent,
    handleEvent,
  };
}

function resolveAnchor(event) {
  const target = event?.target;
  const anchor = target?.closest?.('a[href]');

  if (isAnchor(anchor)) {
    return anchor;
  }

  const referrerHref = isElement(target) ? getAssetReferrerHref(target) : null;

  return referrerHref === null ? null : { href: referrerHref, target: '' };
}

function resolveDisposition(event, anchor) {
  if (
    event?.button === 1
    || event?.ctrlKey === true
    || event?.metaKey === true
    || event?.shiftKey === true
    || String(anchor?.target ?? '').toLowerCase() === '_blank'
  ) {
    return 'new-tab';
  }

  return 'same-tab';
}

function isAnchor(value) {
  return String(value?.tagName ?? 'A').toUpperCase() === 'A' && typeof value?.href === 'string';
}

function isElement(value) {
  return typeof globalThis.Element === 'function' && value instanceof globalThis.Element;
}
