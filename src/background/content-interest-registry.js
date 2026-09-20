const contentInterestStorageKey = 'atlasContentInterestsV1';

export function createContentInterestRegistry({
  clock = () => Date.now(),
  canonicalProviderPage = value => value,
  storageArea = globalThis.chrome?.storage?.session,
} = {}) {
  const records = new Map();
  const referrerTabIds = new Map();
  const sourceTabIds = new Map();
  let persistPending = false;

  const ready = readStoredRecords(storageArea).then((storedRecords) => {
    for (const record of storedRecords) {
      storeRecord(record);
    }
  });

  function register({ documentId, frameId = 0, pageUrl, referrerUrls, referrerKeys, sequence, sourceUrls, tabId }) {
    const normalizedTabId = normalizeTabId(tabId);
    if (normalizedTabId === null) {
      return { accepted: false, resyncRequired: false };
    }

    const previousTab = records.get(normalizedTabId);
    const frames = previousTab?.frames ?? [];
    const previous = frames.find((frame) => frame.frameId === frameId);
    const normalizedDocumentId = normalizeDocumentId(documentId);
    const normalizedSequence = normalizeSequence(sequence);

    if (
      previous
      && previous.documentId === normalizedDocumentId
      && normalizedSequence < previous.sequence
    ) {
      return { accepted: false, resyncRequired: previousTab.needsResync };
    }

    const next = {
      discarded: false,
      documentId: normalizedDocumentId,
      frameId,
      frozen: false,
      loading: false,
      needsResync: previousTab?.needsResync === true
        || (previous !== undefined && previous.documentId !== normalizedDocumentId),
      pageUrl: normalizeUrl(pageUrl),
      referrerUrls: normalizeUrls(referrerUrls),
      referrerKeys: normalizeUrls(referrerKeys ?? normalizeUrls(referrerUrls).map(canonicalProviderPage)),
      sequence: normalizedSequence,
      sourceUrls: normalizeUrls(sourceUrls),
      tabId: normalizedTabId,
      updatedAt: clock(),
    };

    const nextFrames = frames.filter((frame) => frame.frameId !== frameId);
    nextFrames.push(next);
    storeRecord(withFrames(next, nextFrames));
    schedulePersist();

    return {
      accepted: true,
      resyncRequired: next.needsResync,
    };
  }

  function reindexReferrers() {
    referrerTabIds.clear();
    for (const record of records.values()) {
      const frames = record.frames.map(frame => ({ ...frame, referrerKeys: frame.referrerUrls.map(canonicalProviderPage) }));
      const next = withFrames(record, frames);
      records.set(record.tabId, next);
      addToIndex(referrerTabIds, next.referrerKeys, record.tabId);
    }
    schedulePersist();
  }

  function resolveReferrerKeys({ tabId, frameId = 0, documentId, sequence, canonical }) {
    const record = records.get(normalizeTabId(tabId));
    const frame = record?.frames.find(frame => frame.frameId === frameId);
    if (!frame || frame.documentId !== normalizeDocumentId(documentId) || frame.sequence !== normalizeSequence(sequence)) return false;
    const frames = record.frames.map(current => current === frame
      ? { ...current, referrerKeys: current.referrerUrls.map(canonical) } : current);
    storeRecord(withFrames(record, frames));
    schedulePersist();
    return true;
  }

  function matchingTabIds(payload, resolvedReferrer = canonicalProviderPage(normalizeUrl(payload?.referrerUrl))) {
    const sourceUrl = normalizeUrl(payload?.assetUrl);
    const referrerUrl = normalizeUrl(resolvedReferrer);
    return [...new Set([
      ...(sourceUrl === null ? [] : sourceTabIds.get(sourceUrl) ?? []),
      ...(referrerUrl === null ? [] : referrerTabIds.get(referrerUrl) ?? []),
    ])];
  }

  function targetState(tabId) {
    const record = records.get(normalizeTabId(tabId));
    if (!record) {
      return null;
    }

    return {
      discarded: record.discarded,
      frozen: record.frozen,
      loading: record.loading,
      needsResync: record.needsResync,
    };
  }

  function markNeedsResync(tabId) {
    return updateRecord(tabId, (record) => ({ ...record, needsResync: true }));
  }

  function markResynced(tabId) {
    return updateRecord(tabId, (record) => ({ ...record, needsResync: false }));
  }

  function updateLifecycle(tabId, changeInfo = {}, tab = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    const record = normalizedTabId === null ? undefined : records.get(normalizedTabId);
    if (!record) {
      return { shouldResync: false };
    }

    const discarded = booleanChange(changeInfo.discarded, tab.discarded, record.discarded);
    const frozen = booleanChange(changeInfo.frozen, tab.frozen, record.frozen);
    const loading = changeInfo.status === 'loading'
      ? true
      : changeInfo.status === 'complete'
        ? false
        : record.loading;
    const wasUnavailable = record.discarded || record.frozen || record.loading;
    const isUnavailable = discarded || frozen || loading;
    const needsResync = record.needsResync
      || isUnavailable
      || typeof changeInfo.url === 'string';
    const next = {
      ...record,
      discarded,
      frozen,
      loading,
      needsResync,
      updatedAt: clock(),
    };

    records.set(normalizedTabId, next);
    schedulePersist();

    return {
      shouldResync: wasUnavailable && !isUnavailable && needsResync,
    };
  }

  function remove(tabId) {
    const normalizedTabId = normalizeTabId(tabId);
    if (normalizedTabId === null || !deleteRecord(normalizedTabId)) {
      return false;
    }

    schedulePersist();
    return true;
  }

  function removeFrame(tabId, frameId, documentId) {
    const record = records.get(normalizeTabId(tabId));
    if (!record) return false;
    const frames = record.frames.filter((frame) => frame.frameId !== frameId
      || (documentId !== undefined && frame.documentId !== documentId));
    if (frames.length === record.frames.length) return false;
    if (frames.length === 0) return remove(tabId);
    storeRecord(withFrames(record, frames));
    schedulePersist();
    return true;
  }

  function retainTabIds(tabIds) {
    const retained = new Set((Array.isArray(tabIds) ? tabIds : [])
      .map(normalizeTabId)
      .filter((tabId) => tabId !== null));
    let changed = false;

    for (const tabId of records.keys()) {
      if (!retained.has(tabId)) {
        deleteRecord(tabId);
        changed = true;
      }
    }

    if (changed) schedulePersist();
    return changed;
  }

  function reconcileTabs(tabs) {
    const currentTabs = Array.isArray(tabs) ? tabs : [];
    retainTabIds(currentTabs.map((tab) => tab?.id));
    for (const tab of currentTabs) updateLifecycle(tab?.id, {}, tab);
  }

  function snapshot() {
    return [...records.values()].map(copyRecord);
  }

  function updateRecord(tabId, transform) {
    const normalizedTabId = normalizeTabId(tabId);
    const record = normalizedTabId === null ? undefined : records.get(normalizedTabId);
    if (!record) {
      return false;
    }

    records.set(normalizedTabId, {
      ...transform(record),
      updatedAt: clock(),
    });
    schedulePersist();
    return true;
  }

  function storeRecord(record) {
    deleteRecord(record.tabId);
    records.set(record.tabId, record);
    addToIndex(sourceTabIds, record.sourceUrls, record.tabId);
    addToIndex(referrerTabIds, record.referrerKeys, record.tabId);
  }

  function deleteRecord(tabId) {
    const record = records.get(tabId);
    if (!record) return false;
    removeFromIndex(sourceTabIds, record.sourceUrls, tabId);
    removeFromIndex(referrerTabIds, record.referrerKeys, tabId);
    records.delete(tabId);
    return true;
  }

  function schedulePersist() {
    if (persistPending) {
      return;
    }

    persistPending = true;
    queueMicrotask(() => {
      persistPending = false;
      void writeStoredRecords(storageArea, snapshot());
    });
  }

  return {
    markNeedsResync,
    markResynced,
    matchingTabIds,
    ready,
    reconcileTabs,
    reindexReferrers,
    resolveReferrerKeys,
    register,
    remove,
    removeFrame,
    retainTabIds,
    snapshot,
    size: () => records.size,
    targetState,
    updateLifecycle,
  };
}

