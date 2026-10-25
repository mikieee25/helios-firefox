import { describe, expect, it } from "vitest";
import { shouldIntercept, type InterceptDetails } from "../src/intercept";
import { DEFAULT_SETTINGS } from "../src/settings";

const eligible: InterceptDetails = {
  url: "https://downloads.example.test/archive.zip",
  method: "GET",
  tabId: 3,
  type: "main_frame",
  statusCode: 200,
  responseHeaders: [
    { name: "Content-Type", value: "application/zip" },
    { name: "Content-Length", value: "8000000" },
  ],
};
const settings = {
  ...DEFAULT_SETTINGS,
  interceptionEnabled: true,
  consentAccepted: true,
  paired: true,
};

describe("shouldIntercept", () => {
  it("accepts an eligible large binary GET after consent and pairing", () => {
    expect(shouldIntercept(eligible, settings)).toBe(true);
  });

  it.each([
    [{ ...eligible, method: "POST" }, "POST"],
    [{ ...eligible, statusCode: 302 }, "redirect"],
    [{ ...eligible, tabId: -1 }, "no tab"],
    [{ ...eligible, incognito: true }, "private window"],
    [{ ...eligible, initiator: "moz-extension://example/background.html" }, "extension request"],
    [{ ...eligible, url: "blob:https://example.test/id" }, "blob URL"],
    [{ ...eligible, url: "ftp://downloads.example.test/archive.zip" }, "FTP response"],
    [{ ...eligible, responseHeaders: [{ name: "Content-Type", value: "text/html" }] }, "HTML"],
    [{ ...eligible, responseHeaders: [{ name: "Content-Type", value: "application/problem+json" }] }, "JSON response"],
    [{ ...eligible, responseHeaders: [{ name: "Content-Type", value: "application/pdf" }] }, "inline PDF"],
    [{ ...eligible, responseHeaders: [{ name: "Content-Type", value: "image/png" }] }, "inline image"],
    [{ ...eligible, responseHeaders: [{ name: "Content-Type", value: "application/zip" }, { name: "Content-Length", value: "1000" }] }, "small file"],
    [{ ...eligible, url: "https://secure.gov.ph/file.zip" }, "sensitive suffix"],
    [{ ...eligible, url: "https://private.example.test/file.zip" }, "user exclude"],
  ])("rejects %s", (details) => {
    const withExclusion = details.url.includes("private.example")
      ? { ...settings, excludeHosts: ["example.test"] }
      : settings;
    expect(shouldIntercept(details, withExclusion)).toBe(false);
  });

  it("rejects when consent, pairing, or interception is missing", () => {
    expect(shouldIntercept(eligible, { ...settings, consentAccepted: false })).toBe(false);
    expect(shouldIntercept(eligible, { ...settings, paired: false })).toBe(false);
    expect(shouldIntercept(eligible, { ...settings, interceptionEnabled: false })).toBe(false);
  });

  it("accepts unknown content length but not a known file below the configured minimum", () => {
    expect(shouldIntercept({ ...eligible, responseHeaders: [{ name: "Content-Type", value: "application/zip" }] }, settings)).toBe(true);
    expect(shouldIntercept({ ...eligible, responseHeaders: [{ name: "Content-Type", value: "application/zip" }, { name: "Content-Length", value: "4999999" }] }, settings)).toBe(false);
  });

  it("intercepts an attachment even when its content type is text", () => {
    expect(shouldIntercept({ ...eligible, responseHeaders: [{ name: "Content-Type", value: "text/csv" }, { name: "Content-Disposition", value: "attachment; filename=report.csv" }] }, settings)).toBe(true);
  });
});
