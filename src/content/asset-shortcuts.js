const interactiveShortcutTargetSelector = [
  'a',
  'button',
  'input',
  'select',
  'summary',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="slider"]',
].join(',');
const suppressedShortcutTargetSelector = [
  interactiveShortcutTargetSelector,
  '[data-atlas-asset-badge="true"]',
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

export function reactionFromBadgeShortcutEvent(event) {
  const type = reactionFromAssetShortcutEvent(event);

  if (type === null || hasShortcutTarget(event, interactiveShortcutTargetSelector)) {
    return null;
  }

  return type;
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
  return hasShortcutTarget(event, suppressedShortcutTargetSelector);
}

function hasShortcutTarget(event, selector) {
  return eventPath(event).some((target) => Boolean(target?.closest?.(selector)));
}

function eventPath(event) {
  const path = event?.composedPath?.();

  if (Array.isArray(path) && path.length > 0) {
    return path;
  }

  return event?.target === undefined || event.target === null ? [] : [event.target];
}
