import { describe, expect, it } from "vitest";
import { filenameFromHeaders } from "../src/filename";

describe("filenameFromHeaders", () => {
  it("parses quoted Content-Disposition filenames", () => {
    expect(filenameFromHeaders([{ name: "Content-Disposition", value: 'attachment; filename="game pack.zip"' }])).toBe("game pack.zip");
  });

  it("prefers RFC 5987 encoded filenames", () => {
    expect(filenameFromHeaders([{ name: "content-disposition", value: "attachment; filename=old.zip; filename*=UTF-8''caf%C3%A9.zip" }])).toBe("café.zip");
  });

  it("strips path components and unsafe characters", () => {
    expect(filenameFromHeaders([{ name: "Content-Disposition", value: 'attachment; filename="../../CON.zip"' }])).toBe("_CON.zip");
    expect(filenameFromHeaders([{ name: "Content-Disposition", value: 'attachment; filename="../file?.zip"' }])).toBe("file_.zip");
  });

  it("returns undefined when a filename is absent or malformed", () => {
    expect(filenameFromHeaders([{ name: "Content-Type", value: "application/zip" }])).toBeUndefined();
    expect(filenameFromHeaders([{ name: "Content-Disposition", value: "attachment; filename*=UTF-8''%ZZ" }])).toBeUndefined();
  });
});
