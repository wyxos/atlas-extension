import { atlasDarkThemeCss } from '../shared/theme-tokens.js';

// Shares the Atlas dark roles and small radius used by the badge overlay.
export function getDropZoneStyles() {
  return `
    ${atlasDarkThemeCss}
    .atlas-drop-zone {
      align-items: center;
      backdrop-filter: blur(6px);
      background: color-mix(in srgb, var(--card) 92%, transparent);
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
      box-sizing: border-box;
      color: var(--foreground);
      display: flex;
      flex-direction: column;
      font: 600 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 6px;
      justify-content: center;
      min-height: 150px;
      padding: 16px;
      pointer-events: auto;
      position: fixed;
      right: 16px;
      text-align: center;
      top: 16px;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
      width: 260px;
      z-index: 2147483647;
    }
    .atlas-drop-zone[hidden] { display: none; }
    .atlas-drop-zone.is-over {
      background: color-mix(in srgb, var(--primary) 18%, var(--card));
      border-color: var(--primary);
      border-style: solid;
      transform: scale(1.02);
    }
    .atlas-drop-zone svg { color: var(--primary); height: 28px; pointer-events: none; width: 28px; }
    .atlas-drop-zone-title { font-size: 14px; pointer-events: none; }
    .atlas-drop-zone-detail {
      color: var(--muted-foreground);
      font-size: 11px;
      font-weight: 500;
      max-width: 100%;
      overflow: hidden;
      pointer-events: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .atlas-drop-zone-kind {
      background: var(--muted);
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: 10px;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      pointer-events: none;
      text-transform: uppercase;
    }
    .atlas-drop-zone-toast {
      background: var(--card);
      border: 1px solid var(--border);
      border-left: 3px solid var(--primary);
      border-radius: var(--radius);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: var(--foreground);
      font: 500 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: min(420px, calc(100% - 32px));
      padding: 10px 12px;
      pointer-events: none;
      position: fixed;
      right: 16px;
      top: 16px;
      z-index: 2147483647;
    }
    .atlas-drop-zone-toast[hidden] { display: none; }
    .atlas-drop-zone-toast[data-state="error"] { border-left-color: var(--destructive); }
  `;
}
