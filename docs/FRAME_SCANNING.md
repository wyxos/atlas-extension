# Embedded media scanning

The location bridge and media content script run in every permitted frame. Chrome's
origin fallback also covers related `about:blank`, `srcdoc`, `data:` and `blob:`
documents. Each frame scans its own document and open shadow roots, including media
inserted or revealed after interaction. The ordinary visibility and media rules apply.

The popup uses `webNavigation.getAllFrames` and sends a separate Scan request to each
document. It waits for every acknowledgement, with a five-second timeout per request.
An unreachable or replaced document produces an incomplete-scan message instead of a
false success. New frames created after the frame list was captured receive automatic
startup scanning and are included in the next manual scan.

Download subscriptions are stored per frame/document and combined per tab for event
routing. Frame departure and navigation retire subscriptions; a restored page reports
again. Only the top-level document displays the tab counter. Media widgets and their
page-URL matching/download context use the document containing the media.

Reload the rebuilt extension and the target page to enable the new content scripts
and `webNavigation` permission. Browser-restricted pages and closed shadow roots remain
inaccessible. Detection does not guarantee that a provider's stream is downloadable.

Run `npm run check` for unit regressions, manifest validation and lint. For real browser
verification, first build with `npm run build -- --channel dev --out dist/iframe-scan-dev`,
then run `node tests/browser/iframe-scan.mjs <playwright-core-directory> <chromium-executable>`.
The browser test uses a temporary profile and loopback fixture to check late video
insertion in same-origin, cross-origin and srcdoc frames, popup acknowledgement,
subscriptions, and desktop/narrow layouts. Screenshots remain in the ignored dev output.

Validation limit: the current Windows test environment could not launch its cached
Chromium (invalid side-by-side configuration) or finish launching isolated Edge.
Unit/manifest checks and the development build are verified; real browser layout,
frame injection and end-to-end download verification remain outstanding.
