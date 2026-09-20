# Browser capture from installed plugins

The extension contains generic media capture, gallery collection, settings,
reactions, downloads and tab events. Site rules belong to independently installed
Desktop plugin packages. Building the extension does not read provider repositories
or bundle their source.

## Package contract

A provider manifest can declare `"browser": { "schema": "browser/capture.json" }`.
The descriptor must be included in the sealed package files. Desktop validates it
during installation and activation. Packages without a descriptor still work as
Desktop providers and receive generic browser capture.

The descriptor uses schemaVersion 1 and a bounded list of rules. Rules match host
names and a pathname pattern. They can supply a canonical page key, a metadata UUID
identity, referrer preservation, an image-source preference and one of two fixed
gallery layouts: thumbnails or slots. The authoritative typed schema and limits
are in Desktop's provider_host/browser.rs. Descriptors contain data only: no
JavaScript, action sequences, expressions or arbitrary browser commands.

Desktop resolves matching rules; the extension receives only the resulting page
description. A provider can use any ID. Extension dispatch uses the declared
gallery kind, never a provider-name switch. New site configurations supported by
these existing capabilities need only a plugin update. A genuinely new browser
capability requires an extension update.

## Desktop bridge

The paired local transport advertises browser-provider-resolution-v1 and accepts
POST /v1/browser/resolve with up to 100 pages. Each page supplies its URL and
optionally up to 64 bounded name/content metadata pairs. The request does not send
the document HTML, form values or cookies. Existing authenticated capture and
download flows retain their own contracts.

A result contains the original URL, canonicalPage, provider, profileVersion,
identity, gallery, galleryKey, imageSource and preserveReferrer. Unmatched pages
receive generic capture. Disabled or missing dependencies suppress the provider.
Overlapping installed providers fail resolution instead of selecting an arbitrary
provider. Desktop uses only descriptors from verified active packages.

Plugin install, update, rollback, enable, disable and removal publish
browser.providers.changed. The extension invalidates cached descriptions and
refreshes open pages. Disconnect, re-pair and reconnect also invalidate descriptions.
Background event matching retains bounded per-frame canonical interests, without
rediscovering every tab on each download progress event.

## Collection and cancellation

The user must initiate gallery collection. Bundled collectors enforce a maximum
of 50 items and bounded navigation, wait and restoration times. They honor explicit
user image-source preferences, validate the current page and do not evaluate
provider-supplied code. Before and after collection, the extension asks Desktop to confirm
the provider version, page identity and gallery configuration. Lifecycle changes cancel in-flight collection; cancellation
does not click controls to restore a page belonging to another provider state.
Failure returns an error rather than silently downloading a truncated gallery.

Offline or incompatible Desktop retains generic capture; provider-specific
features require a connected Desktop with the relevant plugin enabled. This
does not install a provider implicitly.

## Regression coverage

Browser characterization tests retain the original URL/identity cases. Generic
collector tests retain the existing page fixtures and add unknown-provider,
cancellation, malformed-selector, size and timeout cases. Desktop native tests
install real sealed packages and verify matching, dependency availability,
disable/remove/update/rollback and malformed descriptors. Bridge tests cover
bounded metadata, stale responses, event routing and pairing isolation.
