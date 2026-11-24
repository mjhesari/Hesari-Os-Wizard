# HESARI OS Wizard v3.1.0

Install HESARI OS directly on Cloudflare Workers or Pages with a web interface matching the HESARI OS workspace.

- Use HESARI OS releases for panel downloads and this repository for Wizard binaries.
- Share the panel's navy/teal theme, Vazirmatn typeface, H monogram, and sidebar navigation.
- Show live deployment progress, installation results, private installer links, and platform-specific terminal commands.
- Keep new private-link credentials in URL fragments and installation POST bodies; require a configured encryption secret.
- Fix fresh-account Workers URLs, Pages name checks, failed-request reporting, account selection, and token-store error handling.
- Generate CLI credentials with cryptographically secure randomness.
- Verify CLI archive checksums and stop on failed or empty downloads.
- Add API, encryption, installer, Go, and desktop/mobile browser tests, plus a ready-to-enable test and release workflow template.

Terminal install commands and web deployment instructions are in the README. Tests simulate Cloudflare and do not create live resources.
