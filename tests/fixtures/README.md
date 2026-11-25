The credential-free production Worker fixture is built from Hesari-Os 5.1.3,
revision `eedb8c2976f11e9b1848e46fd5b448b17f7f07cf`. See `panel-reference.json`
for provenance and the compressed fixture's SHA-256. It contains the real panel,
authentication, subscription generators, settings save and update handlers.
The fixture is gzipped to keep the repository small. No account token is included.

To refresh, check out the intended Panel revision in a separate checkout, install
its dependencies and run `npm run build` there, then run from Wizard:

```sh
node scripts/update-panel-fixture.mjs /path/to/Hesari-Os
```

The helper refuses configured bundles and checks that `shared/worker-bundle.js`
and its types match Panel. Review the Go wire implementation when the contract
changes. Re-run `npm test` and `go test ./...` after refreshing. Independent Panel
builds generate different release identifiers, so fixture bytes can differ.

The runtime tests use the actual uploads produced by both Wizard clients and
bind only each upload's random KV name. They restart the rebuilt Worker against
the same local KV database after settings save and panel update. Only provider
HTTP requests are mocked; no live Cloudflare resources are created.
