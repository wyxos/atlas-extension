import { createApp, h, reactive } from 'vue';

import AssetOverlay from './AssetOverlay.vue';
import { createOverlayStyles } from './overlay-styles.js';

export function createAssetOverlay(shadowRoot, options = {}) {
  const state = reactive({
    badges: [],
    confirmRequest: null,
    reactionRequest: null,
  });
  const mountElement = document.createElement('div');
  const dialogMountElement = document.createElement('div');
  let pendingConfirmResolve = null;
  let pendingReactionResolve = null;
  const app = createApp({
    name: 'AtlasAssetOverlayRoot',
    setup() {
      return () => h(AssetOverlay, {
        badges: state.badges,
        confirmRequest: state.confirmRequest,
        onBatchToggle: options.onBatchToggle,
        onCloseModeChange: options.onCloseModeChange,
        onDelete: options.onDelete,
        onConfirm: resolveConfirmRequest,
        onReact: options.onReact,
        onReactionConfirm: resolveReactionRequest,
        portalTarget: dialogMountElement,
        reactionRequest: state.reactionRequest,
      });
    },
  });

  mountElement.id = 'atlas-extension-vue-root';
  dialogMountElement.id = 'atlas-extension-dialog-root';
  shadowRoot.append(createOverlayStyles(), mountElement, dialogMountElement);
  app.mount(mountElement);

  function resolveConfirmRequest(confirmed) {
    const resolve = pendingConfirmResolve;

    pendingConfirmResolve = null;
    state.confirmRequest = null;
    resolve?.(confirmed === true);
  }

  function resolveReactionRequest(choice) {
    const resolve = pendingReactionResolve;

    pendingReactionResolve = null;
    state.reactionRequest = null;
    resolve?.(choice === 'redownload' || choice === 'update-only' ? choice : 'cancel');
  }

  return {
    confirmReactionUpdate(request) {
      pendingReactionResolve?.('cancel');
      state.reactionRequest = request;

      return new Promise((resolve) => {
        pendingReactionResolve = resolve;
      });
    },
    confirmReferrerOpen(request) {
      pendingConfirmResolve?.(false);
      state.confirmRequest = request;

      return new Promise((resolve) => {
        pendingConfirmResolve = resolve;
      });
    },
    removeBadge(id) {
      const badgeIndex = state.badges.findIndex((badge) => badge.id === id);

      if (badgeIndex >= 0) {
        state.badges.splice(badgeIndex, 1);
      }
    },
    upsertBadge(id, badge) {
      const existingBadge = state.badges.find((entry) => entry.id === id);

      if (existingBadge === undefined) {
        state.badges.push({ id, ...badge });

        return;
      }

      Object.assign(existingBadge, badge);
    },
  };
}
