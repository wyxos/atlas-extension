const badgeAttribute = 'data-atlas-asset-badge';

export function createOverlayStyles(documentContext = document) {
  const style = documentContext.createElement('style');

  style.textContent = getOverlayStyles();

  return style;
}

export function getOverlayStyles() {
  return `
    [${badgeAttribute}] {
      align-items: center;
      backdrop-filter: blur(4px);
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      box-sizing: border-box;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
      color: #fff;
      flex-direction: column;
      font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 4px;
      justify-content: center;
      min-height: 74px;
      overflow: hidden;
      padding: 6px 8px 17px;
      pointer-events: none;
      position: fixed;
      transform: translate(-50%, -100%);
      width: 300px;
      z-index: 2147483647;
    }

    .atlas-static-meta {
      align-items: center;
      display: flex;
      font-size: 11px;
      gap: 6px;
      justify-content: space-between;
      line-height: 1.2;
      overflow: hidden;
      white-space: nowrap;
      width: 100%;
    }

    .atlas-static-meta span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .atlas-static-timestamp {
      flex-shrink: 0;
      font-size: 10px;
      opacity: 0.92;
    }

    .atlas-static-asset-kind {
      align-items: center;
      display: inline-flex;
      gap: 4px;
      min-width: 0;
    }

    .atlas-static-asset-kind svg {
      flex: 0 0 auto;
    }

    .atlas-static-batch {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      flex-shrink: 0;
      font-size: 10px;
      gap: 4px;
      pointer-events: auto;
    }

    .atlas-static-batch input {
      accent-color: #14b8a6;
      height: 12px;
      margin: 0;
      width: 12px;
    }

    .atlas-static-batch input:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    .atlas-static-icons {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: center;
      width: 100%;
    }

    .atlas-static-icon {
      align-items: center;
      appearance: none;
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      justify-content: center;
      padding: 4px;
      pointer-events: auto;
    }

    .atlas-static-icon:hover,
    .atlas-static-icon:focus-visible {
      background: rgba(255, 255, 255, 0.18);
      outline: none;
    }

    .atlas-static-icon-love:hover:not(:disabled),
    .atlas-static-icon-love:focus-visible {
      color: #f87171;
    }

    .atlas-static-icon-like:hover:not(:disabled),
    .atlas-static-icon-like:focus-visible {
      color: #0f85fa;
    }

    .atlas-static-icon-blacklist:hover:not(:disabled),
    .atlas-static-icon-blacklist:focus-visible {
      color: #d32f2f;
    }

    .atlas-static-icon-funny:hover:not(:disabled),
    .atlas-static-icon-funny:focus-visible {
      color: #facc15;
    }

    .atlas-static-icon-love.atlas-static-icon-active {
      background: #ef4444;
      color: #fff;
    }

    .atlas-static-icon-like.atlas-static-icon-active {
      background: #0466c8;
      color: #fff;
    }

    .atlas-static-icon-blacklist.atlas-static-icon-active {
      background: #8d0a0c;
      color: #fff;
    }

    .atlas-static-icon-funny.atlas-static-icon-active {
      background: #eab308;
      color: #fff;
    }

    .atlas-static-icon:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    .atlas-static-icon svg {
      display: block;
      height: 18px;
      width: 18px;
    }

    .atlas-static-file-action {
      align-items: center;
      appearance: none;
      background: rgba(255, 255, 255, 0.14);
      border: 0;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      justify-content: center;
      padding: 4px;
      pointer-events: auto;
      text-decoration: none;
    }

    .atlas-static-file-action:hover,
    .atlas-static-file-action:focus-visible {
      background: rgba(255, 255, 255, 0.24);
      outline: none;
    }

    .atlas-static-file-action-danger:hover,
    .atlas-static-file-action-danger:focus-visible {
      background: #8d0a0c;
    }

    .atlas-static-file-action:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    .atlas-static-file-action svg {
      display: block;
      height: 18px;
      width: 18px;
    }

    .atlas-static-spinner {
      animation: atlas-badge-spin 0.8s linear infinite;
    }

    @keyframes atlas-badge-spin {
      from {
        transform: rotate(0deg);
      }

      to {
        transform: rotate(360deg);
      }
    }

    .atlas-static-progress {
      background: rgba(255,255,255,0.16);
      border-radius: 0 0 8px 8px;
      bottom: 0;
      height: 13px;
      left: 0;
      overflow: hidden;
      position: absolute;
      right: 0;
    }

    .atlas-static-progress-fill {
      background: #14b8a6;
      inset: 0;
      position: absolute;
      transition: width 180ms ease;
    }

    .atlas-static-progress-fill-idle {
      background: transparent;
    }

    .atlas-static-progress-fill-active {
      background: #14b8a6;
    }

    .atlas-static-progress-fill-success {
      background: #22c55e;
    }

    .atlas-static-progress-fill-danger {
      background: #dc2626;
    }

    .atlas-static-progress-fill-warning {
      background: #f59e0b;
    }

    .atlas-static-progress-fill-muted {
      background: #5c677d;
    }

    .atlas-static-progress-text {
      align-items: center;
      color: #fff;
      display: flex;
      font-size: 9px;
      font-weight: 700;
      height: 100%;
      justify-content: center;
      line-height: 1;
      padding: 0 8px;
      position: relative;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
      text-transform: uppercase;
      white-space: nowrap;
      z-index: 1;
    }

    [data-atlas-referrer-badge] {
      align-items: center;
      backdrop-filter: blur(4px);
      background: rgba(0, 0, 0, 0.68);
      border-radius: 6px;
      box-sizing: border-box;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.32);
      color: #fff;
      display: flex;
      flex-direction: column;
      font: 600 11px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      height: 50px;
      justify-content: center;
      overflow: hidden;
      padding: 5px 5px 8px;
      pointer-events: none;
      position: fixed;
      transform: translate(-100%, -100%);
      width: 40px;
      z-index: 2147483647;
    }

    .atlas-referrer-status {
      align-items: center;
      display: flex;
      justify-content: center;
      width: 100%;
    }

    .atlas-referrer-reaction {
      align-items: center;
      border-radius: 4px;
      display: inline-flex;
      flex: 0 0 auto;
      justify-content: center;
      padding: 2px;
    }

    .atlas-referrer-reaction-love {
      background: #ef4444;
    }

    .atlas-referrer-reaction-like {
      background: #0466c8;
    }

    .atlas-referrer-reaction-blacklist {
      background: #8d0a0c;
    }

    .atlas-referrer-reaction-funny {
      background: #eab308;
    }

    .atlas-referrer-reaction-current-page {
      background: #0f766e;
    }

    .atlas-referrer-reaction-opened-elsewhere {
      background: #334155;
    }

    .atlas-referrer-reaction svg {
      display: block;
      height: 30px;
      width: 30px;
    }

    .atlas-referrer-progress {
      background: rgba(255,255,255,0.16);
      border-radius: 0 0 6px 6px;
      bottom: 0;
      height: 6px;
      left: 0;
      overflow: hidden;
      position: absolute;
      right: 0;
    }

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
      border-radius: 8px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: #f9fafb;
      display: grid;
      font: 500 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 14px;
      left: 50%;
      max-width: calc(100vw - 32px);
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
      gap: 8px;
      justify-content: flex-end;
    }

    [data-slot="alert-dialog-action"],
    [data-slot="alert-dialog-cancel"] {
      appearance: none;
      border: 0;
      border-radius: 6px;
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
