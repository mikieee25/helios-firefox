import { createAddItem, getInterceptTimings, registerInterception, sendFromMenu } from "./intercept";
import { DEFAULT_SETTINGS, getSettings } from "./settings";

registerInterception();

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "helios:intercept-timings") return Promise.resolve(getInterceptTimings());
  return undefined;
});

browser.runtime.onInstalled.addListener(async (details) => {
  const saved = await browser.storage.local.get("settings");
  if (!saved.settings) await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  await createContextMenu();
  if (details.reason === "install") {
    const settings = await getSettings();
    if (!settings.consentAccepted)
      await browser.tabs.create({ url: browser.runtime.getURL("consent.html") });
  }
});

browser.runtime.onStartup.addListener(() => void createContextMenu());

browser.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    const url = info.linkUrl ?? info.srcUrl ?? magnetFromSelection(info.selectionText ?? "");
    if (!url || !isAllowedUrl(url)) return;
    const settings = await getSettings();
    const item = await createAddItem(url, info.pageUrl ?? tab?.url, undefined, settings);
    await sendFromMenu(item, settings);
  })().catch(async () => {
    await browser.action.setBadgeText({ text: "!" });
  });
});

async function createContextMenu(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: "helios-download",
    title: "Download with Helios",
    contexts: ["link", "image", "video", "audio", "selection"],
  });
}

function magnetFromSelection(text: string): string | undefined {
  return text.match(/magnet:\?[^\s<>"']+/i)?.[0];
}

function isAllowedUrl(value: string): boolean {
  try {
    return ["http:", "https:", "ftp:", "magnet:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
