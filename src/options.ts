import { bridgeClient } from "./bridge";
import { WEBSITE_CONTENT, cookiePermissionState, type CookiePermissionApi } from "./cookie-permissions";
import { getSettings, isPaired, updateSettings } from "./settings";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = byId<HTMLFormElement>("pair-form");
const pairCode = byId<HTMLInputElement>("pair-code");
const pairStatus = byId<HTMLParagraphElement>("pair-status");
const pairError = byId<HTMLParagraphElement>("pair-error");
const forgetButton = byId<HTMLButtonElement>("forget-pairing");
const consentCard = byId<HTMLElement>("consent");
const interceptToggle = byId<HTMLInputElement>("interception");
const minimumSize = byId<HTMLInputElement>("minimum-size");
const excludeHosts = byId<HTMLTextAreaElement>("exclude-hosts");
const askBefore = byId<HTMLInputElement>("ask-before-adding");
const fallback = byId<HTMLInputElement>("fallback");
const notifications = byId<HTMLInputElement>("notifications");
const sendCookiesToggle = byId<HTMLInputElement>("send-cookies");
const sendCookiesStatus = byId<HTMLParagraphElement>("send-cookies-status");
const saveStatus = byId<HTMLParagraphElement>("save-status");
const cookiePermissions = browser.permissions as unknown as CookiePermissionApi;
// Fail closed until loadOptions confirms that Firefox lacks the data-collection API.
let hasCookiePermissionApi = true;

void loadOptions();

async function loadOptions(): Promise<void> {
  const [settings, paired] = await Promise.all([getSettings(), isPaired()]);
  let cookiePermission: boolean | undefined;
  try {
    cookiePermission = await cookiePermissionState(cookiePermissions);
    hasCookiePermissionApi = cookiePermission !== undefined;
  } catch {
    cookiePermission = false;
    hasCookiePermissionApi = true;
  }
  consentCard.hidden = settings.consentAccepted;
  interceptToggle.checked = settings.interceptionEnabled;
  interceptToggle.disabled = !settings.consentAccepted || !paired;
  minimumSize.value = String(settings.minimumSizeMB);
  excludeHosts.value = settings.excludeHosts.join("\n");
  askBefore.checked = settings.askBeforeAdding;
  fallback.checked = settings.fallbackToBrowser;
  notifications.checked = settings.notifications;
  sendCookiesToggle.checked = cookiePermission ?? settings.sendCookies;
  sendCookiesToggle.disabled = !settings.consentAccepted;
  sendCookiesStatus.textContent = settings.consentAccepted
    ? ""
    : "Accept the first-use privacy notice before enabling login cookies.";
  pairStatus.textContent = paired ? "Paired with Helios" : "Not paired";
  byId<HTMLElement>("pair-dot").className = `status-dot ${paired ? "online" : "offline"}`;
  forgetButton.hidden = !paired;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void pair();
});

async function pair(): Promise<void> {
  pairError.hidden = true;
  if (!/^\d{6}$/.test(pairCode.value)) {
    showPairError("Enter the six-digit code shown in Helios Settings.");
    return;
  }
  try {
    const platform = await browser.runtime.getPlatformInfo();
    const result = await bridgeClient.pair(pairCode.value, `Firefox on ${platform.os}`);
    pairStatus.textContent = `Paired · Helios ${result.version}`;
    pairCode.value = "";
    await loadOptions();
  } catch (error) {
    showPairError(error instanceof Error ? error.message : "Pairing failed. Check the code and try again.");
  }
}

function showPairError(message: string): void {
  pairError.textContent = message;
  pairError.hidden = false;
}

forgetButton.addEventListener("click", () => {
  void (async () => {
    await bridgeClient.forget();
    await updateSettings({ interceptionEnabled: false });
    await loadOptions();
    pairStatus.textContent = "Pairing removed";
  })();
});

byId<HTMLButtonElement>("accept-consent").addEventListener("click", () => {
  void (async () => {
    await updateSettings({ consentAccepted: true });
    await loadOptions();
  })();
});

interceptToggle.addEventListener("change", () => void save({ interceptionEnabled: interceptToggle.checked }));
minimumSize.addEventListener("change", () => {
  const value = Number(minimumSize.value);
  if (!Number.isFinite(value) || value < 0) {
    minimumSize.value = "5";
    void save({ minimumSizeMB: 5 });
  } else void save({ minimumSizeMB: Math.min(value, 1024 * 1024) });
});
excludeHosts.addEventListener("change", () => void save({ excludeHosts: excludeHosts.value.split(/[\n,]+/).map((host) => host.trim().toLowerCase()).filter(Boolean) }));
askBefore.addEventListener("change", () => void save({ askBeforeAdding: askBefore.checked }));
fallback.addEventListener("change", () => void save({ fallbackToBrowser: fallback.checked }));
notifications.addEventListener("change", () => void save({ notifications: notifications.checked }));
sendCookiesToggle.addEventListener("click", () => {
  if (sendCookiesToggle.checked) void enableLoginCookies();
  else void disableLoginCookies();
});

async function enableLoginCookies(): Promise<void> {
  if (!hasCookiePermissionApi) {
    await saveCookieSetting(true, "Enabled using this extension's local setting.");
    return;
  }
  try {
    const request = cookiePermissions.request?.(WEBSITE_CONTENT);
    if (!request) throw new Error("Permission request unavailable");
    const granted = await request;
    if (!granted) {
      sendCookiesToggle.checked = false;
      sendCookiesStatus.textContent = "Firefox did not grant permission to send cookies and browser details.";
      return;
    }
    await saveCookieSetting(true, "Firefox granted permission to send cookies and browser details to Helios.");
  } catch {
    sendCookiesToggle.checked = false;
    sendCookiesStatus.textContent = "Could not request Firefox permission for cookies and browser details.";
  }
}

async function disableLoginCookies(): Promise<void> {
  try {
    if (hasCookiePermissionApi) {
      const removed = await cookiePermissions.remove?.(WEBSITE_CONTENT);
      if (removed === false && await cookiePermissionState(cookiePermissions)) {
        sendCookiesToggle.checked = true;
        sendCookiesStatus.textContent = "Firefox did not remove the website-content permission.";
        return;
      }
    }
    await saveCookieSetting(false, "Login cookies will not be sent to Helios.");
  } catch {
    sendCookiesToggle.checked = true;
    sendCookiesStatus.textContent = "Could not remove Firefox permission for cookies and browser details.";
  }
}

async function saveCookieSetting(enabled: boolean, message: string): Promise<void> {
  try {
    await updateSettings({ sendCookies: enabled });
    sendCookiesToggle.checked = enabled;
    sendCookiesStatus.textContent = message;
  } catch {
    sendCookiesToggle.checked = !enabled;
    sendCookiesStatus.textContent = "Could not save the login-cookie setting.";
  }
}

async function save(patch: Parameters<typeof updateSettings>[0]): Promise<void> {
  try {
    await updateSettings(patch);
    saveStatus.textContent = "Settings saved";
  } catch {
    saveStatus.textContent = "Settings could not be saved";
  }
}
