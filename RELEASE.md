# HESARI OS Wizard — next release

Support the format-1 Worker bundles and per-installation runtime profiles used by HESARI OS 5.1.3.

- Generate cryptographically random KV and global identifiers for each independent installation in both web and CLI clients.
- Embed account settings under the profile's random config key and deploy with exactly that profile's KV binding on both Workers and Pages.
- Preserve Panel's bootstrap metadata, assets and renamed gzip source so settings saves and updates retain identifiers and existing KV data.
- Reject incompatible bundles, mismatched outer/compressed source and corrupt assets before upload, using errors that do not echo credentials.
- Supply the explicit `_worker.js` filename and module MIME type for CLI Pages uploads.
- Exercise all four real uploads locally: authentication, VLESS/Trojan subscriptions, settings-save and update rebuilds, and restart against the same KV database.

Before publishing: release a compatible Panel `worker.js`, choose the Wizard patch version in `VERSION` and npm metadata, run the README checks, build CLI archives and checksums, then publish the Wizard release and deploy the web edition. Tests simulate Cloudflare and do not create live resources.
