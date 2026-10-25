import { describe, expect, it, vi } from "vitest";
import { addWithCookiePermission, createAddItem } from "../src/intercept";
import type { CookiePermissionApi } from "../src/cookie-permissions";
import { DEFAULT_SETTINGS } from "../src/settings";

const url = "https://files.example.test/archive.zip";
const settings = { ...DEFAULT_SETTINGS, consentAccepted: true, sendCookies: true };

function permissions(data: { data_collection?: string[] }, granted: boolean): CookiePermissionApi {
  return {
    getAll: vi.fn(async () => data),
    contains: vi.fn(async () => granted),
  };
}

describe("login cookie permission", () => {
  it("sends no cookies or browser details when Firefox permission is denied", async () => {
    const permissionApi = permissions({ data_collection: [] }, false);
    const getCookies = vi.fn(async () => [{ name: "session", value: "secret" }]);
    const item = await createAddItem(url, "https://example.test/page", "archive.zip", settings, permissionApi, getCookies);
    const add = vi.fn(async (mode: "start" | "ask", items: Array<{ url: string; cookie?: string }>) => ({ ok: true as const, value: { mode, items } }));
    await addWithCookiePermission("start", item, settings, permissionApi, add);

    expect(getCookies).not.toHaveBeenCalled();
    const body = await add.mock.results[0]?.value;
    expect(body.value.items).toEqual([{ url, referrer: "https://example.test/page", filename: "archive.zip" }]);
    expect(body.value.items[0]).not.toHaveProperty("cookie");
    expect(body.value.items[0]).not.toHaveProperty("userAgent");
  });

  it("includes cookies and browser details when Firefox permission is granted", async () => {
    const permissionApi = permissions({ data_collection: ["websiteContent"] }, true);
    const getCookies = vi.fn(async () => [{ name: "session", value: "secret" }]);
    const item = await createAddItem(url, undefined, undefined, settings, permissionApi, getCookies);
    const add = vi.fn(async (mode: "start" | "ask", items: Array<{ url: string; cookie?: string }>) => ({ ok: true as const, value: { mode, items } }));
    await addWithCookiePermission("start", item, settings, permissionApi, add);

    expect(getCookies).toHaveBeenCalledWith(url);
    const body = await add.mock.results[0]?.value;
    expect(body.value.items).toEqual([{ url, userAgent: expect.any(String), cookie: "session=secret" }]);
  });

  it("uses the local setting when Firefox has no data collection permission API", async () => {
    const permissionApi = permissions({}, false);
    const getCookies = vi.fn(async () => [{ name: "session", value: "secret" }]);
    const item = await createAddItem(url, undefined, undefined, settings, permissionApi, getCookies);

    expect(getCookies).toHaveBeenCalledWith(url);
    expect(permissionApi.contains).not.toHaveBeenCalled();
    expect(item.cookie).toBe("session=secret");
    expect(item.userAgent).toBe(navigator.userAgent);
  });

  it("keeps the legacy fallback disabled by default", async () => {
    const permissionApi = permissions({}, false);
    const getCookies = vi.fn(async () => [{ name: "session", value: "secret" }]);
    const item = await createAddItem(url, undefined, undefined, { ...settings, sendCookies: false }, permissionApi, getCookies);

    expect(DEFAULT_SETTINGS.sendCookies).toBe(false);
    expect(getCookies).not.toHaveBeenCalled();
    expect(item).not.toHaveProperty("cookie");
    expect(item).not.toHaveProperty("userAgent");
  });
});
