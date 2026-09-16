# Browser provider packages

CivitAI, DeviantArt and Wallhaven browser rules are maintained in each provider repository's `browser/` directory. The Extension owns common media capture, settings, reactions, identity transport, downloads and tab events. Reddit remains built in.

`browser-provider.json` declares `{ "schemaVersion": 1, "id": "example", "entry": "index.js" }`. The entry exports a default adapter with a unique `id` and optional capabilities:

- `canonicalPage(value)` returns a stable page event key, or null for an unsupported URL.
- `captureIdentity(documentContext, pageUrl)` returns an untrusted `{ provider, item_id }` hint, or null.
- `preserveReferrer(value)` requests the original page context on asset status messages.
- `batch.resolve(options)` and `batch.collect(options)` provide site-specific collection using the existing common batch interface.

DeviantArt owns its UUID extraction, artwork page rules and complete carousel collector. CivitAI owns its domain aliases, image page normalization and preserved referrer decision. Wallhaven uses shared media capture and supplies page event normalization. No provider adapter performs API enrichment, account operations or media downloads in the Extension.

To replace the complete provider selection with reviewed local sources:

```text
node scripts/sync-browser-providers.mjs <civitai-repo>/browser <deviantart-repo>/browser <wallhaven-repo>/browser
npm run check
npm run build -- --channel dev
```

Alternatively, set `ATLAS_BROWSER_PROVIDER_SOURCES` to a JSON array of those absolute directory paths when invoking the build. The normal build verifies the vendored snapshot using `src/provider-plugins/sources.lock.json`. Source edits require resync; never edit the generated snapshot directly. Snapshots let the Extension repository build independently without a neighboring Desktop checkout. Review the resulting source and lock diff before committing an update.

The registry is generated from the selected sources and imports the actual adapter implementation. It does not contain provider-name dispatch. Adding an adapter therefore does not require changing shared registries. Compatibility re-export modules preserve existing consumers and tests.

Browser executable code is bundled into the Extension at build time. Installing a Desktop `.atlas-provider` does not add browser JavaScript to an already installed Extension; rebuild and reload the development Extension, or distribute a new signed store build. This preserves Manifest V3's local executable-code boundary and existing CSP. Provider source selection is a developer trust decision; a source lock detects accidental drift and is not a publisher signature.

Captured signed URLs, optional identity hints, bounded carousel navigation, restoration and generic Reddit batching retain their existing behavior. Source preferences and dimension hints retain the limitations documented in Desktop's `EXTENSION_DOWNLOAD_METADATA.md`; extraction does not establish original-file quality.
