import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');

const failures = [];

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function readText(relativePath) {
  const absolutePath = path.join(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath} is missing`);

    return null;
  }

  return fs.readFileSync(absolutePath, 'utf8');
}

function readJson(relativePath) {
  const text = readText(relativePath);

  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${relativePath} is not valid JSON: ${error.message}`);

    return null;
  }
}

const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');
const viteConfig = readText('vite.config.js');

if (viteConfig !== null) {
  const staleCombinedBuildFragments = [
    ['??', "'all'"].join(' '),
    ['return', 'inputs;'].join(' '),
  ];

  expect(
    viteConfig.includes("process.env.ATLAS_EXTENSION_BUILD_TARGET ?? 'options'"),
    'vite.config.js must default to the options-only build target',
  );
  expect(
    staleCombinedBuildFragments.every((fragment) => !viteConfig.includes(fragment)),
    'vite.config.js must not keep the stale combined content/options build mode',
  );
  expect(
    viteConfig.includes('inlineDynamicImports'),
    'vite.config.js must inline dynamic imports for the content-script build',
  );
}

if (packageJson !== null) {
  expect(
    typeof packageJson.dependencies?.['@lucide/vue'] === 'string',
    'package.json must install @lucide/vue for extension icons',
  );
  expect(
    typeof packageJson.dependencies?.['vue-router'] === 'string',
    'package.json must install vue-router for the options page routes',
  );
}

if (manifest !== null) {
  expect(manifest.manifest_version === 3, 'manifest.json must use Manifest V3');
  expect(manifest.name === 'Atlas Extension', 'manifest.json must name the extension');
  expect(/^\d+\.\d+\.\d+$/.test(manifest.version ?? ''), 'manifest.json must use a three-part version');
  expect(manifest.options_ui?.page === 'options.html', 'manifest.json must point options_ui.page to options.html');
  expect(manifest.options_ui?.open_in_tab === true, 'manifest.json options_ui.open_in_tab must be true');
  expect(Array.isArray(manifest.permissions), 'manifest.json must request storage, tabs, cookies, scripting, and clipboard permissions');
  expect(
    JSON.stringify(manifest.permissions) === JSON.stringify([
      'storage',
      'tabs',
      'cookies',
      'scripting',
      'clipboardRead',
      'clipboardWrite',
    ]),
    'manifest.json must request storage, tabs, cookies, scripting, and clipboard permissions for config, event relay, authenticated downloads, reload prompts, and popup link clipboard actions',
  );
  expect(
    JSON.stringify(manifest.icons) === JSON.stringify({
      16: 'icons/favicon-16x16.png',
      32: 'icons/favicon-32x32.png',
      48: 'icons/favicon-48x48.png',
      128: 'icons/icon-128.png',
    }),
    'manifest.json must declare copied Atlas extension icons',
  );
  expect(manifest.action?.default_title === 'Atlas', 'manifest.json must declare an Atlas toolbar action title');
  expect(manifest.action?.default_popup === 'popup.html', 'manifest.json must declare the manual scan popup page');
  expect(
    JSON.stringify(manifest.action?.default_icon) === JSON.stringify({
      16: 'icons/favicon-16x16.png',
      32: 'icons/favicon-32x32.png',
      48: 'icons/favicon-48x48.png',
    }),
    'manifest.json must declare copied Atlas toolbar action icons',
  );
  expect(
    JSON.stringify(manifest.host_permissions) === JSON.stringify(['http://*/*', 'https://*/*']),
    'manifest.json must retain provider-page and cookie access on HTTP(S) pages',
  );
  expect(
    manifest.content_security_policy?.extension_pages?.includes('connect-src'),
    'manifest.json must allow extension-page network connections',
  );
  expect(
    manifest.content_security_policy?.extension_pages
      === "script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
    'manifest.json must limit extension-page connections to the Desktop loopback service',
  );
  expect(Array.isArray(manifest.content_scripts), 'manifest.json must define content scripts for asset detection');
  expect(manifest.content_scripts?.length === 2, 'manifest.json must define location bridge and badge content scripts');
  expect(
    JSON.stringify(manifest.content_scripts?.[0]?.matches) === JSON.stringify(['<all_urls>']),
    'manifest.json location bridge must run on normal web pages',
  );
  expect(
    JSON.stringify(manifest.content_scripts?.[0]?.js) === JSON.stringify(['assets/location-bridge.js']),
    'manifest.json location bridge must load before the badge content script',
  );
  expect(
    manifest.content_scripts?.[0]?.run_at === 'document_start',
    'manifest.json location bridge must run before SPA routers initialize',
  );
  expect(
    manifest.content_scripts?.[0]?.world === 'MAIN',
    'manifest.json location bridge must run in the page main world',
  );
  expect(
    JSON.stringify(manifest.content_scripts?.[1]?.matches) === JSON.stringify(['<all_urls>']),
    'manifest.json badge content script must run on normal web pages',
  );
  expect(
    JSON.stringify(manifest.content_scripts?.[1]?.js) === JSON.stringify(['assets/content.js']),
    'manifest.json badge content script must load the compiled content asset detector',
  );
  expect(
    manifest.content_scripts?.[1]?.run_at === 'document_idle',
    'manifest.json badge content script must run after page content is available',
  );

  expect(
    manifest.background?.service_worker === 'assets/background.js',
    'manifest.json must register the background Desktop transport worker',
  );
  expect(
    manifest.background?.type === 'module',
    'manifest.json must run the background worker as a module',
  );

  for (const featureKey of [
    'declarative_net_request',
    'web_accessible_resources',
  ]) {
    expect(!(featureKey in manifest), `manifest.json must not define ${featureKey}`);
  }
}

