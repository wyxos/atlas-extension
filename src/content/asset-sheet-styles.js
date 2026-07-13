export function getAssetSheetStyles() {
  return `
    .atlas-asset-sheet-trigger {
      align-items: center;
      appearance: none;
      backdrop-filter: blur(8px);
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 4px;
      bottom: 16px;
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
      box-sizing: border-box;
      color: #f9fafb;
      cursor: pointer;
      display: flex;
      font: 700 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 7px;
      min-height: 42px;
      padding: 0 8px 0 14px;
      pointer-events: auto;
      position: fixed;
      right: 16px;
      transition: background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      z-index: 2147483645;
    }

    .atlas-asset-sheet-trigger:hover,
    .atlas-asset-sheet-trigger:focus-visible {
      background: #1f2937;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.44);
      outline: 2px solid #60a5fa;
      outline-offset: 2px;
      transform: translateY(-1px);
    }

    .atlas-asset-sheet-count {
      align-items: center;
      background: #0466c8;
      border-radius: 3px;
      display: inline-flex;
      height: 26px;
      justify-content: center;
      min-width: 26px;
      padding: 0 6px;
    }

    .atlas-asset-sheet-overlay {
      align-items: stretch;
      background: rgba(0, 0, 0, 0.54);
      display: flex;
      inset: 0;
      justify-content: flex-end;
      pointer-events: auto;
      position: fixed;
      z-index: 2147483646;
    }

    .atlas-asset-sheet {
      background: #0f172a;
      border-left: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: -20px 0 50px rgba(0, 0, 0, 0.4);
      box-sizing: border-box;
      color: #f9fafb;
      display: flex;
      flex-direction: column;
      font: 500 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      height: 100%;
      max-width: 100%;
      pointer-events: auto;
      width: min(420px, 100vw);
    }

    .atlas-asset-sheet-header {
      align-items: flex-start;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex: 0 0 auto;
      justify-content: space-between;
      padding: 18px 18px 16px;
    }

    .atlas-asset-sheet-header h2 {
      color: #f9fafb;
      font-size: 17px;
      font-weight: 750;
      line-height: 1.25;
      margin: 0;
    }

    .atlas-asset-sheet-header p {
      color: #94a3b8;
      font-size: 12px;
      margin: 4px 0 0;
    }

    .atlas-asset-sheet-close {
      align-items: center;
      appearance: none;
      background: rgba(255, 255, 255, 0.08);
      border: 0;
      border-radius: 3px;
      color: #f9fafb;
      cursor: pointer;
      display: inline-flex;
      flex: 0 0 auto;
      height: 36px;
      justify-content: center;
      width: 36px;
    }

    .atlas-asset-sheet-close:hover,
    .atlas-asset-sheet-close:focus-visible {
      background: rgba(255, 255, 255, 0.16);
      outline: 2px solid #60a5fa;
      outline-offset: 2px;
    }

    .atlas-asset-sheet-list {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 14px;
    }

    .atlas-asset-sheet-item {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      box-sizing: border-box;
      display: grid;
      gap: 10px;
      grid-template-areas:
        "preview meta"
        "preview reactions";
      grid-template-columns: 84px minmax(0, 1fr);
      padding: 10px;
    }

    .atlas-asset-sheet-item-meta {
      display: flex;
      flex-direction: column;
      gap: 5px;
      grid-area: meta;
      min-width: 0;
    }

    .atlas-asset-sheet-preview {
      align-items: center;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      display: flex;
      grid-area: preview;
      height: 84px;
      justify-content: center;
      overflow: hidden;
      position: relative;
      width: 84px;
    }

    .atlas-asset-sheet-preview-media {
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 160ms ease;
      width: 100%;
    }

    .atlas-asset-sheet-preview-media-ready {
      opacity: 1;
    }

    .atlas-asset-sheet-preview-loader {
      color: #94a3b8;
      position: absolute;
    }

    .atlas-asset-sheet-preview-fallback {
      color: #94a3b8;
    }

    .atlas-asset-sheet-kind {
      align-items: center;
      color: #f8fafc;
      display: flex;
      font-size: 13px;
      font-weight: 700;
      gap: 6px;
    }

    .atlas-asset-sheet-kind span {
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 600;
    }

    .atlas-asset-sheet-source {
      color: #94a3b8;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .atlas-asset-sheet-reactions {
      display: grid;
      gap: 8px;
      grid-area: reactions;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .atlas-asset-sheet-reaction {
      align-items: center;
      appearance: none;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid transparent;
      border-radius: 3px;
      color: #f8fafc;
      cursor: pointer;
      display: inline-flex;
      height: 38px;
      justify-content: center;
    }

    .atlas-asset-sheet-reaction:hover:not(:disabled),
    .atlas-asset-sheet-reaction:focus-visible {
      background: rgba(255, 255, 255, 0.16);
      outline: 2px solid #60a5fa;
      outline-offset: 1px;
    }

    .atlas-asset-sheet-reaction-love:hover:not(:disabled) { color: #f87171; }
    .atlas-asset-sheet-reaction-like:hover:not(:disabled) { color: #38bdf8; }
    .atlas-asset-sheet-reaction-blacklist:hover:not(:disabled) { color: #f87171; }
    .atlas-asset-sheet-reaction-funny:hover:not(:disabled) { color: #facc15; }
    .atlas-asset-sheet-reaction-love.atlas-asset-sheet-reaction-active { background: #ef4444; color: #fff; }
    .atlas-asset-sheet-reaction-like.atlas-asset-sheet-reaction-active { background: #0466c8; color: #fff; }
    .atlas-asset-sheet-reaction-blacklist.atlas-asset-sheet-reaction-active { background: #8d0a0c; color: #fff; }
    .atlas-asset-sheet-reaction-funny.atlas-asset-sheet-reaction-active { background: #eab308; color: #fff; }

    .atlas-asset-sheet-reaction:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    .atlas-asset-sheet-fade-enter-active,
    .atlas-asset-sheet-fade-leave-active {
      transition: opacity 180ms ease;
    }

    .atlas-asset-sheet-fade-enter-active .atlas-asset-sheet,
    .atlas-asset-sheet-fade-leave-active .atlas-asset-sheet {
      transition: transform 180ms ease;
    }

    .atlas-asset-sheet-fade-enter-from,
    .atlas-asset-sheet-fade-leave-to {
      opacity: 0;
    }

    .atlas-asset-sheet-fade-enter-from .atlas-asset-sheet,
    .atlas-asset-sheet-fade-leave-to .atlas-asset-sheet {
      transform: translateX(100%);
    }

    @media (max-width: 520px) {
      .atlas-asset-sheet-trigger {
        bottom: 12px;
        right: 12px;
      }

      .atlas-asset-sheet {
        width: 100vw;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .atlas-asset-sheet-trigger,
      .atlas-asset-sheet-fade-enter-active,
      .atlas-asset-sheet-fade-leave-active,
      .atlas-asset-sheet-fade-enter-active .atlas-asset-sheet,
      .atlas-asset-sheet-fade-leave-active .atlas-asset-sheet,
      .atlas-asset-sheet-preview-media {
        transition-duration: 1ms;
      }
    }
  `;
}
