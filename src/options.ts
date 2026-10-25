import { bridgeClient, bridgeErrorGuidance, BridgeError } from "./bridge";
import { WEBSITE_CONTENT, cookiePermissionState, type CookiePermissionApi } from "./cookie-permissions";
import { getSettings, isPaired, updateSettings } from "./settings";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = byId<HTMLFormElement>("pair-form");
const pairCode = byId<HTMLInputElement>("pair-code");
const pairStatus = byId<HTMLParagraphElement>("pair-status");
const bridgeStatus = byId<HTMLParagraphElement>("bridge-status");
const pairError = byId<HTMLParagraphElement>("pair-error");
const allowLoopback = byId<HTMLButtonElement>("allow-loopback");
const diagnosticsOrigin = byId<HTMLParagraphElement>("diagnostics-origin");
const diagnosticsPorts = byId<HTMLOListElement>("diagnostics-ports");
const diagnosticsSummary = byId<HTMLParagraphElement>("diagnostics-summary");
const diagnosticsGuidance = byId<HTMLUListElement>("diagnostics-guidance");
const diagnosticsError = byId<HTMLParagraphElement>("diagnostics-error");
const diagnosticsAllowLoopback = byId<HTMLButtonElement>("diagnostics-allow-loopback");
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
  const bridge = await bridgeClient.ping();
  if (bridge.ok) {
    bridgeStatus.textContent = paired
      ? `Local bridge connected · Helios ${bridge.value.version}`
      : `Helios ${bridge.value.version} is running. Enter a pairing code to connect this add-on.`;
    pairError.hidden = true;
    allowLoopback.hidden = true;
  } else {
    showBridgeError(bridgeStatus, allowLoopback, bridge.error);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void pair();
});

async function pair(): Promise<void> {
  pairError.hidden = true;
  allowLoopback.hidden = true;
  if (!/^\d{6}$/.test(pairCode.value)) {
    pairError.textContent = "Enter the six-digit code shown in Helios Settings.";
    pairError.hidden = false;
    return;
  }
  const platform = await browser.runtime.getPlatformInfo();
  const result = await bridgeClient.pair(pairCode.value, `Firefox on ${platform.os}`);
  if (!result.ok) {
    showBridgeError(pairError, allowLoopback, result.error);
    return;
  }
  pairStatus.textContent = `Paired · Helios ${result.value.version}`;
  pairCode.value = "";
  await loadOptions();
}

function showBridgeError(element: HTMLParagraphElement, allowButton: HTMLButtonElement, error: BridgeError): void {
  const guidance = bridgeErrorGuidance(error);
  element.textContent = `${guidance.message} ${guidance.nextStep}`;
  element.hidden = false;
  allowButton.hidden = error.code !== "no_host_permission";
}

forgetButton.addEventListener("click", () => {
  void (async () => {
    const result = await bridgeClient.forget();
    if (!result.ok) {
      showBridgeError(pairError, allowLoopback, result.error);
      return;
    }
    await updateSettings({ interceptionEnabled: false });
    await loadOptions();
    pairStatus.textContent = "Pairing removed";
  })();
});

allowLoopback.addEventListener("click", () => void requestLoopbackAccess(pairError, allowLoopback));
diagnosticsAllowLoopback.addEventListener("click", () => void requestLoopbackAccess(diagnosticsError, diagnosticsAllowLoopback));
byId<HTMLButtonElement>("run-diagnostics").addEventListener("click", () => void runDiagnostics());

async function requestLoopbackAccess(target: HTMLParagraphElement, button: HTMLButtonElement): Promise<void> {
  const result = await bridgeClient.requestHostPermission();
  if (!result.ok) {
    showBridgeError(target, button, result.error);
    return;
  }
  target.textContent = "Loopback access granted. Try the connection again.";
  target.hidden = false;
  button.hidden = true;
}

async function runDiagnostics(): Promise<void> {
  diagnosticsPorts.replaceChildren();
  diagnosticsSummary.hidden = true;
  diagnosticsSummary.textContent = "";
  diagnosticsGuidance.replaceChildren();
  diagnosticsError.hidden = true;
  diagnosticsAllowLoopback.hidden = true;
  const result = await bridgeClient.diagnose();
  if (!result.ok) {
    showBridgeError(diagnosticsError, diagnosticsAllowLoopback, result.error);
    return;
  }
  diagnosticsOrigin.textContent = `Extension origin: ${result.value.extensionOrigin}`;
  for (const port of result.value.ports) {
    const row = document.createElement("li");
    row.textContent = port.error
      ? `${port.port}: ${port.kind ?? "unknown"}${port.status === undefined ? "" : ` · HTTP ${port.status}`} · ${port.message ?? port.error}`
      : `${port.port}: HTTP ${port.status} · ${port.message ?? "Helios responded."}`;
    diagnosticsPorts.append(row);
  }
  const reachablePorts = result.value.ports.filter((port) => !port.error && port.status === 200).map((port) => port.port);
  if (reachablePorts.length) {
    diagnosticsSummary.textContent = `Helios responded on port${reachablePorts.length === 1 ? "" : "s"} ${reachablePorts.join(", ")}. Timeouts on other ports are expected when nothing is listening there.`;
    diagnosticsSummary.hidden = false;
    return;
  }
  const errorCodes = [...new Set(result.value.ports.flatMap((port) => port.error ? [port.error] : []))];
  for (const code of errorCodes) {
    const port = result.value.ports.find((entry) => entry.error === code);
    const guidance = bridgeErrorGuidance(new BridgeError(port?.kind ?? "client", port?.message ?? code, code, port?.status));
    const row = document.createElement("li");
    row.textContent = `${guidance.message} ${guidance.nextStep}`;
    diagnosticsGuidance.append(row);
  }
  diagnosticsAllowLoopback.hidden = !errorCodes.includes("no_host_permission");
}

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