const optionsHtml = readText('options.html');
const popupHtml = readText('popup.html');

if (optionsHtml !== null) {
  expect(optionsHtml.includes('<title>Atlas Extension Options</title>'), 'options.html must set the options page title');
  expect(optionsHtml.includes('id="app"'), 'options.html must expose a Vue mount point');
  expect(optionsHtml.includes('/src/options/main.js'), 'options.html must load the Vue options entry');
}

if (popupHtml !== null) {
  expect(popupHtml.includes('<title>Atlas Extension</title>'), 'popup.html must set the popup page title');
  expect(popupHtml.includes('atlas-popup-scan'), 'popup.html must expose a manual scan action');
  expect(popupHtml.includes('atlas-popup-load-next-tabs'), 'popup.html must expose a next-tabs load action');
  expect(popupHtml.includes('atlas-popup-copy-tab-links'), 'popup.html must expose a tab-link clipboard copy action');
  expect(popupHtml.includes('atlas-popup-open-clipboard-links'), 'popup.html must expose a clipboard-link open action');
  expect(popupHtml.includes('atlas-popup-reload'), 'popup.html must expose an extension reload action');
  expect(popupHtml.includes('/src/popup/main.js'), 'popup.html must load the popup entry');
}

const optionsMain = readText('src/options/main.js');

if (optionsMain !== null) {
  expect(optionsMain.includes('createApp'), 'src/options/main.js must mount a Vue app');
  expect(optionsMain.includes('.use(router)'), 'src/options/main.js must install the options router');
  expect(optionsMain.includes('./style.css'), 'src/options/main.js must load Tailwind styles');
}

const optionsApp = readText('src/options/App.vue');

if (optionsApp !== null) {
  expect(optionsApp.includes('@ui/'), 'src/options/App.vue must use shadcn-vue UI components');
  expect(optionsApp.includes('RouterView'), 'src/options/App.vue must render the active route');
  expect(optionsApp.includes('Desktop connection diagnostics'), 'src/options/App.vue must identify its diagnostics-only purpose');
  expect(!/RouterLink|Profiles|Logs|Settings/.test(optionsApp), 'src/options/App.vue must not expose retired Web settings navigation');
  expect(optionsApp.includes('min-h-screen w-full'), 'src/options/App.vue must keep the options page responsive');
}

const optionsRouter = readText('src/options/router.js');

if (optionsRouter !== null) {
  expect(optionsRouter.includes('createRouter'), 'src/options/router.js must create a Vue router');
  expect(optionsRouter.includes('createWebHashHistory'), 'src/options/router.js must use hash history for extension routes');
  expect(optionsRouter.includes("name: 'diagnostics'"), 'src/options/router.js must make diagnostics the only named route');
  expect(!/profiles|settings|logs/i.test(optionsRouter), 'src/options/router.js must not retain Atlas Web routes');
}

const overviewPage = readText('src/options/pages/Overview.vue');

