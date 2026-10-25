import { bridgeClient, type AddItem } from "./bridge";
import { filenameFromHeaders, type Header } from "./filename";
import { ignoreSet } from "./ignore";
import { maySendWebsiteContent, type CookiePermissionApi } from "./cookie-permissions";
import { getSettings, isPaired } from "./settings";
import { recordSent } from "./sent";

export interface InterceptDetails {
  url: string;
  method: string;
  tabId: number;
  type: string;
  statusCode: number;
  responseHeaders?: Header[] | undefined;
  originUrl?: string | undefined;
  documentUrl?: string | undefined;
  initiator?: string | undefined;
  incognito?: boolean | undefined;
  ignored?: boolean | undefined;
}

export interface InterceptSettings {
  consentAccepted: boolean;
  interceptionEnabled: boolean;
  paired: boolean;
  minimumSizeMB: number;
  excludeHosts: string[];
}

const SENSITIVE_HOSTS = [
  "bank", "payments", "gov", "gob", "gov.uk", "gov.au", "gov.ph", "mil",
  "paypal.com", "stripe.com", "wise.com", "chase.com", "bankofamerica.com", "wellsfargo.com",
];
const PRIVATE_TYPES = ["application/pdf"];
const NON_BINARY_TYPES = ["text/", "application/javascript", "application/x-www-form-urlencoded", "image/svg+xml"];
const OMITTED_EXTENSION_HOSTS = ["moz-extension://", "chrome-extension://"];

function headerValue(headers: Header[], name: string): string | undefined {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function isExcludedHost(host: string, exclusions: string[]): boolean {
  const entries = [...SENSITIVE_HOSTS, ...exclusions];
  return entries.some((entry) => {
    const suffix = entry.trim().toLowerCase().replace(/^\*\./, "").replace(/^\./, "");
    return suffix && (host === suffix || host.endsWith(`.${suffix}`));
  });
}

function isDownloadType(contentType: string | undefined, attachment: boolean): boolean {
  if (attachment) return true;
  if (!contentType) return false;
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mime.includes("json") || mime.includes("xml") || PRIVATE_TYPES.includes(mime)) return false;
  if (["image/", "video/", "audio/"].some((prefix) => mime.startsWith(prefix))) return false;
  if (NON_BINARY_TYPES.some((prefix) => mime.startsWith(prefix))) return false;
  return mime.startsWith("application/") || mime.startsWith("font/") || mime.startsWith("model/") || mime === "application/octet-stream";
}

export function shouldIntercept(details: InterceptDetails, settings: InterceptSettings): boolean {
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }
  if (!settings.consentAccepted || !settings.interceptionEnabled || !settings.paired || details.ignored) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (!["main_frame", "sub_frame", "object"].includes(details.type)) return false;
  if (details.method !== "GET" || details.statusCode < 200 || details.statusCode >= 300 || details.tabId < 0 || details.incognito) return false;
  if ([details.originUrl, details.documentUrl, details.initiator].some((origin) => origin && OMITTED_EXTENSION_HOSTS.some((prefix) => origin.startsWith(prefix)))) return false;
  if (isExcludedHost(url.hostname.toLowerCase(), settings.excludeHosts)) return false;

  const headers = details.responseHeaders ?? [];
  const disposition = headerValue(headers, "content-disposition") ?? "";
  const attachment = /^\s*attachment(?:\s*;|\s*$)/i.test(disposition);
  if (!isDownloadType(headerValue(headers, "content-type"), attachment)) return false;
  const rawLength = headerValue(headers, "content-length")?.trim();
  const length = rawLength ? Number(rawLength) : Number.NaN;
  return !Number.isFinite(length) || length < 0 || length >= settings.minimumSizeMB * 1024 * 1024;
}

export function registerInterception(): void {
  browser.webRequest.onHeadersReceived.addListener(
    async (details) => {
      try {
        const settings = await getSettings();
        if (!settings.consentAccepted || !settings.interceptionEnabled || !(await isPaired())) return {};
        const ignored = ignoreSet.has(details.url);
        const candidate = { ...details, incognito: false, ignored };
        if (!shouldIntercept(candidate, { ...settings, paired: true })) return {};
        const tab = await browser.tabs.get(details.tabId).catch(() => undefined);
        if (!tab || tab.incognito) return {};
        candidate.incognito = tab.incognito;
        if (!(await bridgeClient.isHealthy())) return {};
        setTimeout(() => void transferIntercepted(candidate, settings), 0);
        return { cancel: true };
      } catch {
        return {};
      }
    },
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame", "object"] },
    ["blocking", "responseHeaders"]
  );
}

