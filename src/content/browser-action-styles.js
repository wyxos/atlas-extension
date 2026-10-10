import { atlasDarkThemeCss } from '../shared/theme-tokens.js';

export function browserActionStyles() {
  return `${atlasDarkThemeCss}
    :host { all: initial; display: inline-flex; vertical-align: middle; max-width: 100%; margin: 4px 0 4px 6px; }
    .action { display: inline-flex; flex-direction: column; gap: 4px; max-width: 100%; }
    button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex;
      align-items: center; justify-content: center; min-height: 28px; padding: 4px 8px;
      border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
      color: var(--foreground); font: 600 12px/1.35 system-ui, sans-serif; overflow-wrap: anywhere;
      transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease; }
    button:hover { background: var(--muted); border-color: var(--primary); }
    button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    button:disabled { cursor: default; opacity: .65; }
    button[data-state="success"] { border-color: var(--primary); }
    button[data-state="error"] { border-color: var(--destructive); }
    .status { color: var(--muted-foreground); font: 12px/1.35 system-ui, sans-serif; max-width: 220px; }
    .status:empty { display: none; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `;
}