if (overviewPage !== null) {
  for (const label of ['Channel', 'Desktop endpoint', 'Protocol', 'Desktop version', 'Extension version', 'Client ID']) {
    expect(overviewPage.includes(label), `src/options/pages/Overview.vue must show ${label} diagnostics`);
  }
  for (const action of ['Pair', 'Cancel pairing', 'Reconnect', 'Unpair']) {
    expect(overviewPage.includes(action), `src/options/pages/Overview.vue must expose the ${action} action`);
  }
  expect(!/API key|domain|profile/i.test(overviewPage), 'src/options/pages/Overview.vue must not expose Web connection settings or secrets');
}

const contentDetector = readText('src/content/assets.js');
const contentScript = readText('src/content/main.js');
const overlayHost = readText('src/content/overlay-host.js');
const contentRuntime = readText('src/content/content-runtime.js');
const contentBadge = readText('src/content/AssetBadge.vue');
const contentOverlay = readText('src/content/AssetOverlay.vue');
const contentOverlayController = readText('src/content/overlay-controller.js');
const contentOverlayStyles = readText('src/content/overlay-styles.js');
const contentBadgeModel = readText('src/content/badge-model.js');
const contentExtensionDialog = readText('src/content/ExtensionDialog.vue');
const contentReactionDialog = readText('src/content/ReactionUpdateDialog.vue');
const contentReferrerDialog = readText('src/content/ReferrerOpenDialog.vue');
const contentReferrerOpenGuard = readText('src/content/referrer-open-guard.js');
const contentReferrerState = readText('src/content/referrer-state.js');
const backgroundTabState = readText('src/background/tab-state.js');
const backgroundLoadNextTabs = readText('src/background/load-next-tabs.js');
const backgroundMain = readText('src/background/main.js');
const backgroundExtensionReload = readText('src/background/extension-reload.js');
const popupScript = readText('src/popup/main.js');
const popupLoadNextTabsHelper = readText('src/popup/load-next-tabs.js');
const popupReloadHelper = readText('src/popup/reload-extension.js');
const popupScanHelper = readText('src/popup/scan-active-tab.js');

if (contentDetector !== null) {
  expect(contentDetector.includes('describeAssetElement'), 'src/content/assets.js must expose asset descriptors');
  expect(contentDetector.includes('getAssetResolution'), 'src/content/assets.js must expose media resolution labels');
  expect(contentDetector.includes('hasAnchorAncestor'), 'src/content/assets.js must expose anchor ancestry checks');
  expect(contentDetector.includes("closest?.('a')"), 'src/content/assets.js must ignore assets inside anchor ancestors');
  expect(contentDetector.includes("'IMG'"), 'src/content/assets.js must detect image assets');
  expect(contentDetector.includes("'VIDEO'"), 'src/content/assets.js must detect video assets');
  expect(contentDetector.includes("'AUDIO'"), 'src/content/assets.js must detect audio assets');
}

if (contentScript !== null) {
  expect(contentScript.includes('createOverlayRoot') && overlayHost.includes('attachShadow'), 'the content runtime must isolate asset badges in a shadow overlay');
  expect(contentScript.includes('createAssetOverlay'), 'src/content/main.js must mount a Vue asset overlay');
  expect(contentScript.includes('createAssetBadgePresentation'), 'src/content/main.js must pass asset badge presentation data to Vue');
  expect(contentScript.includes('startContentRuntime'), 'src/content/main.js must start the content runtime');
  expect(contentScript.includes('createReferrerOpenGuard'), 'src/content/main.js must guard reacted and already-open referrers');
}

if (contentRuntime !== null) {
  expect(contentRuntime.includes('MutationObserver'), 'src/content/content-runtime.js must watch dynamically added page assets');
  expect(contentRuntime.includes('atlas-extension.manual-scan'), 'src/content/content-runtime.js must accept manual popup scan requests');
  expect(contentRuntime.includes('open-tab-counts-changed'), 'src/content/content-runtime.js must react to open tab count changes');
  expect(contentRuntime.includes('atlas-extension-location-change'), 'src/content/content-runtime.js must react to page-world location changes');
}

