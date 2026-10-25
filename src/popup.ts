import { bridgeClient } from "./bridge";
import { getRecentSent } from "./sent";
import { getSettings, isPaired, updateSettings } from "./settings";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connection = byId<HTMLParagraphElement>("connection");
const statusDot = byId<HTMLSpanElement>("status-dot");
const error = byId<HTMLParagraphElement>("error");
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
    try {
      const ping = await bridgeClient.ping();
      connection.textContent = `Helios ${ping.version} · Not paired`;
      statusDot.className = "status-dot online";
    } catch {
      connection.textContent = "Helios is not reachable · Not paired";
      statusDot.className = "status-dot offline";
    }
    error.textContent = "Pair this extension with Helios to start sending downloads.";
    error.hidden = false;
    pairHelp.hidden = false;
    return;
  }
  try {
    const status = await bridgeClient.status();
    connection.textContent = `Connected · Helios ${status.version}`;
    statusDot.className = "status-dot online";
    error.hidden = true;
    pairHelp.hidden = true;
  } catch {
    connection.textContent = "Helios is not reachable";
    statusDot.className = "status-dot offline";
    error.textContent = "Start Helios to send downloads.";
    error.hidden = false;
    pairHelp.hidden = true;
  }
}

interception.addEventListener("change", () => {
  void updateSettings({ interceptionEnabled: interception.checked }).then(refresh);
});
byId<HTMLButtonElement>("open-options").addEventListener("click", () => void browser.runtime.openOptionsPage());
byId<HTMLButtonElement>("open-helios").addEventListener("click", () => {
  void bridgeClient.show().catch(() => {
    error.textContent = "Could not open Helios. Check that the desktop app is running.";
    error.hidden = false;
  });
});
pairHelp.addEventListener("click", (event) => {
  event.preventDefault();
  void browser.runtime.openOptionsPage();
});
