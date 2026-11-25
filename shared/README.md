`worker-bundle.js` and `worker-bundle.d.ts` are copied verbatim from
`mjhesari/Hesari-Os/src/common/` at revision
`eedb8c2976f11e9b1848e46fd5b448b17f7f07cf` (GPL-3.0).

Keep these files in sync with Panel's format-1 contract. Wizard's additional
input checks live in `web/src/bundle.ts`; the Go counterpart is
`internal/bundle.go`. The runtime fixture verifies interoperability with Panel's
own settings-save and update paths. Never prepend code or comments before the
bundle bootstrap, or rename only the outer source.
