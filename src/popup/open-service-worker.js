export async function openServiceWorkerDetails({
  runtime = globalThis.chrome?.runtime,
  tabs = globalThis.chrome?.tabs,
} = {}) {
  if (!/^[a-p]{32}$/.test(runtime?.id ?? '') || typeof tabs?.create !== 'function') {
    return { ok: false, error: 'Extension details are unavailable.' };
  }

  try {
    // Chromium's public API cannot open its service-worker DevTools directly.
    // Chrome and Brave route this address to this extension's details page.
    await tabs.create({ url: `chrome://extensions/?id=${runtime.id}`, active: true });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not open extension details. Open Extensions from the browser menu.' };
  }
}
