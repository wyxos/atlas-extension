export function getOverlayNoticeStyles() {
  return `
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