if (popupScript !== null) {
  expect(popupScript.includes('requestActiveTabScan'), 'src/popup/main.js must trigger an active-tab scan request');
  expect(popupScript.includes('requestNextTabsLoad'), 'src/popup/main.js must trigger a next-tabs load request');
  expect(popupScript.includes('copyCurrentWindowTabLinksToClipboard'), 'src/popup/main.js must trigger a tab-link clipboard copy request');
  expect(popupScript.includes('openClipboardLinksInCurrentWindow'), 'src/popup/main.js must trigger a clipboard-link open request');
  expect(popupScript.includes('requestExtensionReload'), 'src/popup/main.js must trigger an extension reload request');
  expect(popupScript.includes('atlas-popup-scan'), 'src/popup/main.js must bind the popup scan button');
  expect(popupScript.includes('atlas-popup-load-next-tabs'), 'src/popup/main.js must bind the popup next-tabs load button');
  expect(popupScript.includes('atlas-popup-copy-tab-links'), 'src/popup/main.js must bind the tab-link clipboard copy button');
  expect(popupScript.includes('atlas-popup-open-clipboard-links'), 'src/popup/main.js must bind the clipboard-link open button');
  expect(popupScript.includes('atlas-popup-reload'), 'src/popup/main.js must bind the popup reload button');
}

if (popupLoadNextTabsHelper !== null) {
  expect(popupLoadNextTabsHelper.includes('chrome?.tabs'), 'src/popup/load-next-tabs.js must use the Chrome tabs API');
  expect(popupLoadNextTabsHelper.includes('loadNextTabsRequestType'), 'src/popup/load-next-tabs.js must send the next-tabs request message');
}

if (popupScanHelper !== null) {
  expect(popupScanHelper.includes('chrome?.tabs'), 'src/popup/scan-active-tab.js must use the Chrome tabs API');
  expect(popupScanHelper.includes('atlas-extension.manual-scan'), 'src/popup/scan-active-tab.js must send the manual scan message');
}

if (popupReloadHelper !== null) {
  expect(popupReloadHelper.includes('chrome?.runtime'), 'src/popup/reload-extension.js must use the Chrome runtime API');
  expect(popupReloadHelper.includes('extensionReloadRequestType'), 'src/popup/reload-extension.js must send the reload request message');
}

if (contentOverlayController !== null) {
  expect(contentOverlayController.includes('createApp'), 'src/content/overlay-controller.js must create a Vue overlay app');
  expect(contentOverlayController.includes('AssetOverlay'), 'src/content/overlay-controller.js must mount the Vue overlay component');
  expect(contentOverlayController.includes('reactive'), 'src/content/overlay-controller.js must keep badge state reactive');
}

if (contentOverlay !== null) {
  expect(contentOverlay.includes('AssetBadge'), 'src/content/AssetOverlay.vue must render asset badge components');
  expect(contentOverlay.includes('ReferrerOpenDialog'), 'src/content/AssetOverlay.vue must render the referrer open confirmation dialog');
  expect(contentOverlay.includes('v-for="badge in badges"'), 'src/content/AssetOverlay.vue must render all tracked badges');
}

if (contentBadge !== null) {
  expect(contentBadge.includes('@lucide/vue'), 'src/content/AssetBadge.vue must use Lucide Vue icons');
  expect(contentBadge.includes('Heart'), 'src/content/AssetBadge.vue must render the love icon');
  expect(contentBadge.includes('ThumbsUp'), 'src/content/AssetBadge.vue must render the like icon');
  expect(contentBadge.includes('Ban'), 'src/content/AssetBadge.vue must render the blacklist icon');
  expect(contentBadge.includes('Smile'), 'src/content/AssetBadge.vue must render the funny icon');
  expect(contentBadge.includes('ExternalLink'), 'src/content/AssetBadge.vue must render the Atlas file link icon');
  expect(contentBadge.includes('Trash2'), 'src/content/AssetBadge.vue must render the delete icon');
  expect(contentBadge.includes('LoaderCircle'), 'src/content/AssetBadge.vue must render loading spinners');
  expect(contentBadge.includes('ImageIcon'), 'src/content/AssetBadge.vue must render an image type icon');
  expect(contentBadge.includes('Video'), 'src/content/AssetBadge.vue must render a video type icon');
  expect(contentBadge.includes('Volume2'), 'src/content/AssetBadge.vue must render an audio type icon');
  expect(contentBadge.includes('data-atlas-asset-badge'), 'src/content/AssetBadge.vue must render static asset badges');
  expect(contentBadge.includes('atlas-static-icons'), 'src/content/AssetBadge.vue must render static reaction icons');
  for (const eventName of ['batch-toggle', 'close-mode-change', 'delete', 'react']) {
    expect(
      contentBadge.includes(`"${eventName}"`),
      `src/content/AssetBadge.vue must emit ${eventName} clicks`,
    );
  }
  expect(contentBadge.includes('canOpenFile'), 'src/content/AssetBadge.vue must render downloaded file open commands');
  expect(contentBadge.includes("emit('open-file')"), 'src/content/AssetBadge.vue must route file opens through Desktop');
  expect(contentBadge.includes('canDeleteFile'), 'src/content/AssetBadge.vue must render downloaded file delete actions');
  expect(contentBadge.includes('progressLabel'), 'src/content/AssetBadge.vue must render dynamic progress text');
  expect(!contentBadge.includes('>Atlas</'), 'src/content/AssetBadge.vue must not render the Atlas fallback brand text');
  expect(!contentBadge.includes('badge.summary'), 'src/content/AssetBadge.vue must not render asset type as text');
}

