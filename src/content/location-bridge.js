const eventName = 'atlas-extension-location-change';
const installKey = '__atlasExtensionLocationBridgeInstalled';

if (window[installKey] !== true) {
  Object.defineProperty(window, installKey, {
    configurable: false,
    value: true,
  });

  const dispatchLocationChange = () => {
    window.dispatchEvent(new window.Event(eventName));
  };
  const bindHistoryMethod = (method) => {
    const original = window.history?.[method];

    if (typeof original !== 'function') {
      return;
    }

    window.history[method] = function atlasExtensionHistoryMethod(...args) {
      const result = original.apply(this, args);

      dispatchLocationChange();

      return result;
    };
  };

  bindHistoryMethod('pushState');
  bindHistoryMethod('replaceState');
  window.addEventListener('popstate', dispatchLocationChange);
  window.addEventListener('hashchange', dispatchLocationChange);
}
