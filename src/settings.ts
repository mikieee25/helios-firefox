export interface ExtensionSettings {
  consentAccepted: boolean;
  interceptionEnabled: boolean;
  minimumSizeMB: number;
  excludeHosts: string[];
  askBeforeAdding: boolean;
  fallbackToBrowser: boolean;
  notifications: boolean;
  sendCookies: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  consentAccepted: false,
  interceptionEnabled: false,
  minimumSizeMB: 5,
  excludeHosts: [],
  askBeforeAdding: false,
  fallbackToBrowser: true,
  notifications: true,
  sendCookies: false,
};

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<ExtensionSettings> {
  const values = await browser.storage.local.get(SETTINGS_KEY);
  const saved = values[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function isPaired(): Promise<boolean> {
  const { token } = await browser.storage.local.get("token");
  return typeof token === "string" && token.length > 0;
}
