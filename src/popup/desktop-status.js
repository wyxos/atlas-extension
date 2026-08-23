export function describeDesktopStatus(diagnostics) {
  return {
    connected: diagnostics?.health === 'connected',
    connectionLabel: diagnostics?.health === 'connected' ? 'Connected' : 'Disconnected',
    pairingLabel: diagnostics?.pairingPending === true
      ? 'Pairing…'
      : diagnostics?.paired === true ? 'Paired' : 'Not paired',
  };
}
