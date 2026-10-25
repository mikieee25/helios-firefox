# Helios Firefox

Firefox extension that sends downloads to the Helios desktop app over its loopback-only browser bridge.

## Install and pair

1. Install and open Helios desktop.
2. In Firefox, install the signed Helios Download Bridge add-on, or run this project temporarily with `npm run web-ext:run`.
3. Open the extension options and choose **Pair with Helios**.
4. In Helios, open **Settings → Browser integration → Pair a browser**. Enter the six-digit code in the extension before it expires.
5. Accept the first-use privacy notice. Turn on interception only if you want matching downloads sent automatically.

The extension searches `127.0.0.1` ports 16780–16789 for Helios. It stores the pairing token in Firefox `storage.local`; the token is never logged. Forget the pairing in options to remove it.

## How interception works and its limits

With consent and interception enabled, the extension checks eligible successful `GET` responses in top-level pages, frames and object responses. It sends attachments and binary file responses at or above the configured minimum to Helios. The default minimum is 5 MB. It skips private windows, extension-originated requests, text pages, inline PDF/media, configured exclusions and built-in sensitive domains/suffixes (`.bank`, `.payments`, `.gov`, `.gob`, `.gov.uk`, `.gov.au`, `.gov.ph`, `.mil`, plus several major payment and bank domains).

Interception cannot recover one-use URLs after the first request is cancelled, and it cannot capture downloads initiated with `POST` or content protected by DRM. Some sites also require additional request state beyond cookies and referrer. If a transfer hand-off fails, **Fall back to the browser** replays the URL once through Firefox downloads; this is on by default.

The context menu can send links, images, audio/video sources, and selected magnet links manually. **Ask before adding** opens Helios’s Add dialog instead of starting immediately.

## Permissions

- `storage`: save extension preferences, recent transfer labels and the bridge token locally in Firefox.
- `downloads`: replay an intercepted URL in Firefox if the Helios hand-off fails and fallback is enabled.
- `cookies`: permits cookie access for download URLs. Values are read and sent only if Firefox's optional `websiteContent` data permission is granted and **Send login cookies and browser details to Helios** is enabled.
- `contextMenus`: add **Download with Helios** to links, images, audio/video, and selected text.
- `notifications`: show transfer success and failure notices when enabled in options.
- `webRequest`: inspect response method, status, URL, type and headers to identify eligible file downloads.
- `webRequestBlocking`: cancel a matching response before it reaches the page so it can be handed to Helios. The minimum supported version is Firefox 140.
- `<all_urls>` host access: inspect eligible responses and read cookies for download URLs on sites the user visits. The extension sends requests only to Helios at `127.0.0.1`; it has no analytics or remote-service calls.
- Firefox `browsingActivity` and `websiteActivity` data permissions: disclose page/download URLs and the fact that a download was requested. Optional `websiteContent`: request separately before sending cookies and browser details.

## Privacy

See [PRIVACY.md](PRIVACY.md) for the privacy statement, also suitable for the AMO listing's privacy policy field. Required `browsingActivity` and `websiteActivity` data covers page URLs and the fact that you downloaded something. Download URLs, referrers, and file names are sent to the Helios desktop app over loopback at `127.0.0.1`. Optional `websiteContent` covers cookies and browser details; these are read and sent only when Firefox grants that permission and **Send login cookies and browser details to Helios** is enabled. Without it, the extension does not read cookies or send a user agent. The app may store data it receives; the extension itself stores preferences, pairing credentials, and recent transfer labels in the Firefox profile. Nothing is sent to the developer or a remote server. There is no analytics.

The first-use consent screen describes these data types and destinations. Interception remains off until consent is accepted and separately enabled. Cookies and pairing tokens are not logged or included in transfer history.

## Development

Requires Node.js 22 or later.

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run web-ext:lint
npm run web-ext:run
```

`npm run web-ext:build` creates a distributable ZIP in `web-ext-artifacts/`.

## Signing for AMO

Create a free Firefox Add-ons account and submit the extension for listing, or choose self-distribution if it should not appear in the AMO listing. Mozilla must sign Firefox add-ons for normal release-channel installation in either case. For an automated upload, create AMO API credentials, keep them out of the repository, then run:

```sh
npx web-ext sign --channel=listed --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"
```

For a signed, self-distributed package, use `--channel=unlisted`. Review the signed package and its listing or distribution details in AMO before sharing it.

## Known audit findings

`npm audit --omit=dev` is clean. The full audit reports a high-severity `node-forge` issue through `web-ext` → `@devicefarmer/adbkit`; these are development-only dependencies and are not included in the built extension. npm currently lists no patched `node-forge` 1.x release (the advisory covers versions through 1.4.0), so no override is applied. `npm audit` suggests downgrading `web-ext` to 5.1.0; this project keeps its current web-ext version.

## License

MIT. See [LICENSE](LICENSE).
