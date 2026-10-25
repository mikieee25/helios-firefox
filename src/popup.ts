import { bridgeClient, bridgeErrorGuidance, type BridgeError } from "./bridge";
import { getRecentSent } from "./sent";
import { getSettings, isPaired, updateSettings } from "./settings";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connection = byId<HTMLParagraphElement>("connection");
const statusDot = byId<HTMLSpanElement>("status-dot");
const error = byId<HTMLParagraphElement>("error");
const allowLoopback = byId<HTMLButtonElement>("allow-loopback");
const diagnosticsOrigin = byId<HTMLParagraphElement>("diagnostics-origin");
const diagnosticsPorts = byId<HTMLOListElement>("diagnostics-ports");
const pairHelp = byId<HTMLAnchorElement>("pair-help");
const interception = byId<HTMLInputElement>("interception");
const recent = byId<HTMLOListElement>("recent");

void refresh();

async function refresh(): Promise<void> {
  const [settings, paired, items] = await Promise.all([getSettings(), isPaired(), getRecentSent()]);
  interception.checked = settings.interceptionEnabled;
  interception.disabled = !settings.consentAccepted || !paired;
  recent.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item.label;
    const detail = document.createElement("small");
    detail.textContent = item.result === "error" ? "Could not send" : new Date(item.at).toLocaleTimeString();
    row.append(label, detail);
    recent.append(row);
  }

  if (!paired) {
    const result = await bridgeClient.ping();
    if (result.ok) {
      connection.textContent = `Helios ${result.value.version} · Not paired`;
      statusDot.className = "status-dot online";
      clearError();
    } else {
      connection.textContent = "Could not connect to Helios";
      statusDot.className = "status-dot offline";
      showBridgeError(result.error);
    }
    pairHelp.hidden = false;
    return;
  }

  const result = await bridgeClient.status();
  if (result.ok) {
    connection.textContent = `Connected · Helios ${result.value.version}`;
    statusDot.className = "status-dot online";
    clearError();
    pairHelp.hidden = true;
  } else {
    connection.textContent = "Could not connect to Helios";
    statusDot.className = "status-dot offline";
    showBridgeError(result.error);
    pairHelp.hidden = result.error.code !== "unauthorized" && result.error.code !== "bad_code";
  }
}

function showBridgeError(bridgeError: BridgeError): void {
  const guidance = bridgeErrorGuidance(bridgeError);
  error.textContent = `${guidance.message} ${guidance.nextStep}`;
  error.hidden = false;
  allowLoopback.hidden = bridgeError.code !== "no_host_permission";
}

function clearError(): void {
  error.hidden = true;
  error.textContent = "";
  allowLoopback.hidden = true;
}

interception.addEventListener("change", () => {
  void updateSettings({ interceptionEnabled: interception.checked }).then(refresh);
});
byId<HTMLButtonElement>("open-options").addEventListener("click", () => void browser.runtime.openOptionsPage());
byId<HTMLButtonElement>("open-helios").addEventListener("click", () => {
  void (async () => {
    const result = await bridgeClient.show();
    if (result.ok) clearError();
    else showBridgeError(result.error);
  })();
});
allowLoopback.addEventListener("click", () => {
  void (async () => {
    const result = await bridgeClient.requestHostPermission();
    if (result.ok) {
      clearError();
      await refresh();
    } else showBridgeError(result.error);
  })();
});
byId<HTMLButtonElement>("run-diagnostics").addEventListener("click", () => {
  void (async () => {
    diagnosticsPorts.replaceChildren();
    const result = await bridgeClient.diagnose();
    if (!result.ok) {
      showBridgeError(result.error);
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
  })();
});
pairHelp.addEventListener("click", (event) => {
  event.preventDefault();
  void browser.runtime.openOptionsPage();
});
