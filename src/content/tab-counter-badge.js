import {
  tabCounterChangedMessageType,
  tabCounterSnapshotRequestType,
} from '../shared/tab-counter-messages.js';

const tabCounterHostId = 'atlas-extension-tab-counter';
const locationBridgeEventName = 'atlas-extension-location-change';

export async function initializeTabCounterBadge({
  documentContext = globalThis.document,
  runtime = globalThis.chrome?.runtime,
  windowContext = globalThis.window,
} = {}) {
  if (typeof runtime?.sendMessage !== 'function' || !documentContext?.createElement) {
    return null;
  }

  const badge = createTabCounterBadge({ documentContext });
  const refresh = () => {
    void requestTabCounterSnapshot({ runtime, windowContext })
      .then((snapshot) => badge.update(snapshot))
      .catch(() => badge.update(null));
  };

  runtime.onMessage?.addListener?.((message) => {
    if (message?.type === tabCounterChangedMessageType) {
      badge.update(message.payload ?? null);
    }
  });

  for (const eventName of ['focus', 'pageshow', 'popstate', 'hashchange', locationBridgeEventName]) {
    windowContext?.addEventListener?.(eventName, refresh, { passive: true });
  }

  await requestTabCounterSnapshot({ runtime, windowContext })
    .then((snapshot) => badge.update(snapshot))
    .catch(() => badge.update(null));

  return {
    badge,
    refresh,
  };
}

export function createTabCounterBadge({
  documentContext = globalThis.document,
} = {}) {
  let host = null;
  let pill = null;

  function update(snapshot) {
    const counter = normalizeSnapshot(snapshot);

    if (counter === null) {
      hideHost();

      return;
    }

    ensureHost();
    host.style.display = 'block';
    pill.textContent = `${counter.sameDomainTabs} / ${counter.totalTabsInWindow}`;
    pill.setAttribute(
      'aria-label',
      `${counter.sameDomainTabs} tabs on ${counter.domain} out of ${counter.totalTabsInWindow} tabs in this window`,
    );
    pill.title = `${counter.domain}: ${counter.sameDomainTabs} of ${counter.totalTabsInWindow} tabs`;
  }

  function ensureHost() {
    if (host !== null) {
      return;
    }

    host = documentContext.createElement('div');
    host.id = tabCounterHostId;
    Object.assign(host.style, {
      all: 'initial',
      left: '50%',
      pointerEvents: 'none',
      position: 'fixed',
      top: '10px',
      transform: 'translateX(-50%)',
      zIndex: '2147483645',
    });

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const style = documentContext.createElement('style');

    pill = documentContext.createElement('div');
    pill.className = 'atlas-tab-counter';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      :host {
        all: initial;
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .atlas-tab-counter {
        background: rgba(6, 14, 26, 0.86);
        border: 1px solid rgba(148, 163, 184, 0.42);
        border-radius: 6px;
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
        box-sizing: border-box;
        color: #e5edf7;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        min-width: 48px;
        padding: 6px 9px;
        text-align: center;
        white-space: nowrap;
      }
    `;

    shadowRoot.append(style, pill);
    (documentContext.body ?? documentContext.documentElement).append(host);
  }

  function hideHost() {
    if (host !== null) {
      host.style.display = 'none';
    }
  }

  return {
    update,
  };
}

function requestTabCounterSnapshot({ runtime, windowContext }) {
  return new Promise((resolve, reject) => {
    runtime.sendMessage({
      currentUrl: windowContext?.location?.href ?? '',
      type: tabCounterSnapshotRequestType,
    }, (response) => {
      const error = runtime.lastError?.message;

      if (error || response?.ok === false) {
        reject(new Error(error ?? response?.error ?? 'Tab counter unavailable.'));

        return;
      }

      resolve(response?.payload ?? null);
    });
  });
}

function normalizeSnapshot(snapshot) {
  const sameDomainTabs = Number(snapshot?.sameDomainTabs);
  const totalTabsInWindow = Number(snapshot?.totalTabsInWindow);
  const domain = typeof snapshot?.domain === 'string' ? snapshot.domain.trim() : '';

  if (
    !Number.isInteger(sameDomainTabs)
    || !Number.isInteger(totalTabsInWindow)
    || sameDomainTabs <= 0
    || totalTabsInWindow <= 0
    || domain === ''
  ) {
    return null;
  }

  return {
    domain,
    sameDomainTabs,
    totalTabsInWindow,
  };
}
