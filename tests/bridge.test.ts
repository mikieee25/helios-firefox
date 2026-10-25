import { describe, expect, it, vi } from "vitest";
import { createBridgeClient, type LocalStorage } from "../src/bridge";

function memoryStorage(): LocalStorage {
  const values: Record<string, unknown> = {};
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(items) { Object.assign(values, items); },
    async remove(key) { delete values[key]; },
  };
}

describe("bridge client", () => {
  it("finds a port, pairs, persists the token and sends bearer auth", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(":16782/") && url.endsWith("/v1/ping"))
        return new Response(JSON.stringify({ app: "helios", version: "0.1.0", bridge: 1, paired: true }), { status: 200 });
      if (url.endsWith("/v1/pair"))
        return new Response(JSON.stringify({ token: "test-secret-token" }), { status: 200 });
      if (url.endsWith("/v1/status")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-secret-token");
        return new Response(JSON.stringify({ version: "0.1.0", online: true, active: 2, speeds: { download: 5, upload: 1 } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    const client = createBridgeClient(memoryStorage(), fetcher);
    const ping = await client.pair("123456", "Firefox on windows");
    expect(ping.version).toBe("0.1.0");
    expect(await client.status()).toMatchObject({ online: true, active: 2 });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:16782/v1/pair",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("scans candidates only for a bounded time and caches the discovered port", async () => {
    let now = 1000;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(":16789/"))
        return new Response(JSON.stringify({ app: "helios", version: "1.2.3", bridge: 1, paired: false }), { status: 200 });
      return new Response("", { status: 404 });
    });
    const client = createBridgeClient(memoryStorage(), fetcher, () => now);
    await client.ping();
    const probes = fetcher.mock.calls.length;
    await client.ping();
    expect(fetcher).toHaveBeenCalledTimes(probes);
    now += 10_001;
    await client.ping();
    expect(fetcher.mock.calls.length).toBeGreaterThan(probes);
  });

  it("sends add and show with the paired bearer token", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/ping"))
        return new Response(JSON.stringify({ app: "helios", version: "0.1.0", bridge: 1, paired: true }), { status: 200 });
      if (url.endsWith("/v1/pair"))
        return new Response(JSON.stringify({ token: "pair-token" }), { status: 200 });
      if (url.endsWith("/v1/add") || url.endsWith("/v1/show")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer pair-token");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    const client = createBridgeClient(memoryStorage(), fetcher);
    await client.pair("123456", "Firefox on linux");
    await client.add("ask", [{ url: "https://files.example.test/a.zip", cookie: "session=fake" }]);
    await client.show();
    const addRequest = fetcher.mock.calls.find(([input]) => String(input).endsWith("/v1/add"));
    expect(JSON.parse(String(addRequest?.[1]?.body))).toMatchObject({ mode: "ask", items: [{ cookie: "session=fake" }] });
  });
});
