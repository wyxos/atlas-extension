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

Provider action tests use the supplied CivitAI AIR and creator-card markup with
an unknown package descriptor. They cover model version URLs, bounded AIR
observations when the URL omits its selected version, author and profile opens,
heading fallback, SPA replacement, package lifecycle invalidation, keyboard,
busy/error states and narrow layouts. A synthetic deviation heading exercises
the current DeviantArt package rule; live site placement remains unverified.
All actions use the actual built Dev extension and authenticated local transport.
User actions also skip hidden responsive copies, move on viewport changes, and
support profile headings without cosmetic gradients.

Run `npm run check` for the existing unit, extension-validation and lint checks
alongside this browser suite. To save synthetic progress screenshots, set
`ATLAS_BROWSER_ARTIFACT_DIR` to an output directory before running it.
