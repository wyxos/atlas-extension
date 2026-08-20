export function createOverlayRoot(documentContext, hostId) {
  const host = documentContext.createElement('div');
  host.id = hostId;
  host.setAttribute('style', [
    'all:initial',
    'contain:layout style paint',
    'inset:0',
    'pointer-events:none',
    'position:fixed',
    'z-index:2147483647',
  ].join(';'));
  const root = host.attachShadow({ mode: 'open' });
  (documentContext.body ?? documentContext.documentElement).append(host);
  return root;
}
