// Visible pointer for recorded videos. Headless Chromium paints no cursor,
// and during a native drag only drag events report the pointer position.
export const visualCursorScript = `(() => {
  if (window !== window.top || window.__atlasE2ECursor) return;
  window.__atlasE2ECursor = true;
  const install = () => {
    const cursor = document.createElement('div');
    cursor.setAttribute('data-atlas-e2e-cursor', 'true');
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;'
      + 'background:rgba(239,68,68,.85);border:2px solid #fff;box-shadow:0 0 0 2px rgba(239,68,68,.45),0 2px 6px rgba(0,0,0,.4);'
      + 'pointer-events:none;z-index:2147483647;transition:transform 80ms ease;transform:translate(-100px,-100px)';
    document.documentElement.append(cursor);
    const move = (event) => { cursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)'; };
    for (const type of ['mousemove', 'dragover', 'drag', 'dragenter']) window.addEventListener(type, move, { capture: true, passive: true });
    window.addEventListener('mousedown', () => { cursor.style.background = 'rgba(15,133,250,.9)'; }, true);
    for (const type of ['mouseup', 'dragend', 'drop']) window.addEventListener(type, () => { cursor.style.background = 'rgba(239,68,68,.85)'; }, true);
  };
  document.documentElement ? install() : document.addEventListener('DOMContentLoaded', install);
})();`;

// Native HTML5 drag through Playwright's Chromium drag interception: press on
// the source, move in steps (the page sees real dragstart/dragover events),
// then call drop() or cancel(). Pauses keep recorded videos watchable.
export async function startDrag(page, source, { pause = 0 } = {}) {
  const start = await exposedPoint(source);
  await page.mouse.move(start.x, start.y, { steps: 8 });
  await wait(page, pause);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 12, { steps: 6 });
  return {
    async moveTo(target, { steps = 20 } = {}) {
      const point = typeof target?.boundingBox === 'function' ? center(await target.boundingBox()) : target;
      await page.mouse.move(point.x, point.y, { steps });
      await wait(page, pause);
    },
    drop: async () => { await page.mouse.up(); await wait(page, pause); },
  };
}

export function wait(page, ms) {
  return ms > 0 ? page.waitForTimeout(ms) : Promise.resolve();
}

function center(box) {
  if (!box) throw new Error('Drag target is not visible.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Atlas's own asset badge can cover the middle of an image, so pick the
// first point (bottom-up) where the source element itself is hit-tested.
export async function exposedPoint(locator) {
  const point = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let fy = 0.85; fy >= 0.15; fy -= 0.1) {
      for (let fx = 0.2; fx <= 0.8; fx += 0.15) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit === element || element.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error('Drag source is covered or not visible.');
  return point;
}
