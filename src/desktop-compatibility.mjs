import fs from 'node:fs';
import path from 'node:path';

import { requiredDesktopCapabilities } from './shared/desktop-capabilities.js';

export function createDesktopCompatibilityMarker(channel) {
  return {
    channel,
    desktopBaseUrl: channel === 'stable' ? 'http://127.0.0.1:37420' : 'http://127.0.0.1:17420',
    protocolVersion: 1,
    requiredCapabilities: [...requiredDesktopCapabilities],
  };
}

export function validateDesktopCompatibilityMarker(marker) {
  const expectedBaseUrl = marker?.channel === 'stable'
    ? 'http://127.0.0.1:37420'
    : 'http://127.0.0.1:17420';

  if (
    !marker
    || !['dev', 'stable'].includes(marker.channel)
    || marker.desktopBaseUrl !== expectedBaseUrl
    || marker.protocolVersion !== 1
    || !Array.isArray(marker.requiredCapabilities)
    || !requiredDesktopCapabilities.every((capability) => marker.requiredCapabilities.includes(capability))
  ) {
    throw new Error('Atlas Desktop compatibility marker is incomplete.');
  }

  return marker;
}

export function writeDesktopCompatibilityMarker({ buildOutputPath, channel }) {
  const compatibility = validateDesktopCompatibilityMarker(
    createDesktopCompatibilityMarker(channel),
  );
  fs.writeFileSync(
    path.join(buildOutputPath, 'atlas-desktop-compatibility.json'),
    `${JSON.stringify(compatibility, null, 2)}\n`,
  );
}