if (contentOverlayStyles !== null) {
  expect(contentOverlayStyles.includes('position: fixed'), 'src/content/overlay-styles.js must position badges without changing page layout');
  expect(contentOverlayStyles.includes('pointer-events: none'), 'src/content/overlay-styles.js must not intercept site interactions');
  expect(contentOverlayStyles.includes('rgba(0, 0, 0, 0.6)'), 'src/content/overlay-styles.js must use the Atlas reaction badge surface');
  expect(contentOverlayStyles.includes('getOverlayDialogStyles'), 'src/content/overlay-styles.js must include the shared dialog styles');
}

if (contentExtensionDialog !== null) {
  expect(contentExtensionDialog.includes('role="alertdialog"'), 'src/content/ExtensionDialog.vue must own alert dialog semantics');
  expect(contentExtensionDialog.includes('aria-modal="true"'), 'src/content/ExtensionDialog.vue must mark the dialog modal');
  expect(contentExtensionDialog.includes('event.key === "Escape"'), 'src/content/ExtensionDialog.vue must support Escape cancellation');
  expect(contentExtensionDialog.includes('event.key !== "Tab"'), 'src/content/ExtensionDialog.vue must trap Tab focus locally');
}

if (contentReactionDialog !== null) {
  expect(contentReactionDialog.includes('ExtensionDialog'), 'src/content/ReactionUpdateDialog.vue must use the extension-owned dialog');
  expect(!contentReactionDialog.includes('@/components/ui/alert-dialog'), 'src/content/ReactionUpdateDialog.vue must not use shared Reka AlertDialog primitives in the content script');
}

if (contentReferrerDialog !== null) {
  expect(contentReferrerDialog.includes('ExtensionDialog'), 'src/content/ReferrerOpenDialog.vue must use the extension-owned dialog');
  expect(!contentReferrerDialog.includes('@/components/ui/alert-dialog'), 'src/content/ReferrerOpenDialog.vue must not use shared Reka AlertDialog primitives in the content script');
  expect(contentReferrerDialog.includes('Open anyway'), 'src/content/ReferrerOpenDialog.vue must expose a confirm action');
}

if (contentReferrerOpenGuard !== null) {
  expect(contentReferrerOpenGuard.includes('createReferrerOpenGuard'), 'src/content/referrer-open-guard.js must expose the referrer click guard');
  expect(contentReferrerOpenGuard.includes('shouldConfirmReferrerOpen'), 'src/content/referrer-open-guard.js must use referrer state priority');
}

if (contentReferrerState !== null) {
  expect(contentReferrerState.includes('resolveReferrerBadgeState'), 'src/content/referrer-state.js must resolve referrer badge state priority');
  expect(contentReferrerState.includes('opened-elsewhere'), 'src/content/referrer-state.js must expose opened-elsewhere state');
  expect(contentReferrerState.includes('current-page'), 'src/content/referrer-state.js must expose current-page state');
}

if (backgroundTabState !== null) {
  expect(backgroundTabState.includes('createOpenTabRegistry'), 'src/background/tab-state.js must track open tab URL counts');
}

if (contentBadgeModel !== null) {
  expect(contentBadgeModel.includes("display: 'flex'"), 'src/content/badge-model.js must preserve the static badge flex layout');
  expect(contentBadgeModel.includes('formatResolutionLabel'), 'src/content/badge-model.js must format compact resolution labels');
}

