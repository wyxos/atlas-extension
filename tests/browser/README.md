# Browser tests

Install the test dependencies and Chromium, then run the suite:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

The nested-link test opens A -> B -> C through real links and verifies A's
opened badge, selected reaction, intermediate progress and completion. It covers
Favorite, Like and Funny at desktop width, plus Like at narrow width. Unrelated
links retain their state, and A keeps its original document throughout.

Each case uses a fresh browser profile and a development extension built into a
temporary directory. A local fake Desktop supplies pairing, status and WebSocket
events. Status lookups return no reactions, so pushed events must update the
badges. This suite verifies extension behavior in Chromium; native downloads and
provider matching need their separate Desktop tests.

Run `npm run check` for the existing unit, extension-validation and lint checks
alongside this browser suite. To save synthetic progress screenshots, set
`ATLAS_BROWSER_ARTIFACT_DIR` to an output directory before running it.