function addToIndex(index, urls, tabId) {
  for (const url of urls) {
    const tabIds = index.get(url) ?? new Set();
    tabIds.add(tabId);
    index.set(url, tabIds);
  }
}

function removeFromIndex(index, urls, tabId) {
  for (const url of urls) {
    const tabIds = index.get(url);
    if (!tabIds) continue;
    tabIds.delete(tabId);
    if (tabIds.size === 0) index.delete(url);
  }
}

function booleanChange(changeValue, tabValue, fallback) {
  if (typeof changeValue === 'boolean') return changeValue;
  if (typeof tabValue === 'boolean') return tabValue;
  return fallback;
}

function copyRecord(record) {
  return {
    ...record,
    referrerUrls: [...record.referrerUrls],
    referrerKeys: [...record.referrerKeys],
    sourceUrls: [...record.sourceUrls],
    frames: record.frames.map((frame) => ({ ...frame,
      referrerUrls: [...frame.referrerUrls], referrerKeys: [...frame.referrerKeys], sourceUrls: [...frame.sourceUrls] })),
  };
}

function withFrames(record, frames) {
  return { ...record, frames,
    sourceUrls: normalizeUrls(frames.flatMap((frame) => frame.sourceUrls)),
    referrerUrls: normalizeUrls(frames.flatMap((frame) => frame.referrerUrls)),
    referrerKeys: normalizeUrls(frames.flatMap((frame) => frame.referrerKeys ?? frame.referrerUrls)),
  };
}

