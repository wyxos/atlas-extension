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
  expect(Array.isArray(manifest.permissions), 'manifest.json must request storage and tabs permissions');
  expect(
    JSON.stringify(manifest.permissions) === JSON.stringify(['storage', 'tabs']),
    'manifest.json must request storage and tabs permissions for config and event relay',
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
    'manifest.json must allow HTTP(S) Atlas API hosts configured in options',
  );
  expect(
    manifest.content_security_policy?.extension_pages?.includes('connect-src'),
    'manifest.json must allow extension-page network connections',
  );
  expect(
    manifest.content_security_policy?.extension_pages?.includes('wss:'),
    'manifest.json must allow Reverb WebSocket connections',
  );
  expect(Array.isArray(manifest.content_scripts), 'manifest.json must define content scripts for asset detection');
  expect(manifest.content_scripts?.length === 1, 'manifest.json must define exactly one content script');
  expect(
    JSON.stringify(manifest.content_scripts?.[0]?.matches) === JSON.stringify(['<all_urls>']),
    'manifest.json content script must run on normal web pages',
  );
  expect(
    JSON.stringify(manifest.content_scripts?.[0]?.js) === JSON.stringify(['assets/content.js']),
    'manifest.json content script must load the compiled content asset detector',
  );
  expect(
    manifest.content_scripts?.[0]?.run_at === 'document_idle',
    'manifest.json content script must run after page content is available',
  );

  expect(
    manifest.background?.service_worker === 'assets/background.js',
    'manifest.json must register the background Reverb relay worker',
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

if (optionsHtml !== null) {
  expect(optionsHtml.includes('<title>Atlas Extension Options</title>'), 'options.html must set the options page title');
  expect(optionsHtml.includes('id="app"'), 'options.html must expose a Vue mount point');
  expect(optionsHtml.includes('/src/options/main.js'), 'options.html must load the Vue options entry');
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
  expect(optionsApp.includes('RouterLink'), 'src/options/App.vue must render router navigation links');
  expect(optionsApp.includes('RouterView'), 'src/options/App.vue must render the active route');
  expect(optionsApp.includes('Overview'), 'src/options/App.vue must link to the Overview page');
  expect(optionsApp.includes('Profiles'), 'src/options/App.vue must link to the Profiles page');
  expect(optionsApp.includes('Logs'), 'src/options/App.vue must link to the Logs page');
  expect(optionsApp.includes('h-screen w-screen'), 'src/options/App.vue must keep the options page full width and height');
  expect(optionsApp.includes('h-full w-full'), 'src/options/App.vue must keep the content area full width and height');
}

const optionsRouter = readText('src/options/router.js');

if (optionsRouter !== null) {
  expect(optionsRouter.includes('createRouter'), 'src/options/router.js must create a Vue router');
  expect(optionsRouter.includes('createWebHashHistory'), 'src/options/router.js must use hash history for extension routes');
  expect(optionsRouter.includes("path: '/'"), 'src/options/router.js must make Overview the home route');
  expect(optionsRouter.includes("path: '/profiles'"), 'src/options/router.js must define a Profiles route');
  expect(optionsRouter.includes("path: '/logs'"), 'src/options/router.js must define a Logs route');
}

const overviewPage = readText('src/options/pages/Overview.vue');

if (overviewPage !== null) {
  expect(overviewPage.includes('max-w-md'), 'src/options/pages/Overview.vue must keep the form cluster compact');
  expect(overviewPage.includes('Connect'), 'src/options/pages/Overview.vue must render a Connect CTA');
  expect(overviewPage.includes('Refresh'), 'src/options/pages/Overview.vue must render a manual Refresh CTA');
  expect(overviewPage.includes('autoCheckConnectionOnce'), 'src/options/pages/Overview.vue must auto-check once on page load');
  expect(overviewPage.includes('isConnectableConfig'), 'src/options/pages/Overview.vue must gate auto-checks on complete settings');
  expect(overviewPage.includes('reverbStatusLabel'), 'src/options/pages/Overview.vue must render Reverb connection status');
  expect(overviewPage.includes('Show API key'), 'src/options/pages/Overview.vue must render a show API key control');
  expect(overviewPage.includes('Hide API key'), 'src/options/pages/Overview.vue must render a hide API key control');
  expect(
    overviewPage.includes('Atlas local database seeder'),
    'src/options/pages/Overview.vue must explain the default local API key source',
  );
}

const profilesPage = readText('src/options/pages/Profiles.vue');
const logsPage = readText('src/options/pages/Logs.vue');

if (profilesPage !== null) {
  expect(!profilesPage.includes('Connect'), 'src/options/pages/Profiles.vue must remain blank for now');
}

if (logsPage !== null) {
  expect(!logsPage.includes('Connect'), 'src/options/pages/Logs.vue must remain blank for now');
}

const connectionModule = readText('src/options/connection.js');
const contentDetector = readText('src/content/assets.js');
const contentScript = readText('src/content/main.js');
const contentBadge = readText('src/content/AssetBadge.vue');
const contentOverlay = readText('src/content/AssetOverlay.vue');
const contentOverlayController = readText('src/content/overlay-controller.js');
const contentOverlayStyles = readText('src/content/overlay-styles.js');
const contentBadgeModel = readText('src/content/badge-model.js');
const contentReferrerDialog = readText('src/content/ReferrerOpenDialog.vue');
const contentReferrerOpenGuard = readText('src/content/referrer-open-guard.js');
const contentReferrerState = readText('src/content/referrer-state.js');
const backgroundTabState = readText('src/background/tab-state.js');
const backgroundMain = readText('src/background/main.js');

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
  expect(contentScript.includes('attachShadow'), 'src/content/main.js must isolate asset badges in a shadow overlay');
  expect(contentScript.includes('createAssetOverlay'), 'src/content/main.js must mount a Vue asset overlay');
  expect(contentScript.includes('createBadgePresentation'), 'src/content/main.js must pass badge model data to Vue');
  expect(contentScript.includes('MutationObserver'), 'src/content/main.js must watch dynamically added page assets');
  expect(contentScript.includes('createReferrerOpenGuard'), 'src/content/main.js must guard reacted and already-open referrers');
  expect(contentScript.includes('open-tab-counts-changed'), 'src/content/main.js must react to open tab count changes');
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
  expect(contentBadge.includes('defineEmits(["delete", "react"])'), 'src/content/AssetBadge.vue must emit reaction and delete clicks');
  expect(contentBadge.includes('atlasFileUrl'), 'src/content/AssetBadge.vue must render downloaded file links');
  expect(contentBadge.includes('canDeleteFile'), 'src/content/AssetBadge.vue must render downloaded file delete actions');
  expect(contentBadge.includes('progressLabel'), 'src/content/AssetBadge.vue must render dynamic progress text');
  expect(!contentBadge.includes('>Atlas</'), 'src/content/AssetBadge.vue must not render the Atlas fallback brand text');
  expect(!contentBadge.includes('badge.summary'), 'src/content/AssetBadge.vue must not render asset type as text');
}

