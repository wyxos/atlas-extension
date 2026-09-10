export function getOverlayNoticeStyles() {
  return `
    .atlas-operation-error {
      position: fixed;
      bottom: max(12px, env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%);
      width: min(560px, calc(100% - 24px));
      max-height: calc(100vh - 24px);
      max-height: calc(100dvh - 24px);
      overflow: auto;
      box-sizing: border-box;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      border-radius: 4px;
      background: #111827;
      color: #f9fafb;
      border: 1px solid #991b1b;
      font: 500 13px/1.5 system-ui, sans-serif;
      pointer-events: auto;
      z-index: 2147483647;
    }
    .atlas-operation-error span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .atlas-operation-error button {
      flex: 0 0 auto;
      background: transparent;
      color: inherit;
      border: 1px solid currentColor;
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font: inherit;
    }
    .atlas-static-close-error {
      background: rgba(127, 29, 29, 0.94);
      bottom: 15px;
      box-sizing: border-box;
      color: #fee2e2;
      font-size: 10px;
      font-weight: 600;
      left: 0;
      margin: 0;
      max-width: 100%;
      padding: 4px 6px;
      pointer-events: auto;
      position: absolute;
      right: 0;
    }

    .atlas-static-close-mode-unavailable {
      color: #fbbf24;
      font-size: 10px;
      line-height: 1.3;
    }
  `;
}
