const defaultMinVisibleHeight = 24;
const defaultMinVisibleWidth = 200;

export function resolveVisibleRect(element, viewportPadding, options = {}) {
  if (!element?.getBoundingClientRect) {
    return null;
  }

  const {
    documentRef = document,
    minVisibleHeight = defaultMinVisibleHeight,
    minVisibleWidth = defaultMinVisibleWidth,
    windowRef = window,
  } = options;
  const rect = element.getBoundingClientRect();
  const viewportWidth = windowRef.innerWidth || documentRef.documentElement.clientWidth;
  const viewportHeight = windowRef.innerHeight || documentRef.documentElement.clientHeight;
  const left = clamp(rect.left, viewportPadding, viewportWidth - viewportPadding);
  const right = clamp(rect.right, viewportPadding, viewportWidth - viewportPadding);
  const top = clamp(rect.top, viewportPadding, viewportHeight - viewportPadding);
  const bottom = clamp(rect.bottom, viewportPadding, viewportHeight - viewportPadding);
  const width = right - left;
  const height = bottom - top;

  if (rect.width < minVisibleWidth || rect.height < minVisibleHeight) {
    return null;
  }

  if (width < minVisibleWidth || height < minVisibleHeight) {
    return null;
  }

  return {
    bottom,
    left,
    width,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
