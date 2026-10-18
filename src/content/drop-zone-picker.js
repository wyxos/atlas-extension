import { createApp, h, reactive } from 'vue';

import DropReactionPicker from './DropReactionPicker.vue';
import { dropZoneReactionType } from './drop-zone-model.js';
import { reactionOptions } from './reaction-options.js';
import { resolveCurrentReaction } from './reaction-download-action.js';

export const dropReactionTimeoutMs = 4000;
const labels = Object.fromEntries(reactionOptions.map(option => [option.type, option.label]));

// Post-drop reaction choice. Resolves with the picked type, or null when the
// timeout passes or the picker is dismissed (the caller then applies the
// default: the existing reaction, else Like).
export function createDropReactionPicker({ root, documentContext, windowContext, timeoutMs = dropReactionTimeoutMs }) {
  const picker = reactive({ visible: false, label: '', hint: '', defaultReaction: dropZoneReactionType, timeoutMs, token: 0 });
  let pending = null;
  const container = documentContext.createElement('div');
  root.append(container);
  createApp({
    render: () => h(DropReactionPicker, { picker, onPick: type => settle(type), onDismiss: () => settle(null) }),
  }).mount(container);

  function choose({ item, statePromise }) {
    settle(null);
    Object.assign(picker, { visible: true, label: item.label, defaultReaction: dropZoneReactionType,
      hint: `Saves as ${labels[dropZoneReactionType]} in ${Math.round(timeoutMs / 1000)}s`, token: picker.token + 1 });
    return new Promise(resolve => {
      const entry = { resolve, timer: windowContext.setTimeout(() => settle(null), timeoutMs) };
      pending = entry;
      void statePromise.then(state => {
        if (pending !== entry) return;
        const current = resolveCurrentReaction(state ?? {});
        if (current === 'blacklist') {
          Object.assign(picker, { defaultReaction: 'blacklist', hint: 'Blacklisted in Atlas · pick a reaction to download anyway' });
        } else if (current) {
          Object.assign(picker, { defaultReaction: current, hint: `Already ${labels[current] ?? current} in Atlas · kept unless you pick another` });
        }
      });
    });
  }

  function settle(value) {
    if (!pending) return;
    const { resolve, timer } = pending;
    pending = null;
    windowContext.clearTimeout(timer);
    picker.visible = false;
    resolve(value);
  }

  return { choose, dismiss: () => settle(null), isOpen: () => pending !== null };
}
