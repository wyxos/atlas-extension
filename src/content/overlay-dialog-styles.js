export function getOverlayDialogStyles() {
  return `
    dialog[data-atlas-extension-dialog-root] {
      background: transparent;
      border: 0;
      box-sizing: border-box;
      height: 100dvh;
      width: 100vw;
      max-height: none;
      max-width: none;
      margin: 0;
      padding: 0;
      inset: 0;
      position: fixed;
      pointer-events: none;
    }
    dialog[data-atlas-extension-dialog-root]::backdrop { background: transparent; }

    [data-slot="alert-dialog-overlay"] {
      backdrop-filter: blur(3px);
      background: rgba(0, 0, 0, 0.52);
      inset: 0;
      pointer-events: auto;
      position: fixed;
      z-index: 2147483646;
    }

    [data-slot="alert-dialog-content"] {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: #f9fafb;
      display: grid;
      font: 500 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 14px;
      left: 50%;
      max-width: calc(100vw - 32px);
      max-height: calc(100dvh - 32px);
      overflow: auto;
      padding: 18px;
      pointer-events: auto;
      position: fixed;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(420px, calc(100vw - 32px));
      z-index: 2147483647;
    }

    [data-slot="alert-dialog-header"] {
      display: grid;
      gap: 6px;
    }

    [data-slot="alert-dialog-title"] {
      color: #f9fafb;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.25;
      margin: 0;
    }

    [data-slot="alert-dialog-description"] {
      color: #d1d5db;
      font-size: 13px;
      line-height: 1.45;
      margin: 0;
    }

    .atlas-referrer-open-url {
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      color: #93c5fd;
      font-size: 12px;
      overflow: hidden;
      padding: 9px 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-slot="alert-dialog-footer"] {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    [data-slot="alert-dialog-action"],
    [data-slot="alert-dialog-cancel"] {
      appearance: none;
      border: 0;
      border-radius: 4px;
      cursor: pointer;
      font: 700 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 34px;
      padding: 0 12px;
    }

    [data-slot="alert-dialog-action"] {
      background: #0466c8;
      color: #fff;
    }

    [data-slot="alert-dialog-cancel"] {
      background: rgba(255, 255, 255, 0.12);
      color: #f9fafb;
    }

    [data-slot="alert-dialog-action"]:hover,
    [data-slot="alert-dialog-action"]:focus-visible {
      background: #0f85fa;
      outline: none;
    }

    [data-slot="alert-dialog-cancel"]:hover,
    [data-slot="alert-dialog-cancel"]:focus-visible {
      background: rgba(255, 255, 255, 0.2);
      outline: none;
    }
  `;
}
