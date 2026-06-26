const suppressedShortcutTargetSelector = [
  'a',
  'button',
  'input',
  'select',
  'summary',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[data-atlas-asset-badge="true"]',
  '[role="button"]',
  '[role="slider"]',
].join(',');

export function reactionFromAssetShortcutEvent(event) {
  if (!event?.altKey) {
    return null;
  }

  if (event.type === 'click' && event.button === 0) {
    return 'love';
  }

  if (event.type === 'mousedown' && event.button === 1) {
    return 'like';
  }

  if (event.type === 'contextmenu') {
    return 'blacklist';
  }

  return null;
}

export function handleAssetShortcutEvent(event, options) {
  const type = reactionFromAssetShortcutEvent(event);

  if (type === null || hasSuppressedShortcutTarget(event)) {
    return false;
  }

  const id = registeredAssetIdFromEvent(event, options?.getAssetIdForElement);

  if (id === null) {
    return false;
  }

  event.preventDefault?.();
  event.stopPropagation?.();
  options?.onReact?.({ id, type });

  return true;
}

function registeredAssetIdFromEvent(event, getAssetIdForElement) {
  if (typeof getAssetIdForElement !== 'function') {
    return null;
  }

  for (const target of eventPath(event)) {
    const id = getAssetIdForElement(target);

    if (typeof id === 'string' && id !== '') {
      return id;
    }
  }

  return null;
}

function hasSuppressedShortcutTarget(event) {
  return eventPath(event).some((target) => (
    Boolean(target?.closest?.(suppressedShortcutTargetSelector))
  ));
}

function eventPath(event) {
  const path = event?.composedPath?.();

  if (Array.isArray(path) && path.length > 0) {
    return path;
  }

  return event?.target === undefined || event.target === null ? [] : [event.target];
}
