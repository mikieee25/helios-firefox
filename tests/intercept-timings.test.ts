import { describe, expect, it } from "vitest";
import { appendInterceptTiming, type InterceptTiming } from "../src/intercept-timings";

describe("appendInterceptTiming", () => {
  it("keeps only the most recent 20 timing records", () => {
    let timings: InterceptTiming[] = [];
    for (let index = 0; index < 25; index += 1) {
      timings = appendInterceptTiming(timings, { listenerMs: index, cookiesMs: index + 1, addMs: index + 2 });
    }

    expect(timings).toHaveLength(20);
    expect(timings[0]).toEqual({ listenerMs: 5, cookiesMs: 6, addMs: 7 });
    expect(timings.at(-1)).toEqual({ listenerMs: 24, cookiesMs: 25, addMs: 26 });
  });
});
