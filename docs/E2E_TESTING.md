# End-to-end tests

The E2E suite runs the **built** development extension in Chromium through
Playwright, against a local Atlas Desktop mock (default) or a real Desktop dev
instance. No manual clicking is required.

```sh
npm install
npx playwright install chromium
npm run test:e2e                 # headless Chromium (new headless), all *.e2e.test.mjs
npm run test:e2e -- drop-zone    # only files whose name contains "drop-zone"
npm run test:e2e:headed          # real window; wrapped in xvfb-run on Linux without a display
npm run test:e2e:proof           # video + screenshots in test-results/e2e-proof (WebM, MP4 via ffmpeg)
```

`npm test`, `npm run test:browser` and `npm run lint` are unchanged and do not
start a browser for E2E files.

## Layout

| Path | Purpose |
| --- | --- |
| `tests/e2e/*.e2e.test.mjs` | Test files (`node:test` + the `playwright` library already in devDependencies). |
| `tests/e2e/harness/atlas.mjs` | `launchAtlas()`: builds the extension into a disposable directory, starts the Desktop target and fixture server, launches a persistent Chromium context with `--disable-extensions-except/--load-extension`. |
| `tests/e2e/harness/desktop-mock.mjs` | Atlas Desktop extension API mock (HTTP + WebSocket events) and a simulated download engine. |
| `tests/e2e/harness/recording-proxy.mjs` | Records requests while forwarding them to a real Desktop dev instance. |
| `tests/e2e/harness/fixture-server.mjs` | Serves `tests/e2e/fixtures/` on a loopback port. |
| `tests/e2e/harness/visual.mjs` | Native HTML5 drag helper (`startDrag`), visible cursor for videos, `exposedPoint`. |
| `tests/e2e/fixtures/` | Static pages and media used by tests. |
| `scripts/run-e2e.mjs` | Runner behind the npm scripts (headed/Xvfb, proof mode, MP4 conversion). |
| `scripts/e2e-desktop-mock.mjs` | `npm run e2e:desktop-mock`: run the mock standalone; its log is at `<url>/__mock`. |

## Writing a test

```js
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { e2eSettings, launchAtlas } from './harness/atlas.mjs';
import { startDrag } from './harness/visual.mjs';

const settings = e2eSettings();
let atlas;
before(async () => { atlas = await launchAtlas({ name: 'my-feature', settings }); await atlas.pair(); });
after(() => atlas?.close());

test('my feature sends the right request', async () => {
  const page = await atlas.context.newPage();
  await page.goto(atlas.fixtures.url('/my-fixture.html'));       // add the page to tests/e2e/fixtures/
  await page.locator('#atlas-extension-asset-overlay').waitFor({ state: 'attached' }); // content script mounted
  const reaction = atlas.desktop.nextReaction();                  // resolves with { body, data }
  await page.locator('[data-atlas-asset-badge="true"]').getByRole('button', { name: 'Like', exact: true }).click();
  const { body } = await reaction;
  assert.equal(body.type, 'like');
});
```

What `atlas` gives you:

- `context`, `worker` (the MV3 service worker), `extensionId`, `extensionUrl('popup.html')`.
- `openPopup()`, `openOptions()` open the pages by `chrome-extension://<id>/…`.
- `evaluateInWorker(fn)` runs code in the service worker with `chrome.*` APIs.
- `pair()` pairs through the same background message the options page uses.
- `fixtures.url(path)` absolute fixture URLs.
- `desktop.log` (every request: method, path, headers, body), `desktop.reactions()`,
  `desktop.nextReaction()`, `desktop.unexpected` (unknown endpoints; assert it stays empty).
  Mock only: `desktop.nextDownload(predicate)` resolves when the simulated engine
  stored a file (`file.stored.path`, `content_type`, `bytes`), `desktop.snapshot()`.
- `screenshot(page, 'screenshots/name.png')` writes only in proof mode.
- Browser-level downloads: `page.waitForEvent('download')` (see `harness.e2e.test.mjs`).

Content-script UI lives in open shadow roots; Playwright locators pierce them,
so `page.locator('[data-atlas-drop-zone]')` works directly. Atlas's own asset
badge can cover the centre of an image; `startDrag` uses `exposedPoint` to
start the drag where the element itself is hit.

