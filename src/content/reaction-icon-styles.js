// Reaction button styles shared by the asset badge and the drop-zone picker.
export function getReactionIconStyles() {
  return `
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
  `;
}
