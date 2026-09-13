export function createContentInterestReporter({
  diagnostics,
  documentContext = globalThis.document,
  getInterests,
  onResyncRequired = () => {},
  runtime = globalThis.chrome?.runtime,
  windowContext = globalThis.window,
} = {}) {
  const documentId = createDocumentId();
  let lastSignature = null;
  let pending = false;
  let sequence = 0;

  windowContext?.addEventListener?.('pagehide', () => {
    runtime?.sendMessage?.({ type: 'atlas-extension.content-interests-remove', documentId }, () => {
      void runtime?.lastError;
    });
  });
  windowContext?.addEventListener?.('pageshow', () => schedule({ force: true }));

  function schedule({ force = false } = {}) {
    if (pending) {
      return;
    }

    pending = true;
    queueMicrotask(() => {
      pending = false;
      report({ force });
    });
  }

  function report({ force = false } = {}) {
    if (typeof runtime?.sendMessage !== 'function') {
      return;
    }

    const interests = normalizeInterests(getInterests?.());
    const signature = JSON.stringify(interests);
    if (!force && signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    sequence += 1;
    const startedAt = diagnostics?.start?.() ?? null;

    runtime.sendMessage({
      documentId,
      pageUrl: windowContext?.location?.href ?? documentContext?.location?.href ?? null,
      referrerUrls: interests.referrerUrls,
      sequence,
      sourceUrls: interests.sourceUrls,
      type: 'atlas-extension.content-interests',
    }, (response) => {
      diagnostics?.finish?.('message-latency', startedAt, {
        direction: 'content-to-background',
        messageType: 'content-interests',
      });
      if (globalThis.chrome?.runtime?.lastError) {
        return;
      }
      if (response?.payload?.resyncRequired === true) {
        onResyncRequired();
      }
    });
  }

  return {
    documentId,
    report,
    schedule,
  };
}

function normalizeInterests(interests) {
  return {
    referrerUrls: normalizeUrls(interests?.referrerUrls),
    sourceUrls: normalizeUrls(interests?.sourceUrls),
  };
}

function normalizeUrls(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim()))]
    .sort();
}

function createDocumentId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
