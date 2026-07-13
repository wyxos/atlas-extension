export function settleScriptExecution({
  clearTimeout,
  execution,
  setTimeout,
  timeoutMs,
}) {
  if (typeof setTimeout !== 'function' || !Number.isFinite(timeoutMs)) {
    return Promise.resolve(execution).then(() => true, () => false);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (delivered) => {
      if (settled) {
        return;
      }

      settled = true;

      if (typeof clearTimeout === 'function') {
        clearTimeout(timeoutId);
      }

      resolve(delivered);
    };

    timeoutId = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    Promise.resolve(execution).then(() => finish(true), () => finish(false));
  });
}
