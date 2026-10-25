export interface CookiePermissionApi {
  getAll(): Promise<{ data_collection?: string[] }>;
  contains(permission: { data_collection: readonly ["websiteContent"] }): Promise<boolean>;
  request?(permission: { data_collection: readonly ["websiteContent"] }): Promise<boolean>;
  remove?(permission: { data_collection: readonly ["websiteContent"] }): Promise<boolean>;
}

export const WEBSITE_CONTENT = { data_collection: ["websiteContent"] } as const;

export async function cookiePermissionState(api: CookiePermissionApi): Promise<boolean | undefined> {
  const permissions = await api.getAll();
  if (!("data_collection" in permissions)) return undefined;
  return api.contains(WEBSITE_CONTENT);
}

export async function maySendWebsiteContent(
  consentAccepted: boolean,
  fallbackSetting: boolean,
  api: CookiePermissionApi
): Promise<boolean> {
  if (!consentAccepted) return false;
  try {
    return (await cookiePermissionState(api)) ?? fallbackSetting;
  } catch {
    return false;
  }
}
