import { browserPageContext } from './browser-page-context.js';
export function captureProviderIdentity({ pageUrl, pageContext = browserPageContext.get(pageUrl) } = {}) {
  return pageContext?.identity ?? null;
}
