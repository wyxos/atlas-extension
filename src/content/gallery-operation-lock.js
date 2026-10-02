const busyError = () => Object.assign(new Error('Another gallery operation is already running. Wait for it to finish.'), {
  code: 'BATCH_COLLECTION_BUSY',
  retryable: true,
});

// Collection navigates the shared page. Inspection and reactions must own it
// exclusively; identical concurrent inspections can share the same work.
export function createGalleryOperationLock() {
  let active = null;

  function begin(kind, key, callback) {
    const operation = { kind, key, promise: null };
    active = operation;
    operation.promise = Promise.resolve().then(callback).finally(() => {
      if (active === operation) active = null;
    });
    return operation.promise;
  }

  return {
    assertAvailable() {
      if (active) throw busyError();
    },
    runPreview(key, callback) {
      if (active) {
        return active.kind === 'preview' && active.key === key
          ? active.promise
          : Promise.reject(busyError());
      }
      return begin('preview', key, callback);
    },
    runAction(callback) {
      return active ? Promise.reject(busyError()) : begin('action', null, callback);
    },
    get busy() { return active !== null; },
    get kind() { return active?.kind ?? null; },
  };
}
