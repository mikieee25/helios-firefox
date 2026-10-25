# Helios Firefox privacy statement

Helios Firefox sends information only to the Helios desktop app running on the same computer. The extension contacts the app through its loopback bridge at `127.0.0.1` (ports 16780–16789); it does not send information to the developer or any remote server.

Firefox declares page URLs and the fact that you downloaded something as required `browsingActivity` and `websiteActivity` data. To hand off a download, the extension sends its URL, referrer and file name when available, plus that a download was requested, to Helios on this computer. Cookies and browser details (including the user agent) are optional `websiteContent`; they are read and sent only when you enable **Send login cookies and browser details to Helios** and grant Firefox's permission. These details let Helios download files that require your login. Without that permission, the extension sends only the URL, referrer and file name and does not read cookies or send the user agent.

The extension stores its settings, pairing token, and recent transfer labels in the Firefox browser profile. It does not store data elsewhere. Helios may store received download details and downloaded files according to its own behavior and settings. The extension has no analytics, tracking pixels, or remote service calls.

Interception is off until you accept the first-use notice and separately enable interception. You can revoke the cookie permission in extension options or Firefox's add-on permissions, forget the Helios pairing, or turn interception off at any time.
