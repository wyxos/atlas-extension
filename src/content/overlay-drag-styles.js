export function getOverlayDragStyles() {
  return `
    .atlas-static-drag-handle {
      align-items: center;
      appearance: none;
      background: rgba(255, 255, 255, 0.08);
      border: 0;
      border-radius: 0 0 4px 4px;
      color: rgba(255, 255, 255, 0.78);
      cursor: grab;
      display: inline-flex;
      height: 15px;
      justify-content: center;
      left: 50%;
      padding: 0 8px;
      pointer-events: auto;
      position: absolute;
      top: 0;
      touch-action: none;
      transform: translateX(-50%);
    }
    .atlas-static-drag-handle:active { cursor: grabbing; }
    .atlas-static-drag-handle:hover,
    .atlas-static-drag-handle:focus-visible {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      outline: 2px solid #0f85fa;
      outline-offset: -2px;
    }
  `;
}
