export function getCollectionProgressStyles() {
  return `
    .atlas-collection-progress {
      background: #111827;
      border-radius: 4px;
      bottom: max(70px, env(safe-area-inset-bottom, 0px));
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
      box-sizing: border-box;
      color: #f9fafb;
      font: 500 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-height: calc(100vh - 82px);
      max-height: calc(100dvh - 82px);
      overflow: auto;
      overflow-wrap: anywhere;
      padding: 14px;
      pointer-events: auto;
      position: fixed;
      right: 16px;
      width: min(340px, calc(100% - 32px));
      z-index: 2147483647;
    }
    .atlas-collection-progress[hidden], .atlas-collection-action[hidden] { display: none; }
    .atlas-collection-heading { color: inherit; font-size: 14px; font-weight: 700; line-height: 1.35; margin: 0; }
    .atlas-collection-counts { font-variant-numeric: tabular-nums; margin: 5px 0 0; }
    .atlas-collection-bar { background: #334155; border-radius: 2px; height: 6px; margin-top: 12px; overflow: hidden; }
    .atlas-collection-bar-fill { background: #4ba3fb; height: 100%; }
    .atlas-collection-bar[data-indeterminate] .atlas-collection-bar-fill { background: #94a3b8; }
    .atlas-collection-progress[data-phase="paused"] .atlas-collection-bar-fill,
    .atlas-collection-progress[data-phase="cancelled"] .atlas-collection-bar-fill { background: #fbbf24; }
    .atlas-collection-progress[data-phase="completed"] .atlas-collection-bar-fill { background: #22c55e; }
    .atlas-collection-note { color: #cbd5e1; font-size: 12px; margin: 8px 0 0; }
    .atlas-collection-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    .atlas-collection-action {
      appearance: none;
      background: rgba(255, 255, 255, 0.1);
      border: 0;
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      font: 600 12px/1.35 system-ui, sans-serif;
      min-height: 34px;
      padding: 6px 12px;
    }
    .atlas-collection-action:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
    .atlas-collection-action:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
    .atlas-collection-action:disabled { cursor: wait; opacity: 0.6; }
    .atlas-collection-action-primary { background: #0466c8; }
    .atlas-collection-action-primary:hover:not(:disabled) { background: #0f85fa; }
    .atlas-collection-progress::selection, .atlas-collection-progress ::selection { background: #0466c8; color: #f9fafb; }
    @media (max-width: 520px) {
      .atlas-collection-progress { right: 12px; width: calc(100% - 24px); }
      .atlas-collection-action { min-height: 40px; }
    }
  `;
}