if (backgroundMain !== null) {
  expect(
    backgroundMain.includes('createDesktopRuntime'),
    'src/background/main.js must own the Desktop connection in the background worker',
  );
  expect(backgroundMain.includes('open-referrer-counts'), 'src/background/main.js must serve open referrer tab counts');
  expect(backgroundMain.includes('open-tab-counts-changed'), 'src/background/main.js must broadcast open tab count changes');
  expect(backgroundMain.includes('loadNextTabsFromActive'), 'src/background/main.js must handle popup next-tabs load requests');
  expect(backgroundMain.includes('handleExtensionReloadRequest'), 'src/background/main.js must handle popup extension reload requests');
  expect(backgroundMain.includes('handleExtensionReloadUpdate'), 'src/background/main.js must handle Chrome extension reload updates');
  expect(backgroundMain.includes('deliverPendingExtensionReloadNotice'), 'src/background/main.js must deliver pending reload notices');
  expect(backgroundMain.includes('reloadAllExtensionTabs'), 'src/background/main.js must handle bulk tab reload requests');
}

if (backgroundExtensionReload !== null) {
  expect(backgroundExtensionReload.includes('pendingTabIds'), 'src/background/extension-reload.js must retain failed loaded-tab notices for retry');
  expect(backgroundExtensionReload.includes('Reload all active tabs'), 'src/background/extension-reload.js must expose the bulk reload action');
}

if (backgroundLoadNextTabs !== null) {
  expect(backgroundLoadNextTabs.includes('loadNextTabsDefaultLimit'), 'src/background/load-next-tabs.js must cap next-tab reload count');
  expect(backgroundLoadNextTabs.includes('tabsApi.reload'), 'src/background/load-next-tabs.js must reload tabs through Chrome tabs API');
  expect(!backgroundLoadNextTabs.includes('tabsApi.update'), 'src/background/load-next-tabs.js must preserve the active tab');
}

const desktopContract = readText('src/shared/desktop-contract.js');
const desktopTransport = readText('src/background/desktop-transport.js');
const desktopState = readText('src/background/desktop-connection-state.js');

if (desktopContract !== null) {
  for (const value of ['http://127.0.0.1:17420', 'http://127.0.0.1:37420', "dev: 'dev'", "stable: 'stable'"]) {
    expect(desktopContract.includes(value), `src/shared/desktop-contract.js must lock ${value}`);
  }
  expect(desktopContract.includes('CHANNEL_MISMATCH'), 'src/shared/desktop-contract.js must reject cross-channel Desktop instances');
}

if (desktopTransport !== null) {
  for (const route of ['/v1/hello', '/v1/pairings', '/v1/runtime-policy', '/v1/assets/status', '/v1/reactions', '/v1/reactions/batch', '/v1/files/', '/v1/asset-match-rules/apply', '/v1/events/tickets']) {
    expect(desktopTransport.includes(route), `src/background/desktop-transport.js must implement ${route}`);
  }
  for (const header of ['Authorization', 'X-Atlas-Client-Id', 'Idempotency-Key']) {
    expect(desktopTransport.includes(header), `src/background/desktop-transport.js must send ${header}`);
  }
}

if (desktopState !== null) {
  expect(desktopState.includes('chrome?.storage?.local'), 'Desktop credentials must use chrome.storage.local');
  expect(desktopState.includes('clientToken'), 'Desktop state must retain the client token privately');
  expect(!/clientToken:\s*normalized\.clientToken/.test(desktopState), 'Desktop diagnostics must not expose the client token');
}

const optionsStyles = readText('src/options/style.css');

if (optionsStyles !== null) {
  expect(optionsStyles.includes('@import "tailwindcss"'), 'src/options/style.css must import Tailwind CSS 4');
  expect(!optionsStyles.includes(':focus-visible'), 'src/options/style.css must not add a global focus outline');
}

const inputComponent = readText('src/components/ui/input/Input.vue');

if (inputComponent !== null) {
  expect(inputComponent.includes('focus-visible:ring'), 'src/components/ui/input/Input.vue must include component focus styling');
}

const badgeComponent = readText('src/components/ui/badge/index.js');

if (badgeComponent !== null) {
  expect(badgeComponent.includes('success:'), 'src/components/ui/badge/index.js must expose a success variant');
  expect(badgeComponent.includes('danger:'), 'src/components/ui/badge/index.js must expose a danger variant');
}

if (failures.length > 0) {
  console.error('Extension validation failed:');

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log('Extension validation passed.');