Keep the tests deterministic: wait on locators or mock promises, not on fixed
timeouts. Use `settings.pause` only for watchable videos (it is 0 by default).

### Environment

| Variable | Effect |
| --- | --- |
| `ATLAS_E2E_ARTIFACT_DIR` | Record videos (`video/<name>/`) and screenshots there; enables slow motion. |
| `ATLAS_E2E_SLOWMO`, `ATLAS_E2E_PAUSE` | Playwright `slowMo` and step pauses in ms (defaults 60/800 in proof mode). |
| `ATLAS_E2E_VISUAL=1` | Visible cursor and pauses without recording. |
| `ATLAS_E2E_HEADED=1` | Headed Chromium. |
| `ATLAS_E2E_DESKTOP_URL` | Target a real Desktop dev API (`http://127.0.0.1:<port>`) through the recording proxy. |
| `ATLAS_E2E_DESKTOP_RUNTIME_ID` | Required with `ATLAS_E2E_DESKTOP_URL`: the 24-hex `runtime_id` that `/v1/hello` reports. |

## Mock vs real Desktop

The extension is built with the existing isolated test connection
(`src/test-runtime.mjs`, `ATLAS_EXTENSION_TEST_CONNECTION`), so its Desktop
base URL points at the harness port and it only accepts a Desktop reporting the
matching `runtime_id`. Ordinary Dev/Stable builds keep their fixed ports.

The mock follows Atlas Desktop's own sources; the file header of
`desktop-mock.mjs` lists the Desktop files each behaviour comes from
(`src/features/api/endpoints.json`, `extension_contract.rs`,
`extension_api/{commands,mutations,events,pairing}.rs`,
`extension_assets{,/reaction,/status,/download,/file_persistence}.rs`,
`extension_bridge.rs`). It implements hello, pairing (auto-approved), bearer
authentication, runtime policy, browser page resolution, asset status,
reactions (validation, idempotency, response shape), event tickets and the
WebSocket event stream (`ready`, `download.queued`, `download.progress`). Its
download engine fetches the asset and stores it under a 40-character basename.

Not modelled: the Desktop approval prompt, MariaDB persistence, provider
plugins, batch reactions, file open/delete, VPN routing and managed-storage
swaps. Native Desktop runs only on Windows (see atlas-desktop `AGENTS.md`).

To run against a real Desktop **dev** instance on Windows (never Stable data),
start an isolated Desktop dev runtime, read its port and `runtime_id` from
`GET /v1/hello`, then:

```powershell
$env:ATLAS_E2E_DESKTOP_URL = 'http://127.0.0.1:<port>'
$env:ATLAS_E2E_DESKTOP_RUNTIME_ID = '<runtime_id>'
npm run test:e2e:headed
```

Approve the pairing prompt in Desktop. Request assertions use the proxy log;
`nextDownload` is mock-only, so file-on-disk checks are skipped. The proxy path
can be exercised without Desktop by pointing it at `npm run e2e:desktop-mock`.

## How the extension talks to Desktop

- Content scripts never call Desktop. They send `chrome.runtime` messages
  (`src/content/background-api.js`, e.g. `atlas-extension.asset-reaction`).
- The service worker (`src/background/main.js`) adds the browser session
  (cookies, captured request headers, user agent:
  `reaction-runtime-context.js`) and calls Desktop's loopback HTTP API through
  `src/background/desktop-transport.js`: `http://127.0.0.1:17420` (Dev) or
  `:37420` (Stable) from `src/shared/desktop-contract.js`, JSON envelopes
  `{ ok, request_id, data | error }`, `Authorization: Bearer <client_token>`,
  `X-Atlas-Client-Id`, `Idempotency-Key` on mutations.
- Pairing: `GET /v1/hello` (channel, protocol 1, capabilities), then
  `POST /v1/pairings`, approved in Desktop.
- Saving/downloading: `POST /v1/reactions` (`asset_url`, `type`,
  `referrer_url`, `source`, `metadata`, `download_action`, cookies,
  `browser_session`). Desktop downloads the file; the extension has no
  `downloads` permission.
- Live state: `POST /v1/events/tickets` returns a `websocket_url`; the worker
  (`desktop-event-client.js`) receives `download.*` frames and relays them to
  matching tabs, which update the badges.
