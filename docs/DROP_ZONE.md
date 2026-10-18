# Drag-to-save drop zone

When a page starts dragging an image, a file link or a link, the content script
shows a drop box in the top-right corner (`src/content/drop-zone.js`). Dropping
on the box saves the item to Atlas Desktop and queues its download; there is no
rating step yet.

- Shown only during a drag that the page did not cancel. Hidden on drop
  (anywhere), `dragend` (cancel, including Escape), Escape and leaving the
  window; it reappears if the same drag re-enters the window.
- Page drag and drop is untouched: no listener prevents default except
  `dragover`/`drop` on the box itself.
- Request: the existing `atlas-extension.asset-reaction` background message,
  i.e. `POST /v1/reactions` with `download_action` defaulting to `queue`.
  Desktop requires a reaction type, so a new item is saved as `like`; an
  existing reaction is kept, and a blacklisted item is not re-downloaded
  (`src/content/drop-zone-model.js`).
- Metadata (`src/background/desktop-api.js`): the existing `asset_type`,
  `resolution`, `width`, `height`, plus additive `page_url`, `page_title`,
  `element_url` (link href, or the anchor around an image), `alt_text`,
  `title_text`, `link_text`, `filename` (from `download` or the URL) and
  `capture_method: "drop-zone"`. `referrer_url` is the page URL and `source`
  its host, as for badge reactions.
- Desktop compatibility: Desktop's `AssetMetadata` does not deny unknown
  fields, so current Desktop builds accept the request but only persist
  `asset_type`, `top_page_url`, `resolution`, `width`, `height` and
  `page_url` (from `referrer_url`). Storing the new fields needs a Desktop change.
- `asset_type` is `image`, `file` or `link`; only HTTP(S) sources are offered
  (data:/blob: images are ignored).

Tests: `tests/content-drop-zone.test.mjs`, `tests/desktop-api-drop-metadata.test.mjs`
and `tests/e2e/drop-zone.e2e.test.mjs` (see `docs/E2E_TESTING.md`).
