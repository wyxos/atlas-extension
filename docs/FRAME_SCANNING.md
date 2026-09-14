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
page-URL matching and saved referrer use the document containing the media.

For video reactions from a child frame, the background script also captures the
browser-provided top-level tab URL in `metadata.top_page_url`. This works across
origins and nested frames without reading the parent DOM. Only HTTP(S) pages
without URL credentials are accepted. The same context is sent for batch video
items and request previews. Cookies are collected for the top page, frame referrer
and asset URL. Media/referrer matching identities remain frame-specific.

Desktop tries the top-level page first when yt-dlp extraction is needed. A playlist
result is rejected before downloading an arbitrary entry and uses the frame fallback.
On an unsupported, extraction or uncategorized failure it tries the saved iframe page
once, using the top page as the HTTP Referer, before considering the existing
separate-media HTTP fallback. Recognized authentication, rate-limit and network
errors keep their existing handling. Direct video files keep native downloading.
Older extensions omit the extra field and retain their existing behavior.

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
