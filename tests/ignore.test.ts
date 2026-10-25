import { describe, expect, it } from "vitest";
import { createIgnoreSet } from "../src/ignore";

describe("ignore set", () => {
  it("ignores a replay only until its short expiry", () => {
    const ignored = createIgnoreSet();
    ignored.add("https://example.test/file", 1000, 5000);
    expect(ignored.has("https://example.test/file", 5999)).toBe(true);
    expect(ignored.has("https://example.test/file", 6000)).toBe(false);
  });
});