export async function createAddItem(
  url: string,
  referrer: string | undefined,
  filename: string | undefined,
  settings: Awaited<ReturnType<typeof getSettings>>,
  permissions: CookiePermissionApi = browser.permissions as unknown as CookiePermissionApi,
  readCookies: (url: string) => Promise<Array<{ name: string; value: string }>> = (value) => browser.cookies.getAll({ url: value })
): Promise<AddItem> {
  const scheme = safeScheme(url);
  const maySendDetails = await maySendWebsiteContent(settings.consentAccepted, settings.sendCookies, permissions);
  const cookies = maySendDetails && (scheme === "http:" || scheme === "https:")
    ? await readCookies(url)
    : [];
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  return {
    url,
    ...(referrer ? { referrer } : {}),
    ...(maySendDetails ? { userAgent: navigator.userAgent } : {}),
    ...(cookie ? { cookie } : {}),
    ...(filename ? { filename } : {}),
  };
}

export async function addWithCookiePermission(
  mode: "start" | "ask",
  item: AddItem,
  settings: Awaited<ReturnType<typeof getSettings>>,
  permissions: CookiePermissionApi = browser.permissions as unknown as CookiePermissionApi,
  add: (mode: "start" | "ask", items: AddItem[]) => Promise<unknown> = (selectedMode, items) => bridgeClient.add(selectedMode, items)
): Promise<unknown> {
  let safeItem = item;
  if ((item.cookie || item.userAgent) && !(await maySendWebsiteContent(settings.consentAccepted, settings.sendCookies, permissions))) {
    const { cookie: _cookie, userAgent: _userAgent, ...withoutBrowserDetails } = item;
    safeItem = withoutBrowserDetails;
  }
  return add(mode, [safeItem]);
}

async function transferIntercepted(details: InterceptDetails, settings: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  const filename = filenameFromHeaders(details.responseHeaders);
  const label = filename ?? safeHost(details.url);
  try {
    const item = await createAddItem(details.url, details.originUrl ?? details.documentUrl, filename, settings);
    await addWithCookiePermission(settings.askBeforeAdding ? "ask" : "start", item, settings);
  } catch {
    await recordQuietly(label, "start", "error");
    await setErrorBadge().catch(() => {});
    if (settings.fallbackToBrowser) {
      ignoreSet.add(details.url);
      try {
        await browser.downloads.download({ url: details.url, ...(filename ? { filename } : {}) });
        await recordQuietly(label, "browser", "sent");
      } catch {
        await notify(settings.notifications, "Helios could not add this download, and the browser fallback failed.").catch(() => {});
      }
    } else {
      await notify(settings.notifications, "Helios could not add this download.").catch(() => {});
    }
    return;
  }
  await recordQuietly(label, settings.askBeforeAdding ? "ask" : "start", "sent");
  await notify(settings.notifications, `Added: ${label}`).catch(() => {});
  await clearErrorBadge().catch(() => {});
}

export async function sendFromMenu(item: AddItem, settings: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  const mode = settings.askBeforeAdding ? "ask" : "start";
  const label = item.filename ?? safeHost(item.url);
  try {
    await addWithCookiePermission(mode, item, settings);
  } catch {
    await recordQuietly(label, mode, "error");
    await setErrorBadge().catch(() => {});
    await notify(settings.notifications, "Could not send this download to Helios.").catch(() => {});
    return;
  }
  await recordQuietly(label, mode, "sent");
  await notify(settings.notifications, `Added: ${label}`).catch(() => {});
  await clearErrorBadge().catch(() => {});
}

export function safeHost(url: string): string {
  try { return new URL(url).hostname || "magnet download"; } catch { return "magnet download"; }
}

function safeScheme(url: string): string {
  try { return new URL(url).protocol; } catch { return ""; }
}

async function notify(enabled: boolean, message: string): Promise<void> {
  if (!enabled) return;
  await browser.notifications.create({ type: "basic", iconUrl: "icon.svg", title: "Helios", message });
}

async function recordQuietly(label: string, mode: "start" | "ask" | "browser", result: "sent" | "error"): Promise<void> {
  await recordSent(label, mode, result).catch(() => {});
}

async function setErrorBadge(): Promise<void> { await browser.action.setBadgeText({ text: "!" }); }
async function clearErrorBadge(): Promise<void> { await browser.action.setBadgeText({ text: "" }); }
