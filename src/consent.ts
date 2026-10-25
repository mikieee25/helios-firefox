import { updateSettings } from "./settings";

document.getElementById("accept-consent")?.addEventListener("click", () => {
  void (async () => {
    await updateSettings({ consentAccepted: true });
    await browser.runtime.openOptionsPage();
    const tab = await browser.tabs.getCurrent();
    if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
  })();
});

document.getElementById("decline-consent")?.addEventListener("click", () => {
  void browser.tabs.getCurrent().then((tab) => {
    if (tab?.id !== undefined) return browser.tabs.remove(tab.id);
  });
});
