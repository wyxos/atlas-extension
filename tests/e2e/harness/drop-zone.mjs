import { startDrag, wait } from './visual.mjs';

// Drop-zone helpers shared by E2E files.
export const dropZone = (page) => page.locator('[data-atlas-drop-zone]');
export const dropToast = (page) => page.locator('[data-atlas-drop-zone-toast]');
export const reactionPicker = (page) => page.locator('[data-atlas-drop-picker]');

// Drags `source` onto the drop zone. `pick` is a reaction type to click in the
// picker, 'dismiss' for the close button, or null to let the timeout apply
// the default. `alt` holds Alt for elements that are not natively draggable.
export async function dropOnZone(atlas, page, source, { pick = 'like', alt = false, pause = 0, prefer, beforeDrop, beforePick } = {}) {
  const reaction = atlas.desktop.nextReaction();
  const drag = await startDrag(page, source, { pause, prefer, alt });
  await drag.moveTo({ x: 760, y: 420 });
  await dropZone(page).waitFor({ state: 'visible', timeout: 5000 });
  await drag.moveTo(dropZone(page));
  await beforeDrop?.();
  await drag.drop();
  await reactionPicker(page).waitFor({ state: 'visible', timeout: 5000 });
  await beforePick?.();
  if (pick === 'dismiss') await reactionPicker(page).getByRole('button', { name: 'Use default reaction' }).click();
  else if (pick) await reactionPicker(page).locator(`button[data-reaction="${pick}"]`).click();
  const { body, data } = await reaction;
  await wait(page, pause);
  return { body, data };
}
