# Drag-to-save drop zone

The drop zone is a universal fallback for assets Atlas's badges do not cover.
When a page starts dragging an image, a video, an audio file, a file link or a
link, the content script shows a drop box in the top-right corner
(`src/content/drop-zone.js`). Dropping on the box opens a small reaction picker;
the chosen (or default) reaction saves the item to Atlas Desktop and queues its
download.

## What can be dragged

Resolution lives in `describeDragSource` (`src/content/drop-zone-model.js`):

| Drag source | Resolved as |
| --- | --- |
| `<img>` (or an image inside a link) | `image`, with the anchor as `element_url` |
| `<video>` / `<audio>` or one of its `<source>` children | `video` / `audio`, URL from `currentSrc` → first `<source src>` → `src` |
| Link to a media file | `video` / `audio` by URL extension (`mp4`, `webm`, `mov`, `mkv`, `m3u8`, `mpd`, … / `mp3`, `ogg`, `opus`, `flac`, `wav`, `m4a`, …) or by the link `type` attribute (`video/*`, `audio/*`, HLS/DASH MIME types) |
| Other file links (`download` attribute or a non-page extension) | `file` |
| Other links | `link` |
| A text-less overlay link or a non-link draggable stacked above media | the `<video>`, `<audio>` or `<img>` under the pointer (`document.elementsFromPoint` at the mousedown point) |
| A custom player widget hiding a single `<audio>`/`<video>` (no native controls) | that media element (searches the widget and up to 3 ancestors; ambiguous widgets with several media are ignored) |

Text links keep their meaning: a link with visible text is never re-resolved to
the media underneath it.

`<video>`, `<audio>` and most overlays are not natively draggable. Holding
**Alt** while starting the drag makes the element under the pointer draggable
for that one gesture (only when a media element or image is under the pointer,
or the element is a custom player); the attribute is restored on mouseup. Atlas's
own badge is never hijacked.

Media captures `duration` (seconds, when finite), `width`/`height`/`resolution`
(`videoWidth`×`videoHeight`), `poster_url` and `mime_type` (from the chosen
`<source type>` or the link `type`).

**Streams are skipped:** a `blob:`, `data:` or `srcObject` (MediaStream /
MediaSource) source has no URL Desktop can fetch. The box then shows
"Can't save this video — This video plays from a browser stream…", dropping
shows "Nothing was sent to Atlas." and no request is made.

## Reaction picker

After a drop, `DropReactionPicker.vue` (mounted by `src/content/drop-zone-picker.js`)
shows Love / Like / Blacklist / Funny using the same Lucide icons
(`src/content/reaction-options.js`, shared with `AssetBadge.vue`) and the same
`.atlas-static-icon` styles (`src/content/reaction-icon-styles.js`).

- Default: Like, applied after 4 s (`dropReactionTimeoutMs`, a countdown bar
  shows it), on the close button, or on Escape.
- The asset status lookup (`/v1/assets/status`) runs while the picker is open.
  An item already reacted in Atlas keeps its reaction as the default ("Already
  Love in Atlas · kept unless you pick another"); a blacklisted item defaults to
  *not* downloading ("Blacklisted in Atlas · pick a reaction to download
  anyway"). An explicit pick always wins, except re-picking Blacklist.
- **One request per drop.** The extension waits for the picker to settle and
  then sends a single `POST /v1/reactions`. Sending Like immediately and
  updating it after a pick would conflict with Desktop's semantics: the
  reaction endpoint is an upsert that also enqueues or cancels the download
  (`atlas-desktop src-tauri/src/extension_assets/reaction.rs`), so a later pick
  would create a second idempotency record, and Blacklist would start a
  download and then cancel it. The cost is up to 4 s before the download is
  queued when the user does not pick.

## Request and metadata

- Request: the existing `atlas-extension.asset-reaction` background message,
  i.e. `POST /v1/reactions` with `download_action` defaulting to `queue`.
- Metadata (`src/background/desktop-api.js`): the existing `asset_type`,
  `resolution`, `width`, `height`, plus additive `page_url`, `page_title`,
  `element_url`, `alt_text`, `title_text`, `link_text`, `filename`,
  `mime_type`, `poster_url`, `duration` and `capture_method: "drop-zone"`.
  `referrer_url` is the page URL and `source` its host, as for badge reactions.
- Desktop compatibility: Desktop's `AssetMetadata` does not deny unknown
  fields, so current Desktop builds accept the request but only persist
  `asset_type`, `top_page_url`, `resolution`, `width`, `height` and
  `page_url` (from `referrer_url`). Storing the new fields needs a Desktop change.

### `asset_type` mapping

Desktop does not validate `asset_type` (a free string in `AssetMetadata`); the
badges already send `image`, `video` and `audio` (`src/content/assets.js`
`assetTypesByTag`). It changes how Desktop downloads:

| Drop zone | Sent `asset_type` | Desktop behaviour |
| --- | --- | --- |
| image | `image` | direct download |
| video (element or link) | `video` | `source_type` = `yt-dlp` (`src-tauri/src/downloads/model.rs`), so yt-dlp fetches the URL (its generic extractor handles direct files); `downloads/engine/ytdlp.rs` / `replacements.rs` fall back to a native download |
| audio (element or link) | `audio` | direct download (no special handling) |
| file link | `file` | direct download |
| page link | `link` | direct download of the URL |

## Lifecycle

- Shown only during a drag the page did not cancel. Hidden on drop (anywhere),
  `dragend` (cancel, including Escape), Escape and leaving the window; it
  reappears if the same drag re-enters the window.
- Page drag and drop is untouched: no listener prevents default except
  `dragover`/`drop` on the box itself (and the temporary `draggable` for Alt+drag).

## Limits

- Content type is only read from the link `type` attribute; no `HEAD` request
  is made, so an extension-less media URL without `type` is saved as `link`.
- `blob:`/MSE/MediaStream playback (most streaming sites) cannot be saved from
  the element. A possible follow-up is sending the page URL as `video` so
  Desktop's yt-dlp path resolves it.
- Native `<audio controls>`/`<video controls>` UI consumes mouse events in
  Chromium, so Alt+drag must start on the picture area (videos) or a custom
  player; elements with native controls usually have an Atlas badge already.
- The drop zone and picker share the top-right corner with the toast; a new
  drag hides the previous toast.

Tests: `tests/content-drop-zone.test.mjs`, `tests/desktop-api-drop-metadata.test.mjs`,
`tests/e2e/drop-zone.e2e.test.mjs` and `tests/e2e/drop-zone-media.e2e.test.mjs`
(see `docs/E2E_TESTING.md`).