if (contentOverlayStyles !== null) {
  expect(contentOverlayStyles.includes('position: fixed'), 'src/content/overlay-styles.js must position badges without changing page layout');
  expect(contentOverlayStyles.includes('pointer-events: none'), 'src/content/overlay-styles.js must not intercept site interactions');
  expect(contentOverlayStyles.includes('rgba(0, 0, 0, 0.6)'), 'src/content/overlay-styles.js must use the Atlas reaction badge surface');
  expect(contentOverlayStyles.includes('[data-slot="alert-dialog-content"]'), 'src/content/overlay-styles.js must style the Shadow DOM referrer dialog');
}

if (contentReferrerDialog !== null) {
  expect(contentReferrerDialog.includes('AlertDialog'), 'src/content/ReferrerOpenDialog.vue must use shadcn-vue AlertDialog primitives');
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
    backgroundMain.includes('resolveReverbConnectionConfig'),
    'src/background/main.js must hydrate Reverb config before connecting',
  );
  expect(backgroundMain.includes('open-referrer-counts'), 'src/background/main.js must serve open referrer tab counts');
  expect(backgroundMain.includes('open-tab-counts-changed'), 'src/background/main.js must broadcast open tab count changes');
}

if (connectionModule !== null) {
  expect(connectionModule.includes('https://atlas.test'), 'src/options/connection.js must default to https://atlas.test');
  expect(
    connectionModule.includes('atlas_local_development_key'),
    'src/options/connection.js must default to the local seeded API key',
  );
  expect(connectionModule.includes('atlasExtensionConfig'), 'src/options/connection.js must define a storage key');
  expect(connectionModule.includes('Connected'), 'src/options/connection.js must expose Connected status');
  expect(connectionModule.includes('Failed'), 'src/options/connection.js must expose Failed status');
  expect(connectionModule.includes('storage?.local'), 'src/options/connection.js must use extension storage');
  expect(connectionModule.includes('/api/extension/ping'), 'src/options/connection.js must verify via the extension ping endpoint');
  expect(connectionModule.includes('verifyReverbConnection'), 'src/options/connection.js must verify Reverb once');
  expect(connectionModule.includes('pusher:connection_established'), 'src/options/connection.js must confirm Reverb handshake');
  expect(
    !/setInterval|XMLHttpRequest|chrome\.tabs|chrome\.runtime/.test(`${optionsApp ?? ''}\n${connectionModule}`),
    'extension options must avoid polling, tab, and runtime integration',
  );
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