function normalizeDocumentId(value) {
  return typeof value === 'string' && value !== '' ? value : 'unknown';
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : 0;
}

function normalizeTabId(value) {
  const tabId = Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function normalizeUrl(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeUrls(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeUrl)
    .filter((value) => value !== null))]
    .sort();
}

async function readStoredRecords(storageArea) {
  if (typeof storageArea?.get !== 'function') {
    return [];
  }

  try {
    const values = await storageArea.get(contentInterestStorageKey);
    const records = values?.[contentInterestStorageKey];
    return Array.isArray(records) ? records.map((record) => normalizeStoredRecord(record)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeStoredRecord(record, includeFrames = true) {
  const tabId = normalizeTabId(record?.tabId);
  if (tabId === null) {
    return null;
  }

  const normalized = {
    discarded: record?.discarded === true,
    documentId: normalizeDocumentId(record?.documentId),
    frameId: normalizeTabId(record?.frameId) ?? 0,
    frozen: record?.frozen === true,
    loading: record?.loading === true,
    needsResync: record?.needsResync === true,
    pageUrl: normalizeUrl(record?.pageUrl),
    referrerUrls: normalizeUrls(record?.referrerUrls),
    // A restarted worker must revalidate provider keys with its current Desktop.
    referrerKeys: normalizeUrls(record?.referrerUrls),
    sequence: normalizeSequence(record?.sequence),
    sourceUrls: normalizeUrls(record?.sourceUrls),
    tabId,
    updatedAt: Number(record?.updatedAt) || 0,
  };
  if (!includeFrames) return normalized;
  const frames = Array.isArray(record?.frames)
    ? record.frames.map((frame) => normalizeStoredRecord({ ...frame, tabId }, false)).filter(Boolean)
    : [normalized];
  return withFrames(normalized, frames);
}

async function writeStoredRecords(storageArea, records) {
  try {
    await storageArea?.set?.({ [contentInterestStorageKey]: records });
  } catch {
    // Session persistence is an optimization; live routing remains authoritative.
  }
}
