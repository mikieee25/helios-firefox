import { describe, expect, it, vi } from "vitest";
import { createBridgeClient, type LocalStorage, type OriginPermissionApi } from "../src/bridge";

function memoryStorage(initial: Record<string, unknown> = {}): LocalStorage {
  const values = { ...initial };
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(items) { Object.assign(values, items); },
    async remove(key) { delete values[key]; },
  };
}

function allowedPermissions(granted = true): OriginPermissionApi {
  return {
    contains: vi.fn(async () => granted),
    request: vi.fn(async () => granted),
  };
}

function heliosPing(paired = true): Response {
  return new Response(JSON.stringify({ app: "helios", version: "0.1.0", bridge: 1, paired }), { status: 200 });
}

function clientFor(
  fetcher: typeof fetch,
  permissions = allowedPermissions(),
  storage = memoryStorage(),
  now: () => number = Date.now
) {
  return createBridgeClient(storage, fetcher, now, permissions, () => "moz-extension://test-extension");
}

describe("bridge client results", () => {
  it("uses the browser fetch context for ping, pairing, and adding without an injected fetcher", async () => {
    const fetcher = async function (this: unknown, input: RequestInfo | URL): Promise<Response> {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError("'fetch' called on an object that does not implement interface Window");
      }
      const url = String(input);
      if (url.endsWith("/v1/ping")) {
        return new Response(JSON.stringify({ app: "helios", bridge: 1, version: "x", paired: false }), { status: 200 });
      }
      if (url.endsWith("/v1/pair")) return new Response(JSON.stringify({ token: "paired-token" }), { status: 200 });
      if (url.endsWith("/v1/add")) return new Response(JSON.stringify({ ok: true, gids: ["gid-1"] }), { status: 200 });
      return new Response("Not found", { status: 404 });
    };
    vi.stubGlobal("fetch", fetcher as typeof fetch);
    try {
      const client = createBridgeClient(
        memoryStorage(),
        undefined,
        Date.now,
        allowedPermissions(),
        () => "moz-extension://test-extension"
      );

      expect(await client.ping()).toMatchObject({ ok: true, value: { app: "helios", version: "x" } });
      expect(await client.pair("123456", "Firefox on windows")).toMatchObject({ ok: true, value: { app: "helios" } });
      expect(await client.add("start", [{ url: "https://files.example.test/file.zip" }]))
        .toMatchObject({ ok: true, value: { ok: true, gids: ["gid-1"] } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns no_host_permission without probing when loopback access is denied", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const permissions = allowedPermissions(false);
    const result = await clientFor(fetcher, permissions).ping();

    expect(result).toMatchObject({ ok: false, error: { code: "no_host_permission", kind: "permission" } });
    expect(permissions.contains).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["network refusal", () => Promise.reject(new TypeError("Local Network Access denied")), "network", "refused"],
    ["timeout", () => Promise.reject(new DOMException("Aborted", "AbortError")), "timeout", "timeout"],
    ["wrong application", () => Promise.resolve(new Response(JSON.stringify({ app: "other" }), { status: 200 })), "bad_response", "not_helios"],
    ["invalid JSON", () => Promise.resolve(new Response("not json", { status: 200 })), "bad_response", "not_helios"],
    ["disabled bridge", () => Promise.resolve(new Response(JSON.stringify({ error: "Browser bridge disabled" }), { status: 403 })), "http", "bridge_disabled"],
  ] as const)("maps %s to %s", async (_name, response, kind, code) => {
    const client = clientFor(vi.fn(response as typeof fetch));
    const result = await client.ping();
    expect(result).toMatchObject({ ok: false, error: { kind, code } });
    if (!result.ok && kind === "network") expect(result.error.message).toContain("Local Network Access denied");
  });

  it("prefers HTTP errors and includes every port tried when scanning fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const port = Number(new URL(String(input)).port);
      if (port === 16_780) throw new TypeError("CORS blocked");
      if (port === 16_781) return new Response("denied", { status: 403 });
      throw new TypeError("connection refused");
    });
    const result = await clientFor(fetcher).ping();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "http", code: "forbidden", status: 403 });
      expect(result.error.portsTried).toHaveLength(10);
      expect(result.error.portsTried).toEqual(expect.arrayContaining([
        expect.objectContaining({ port: 16780, kind: "network", message: "CORS blocked" }),
        expect.objectContaining({ port: 16781, kind: "http", status: 403 }),
      ]));
    }
  });

  it("aborts ping requests after 1500 ms", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
      const pending = clientFor(fetcher).ping();
      await vi.advanceTimersByTimeAsync(1499);
      expect(fetcher).toHaveBeenCalledTimes(10);
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(result).toMatchObject({ ok: false, error: { kind: "timeout", code: "timeout" } });
    } finally { vi.useRealTimers(); }
  });

  it("returns a typed successful result and caches the discovered port", async () => {
    let now = 1000;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(":16789/v1/ping")) return heliosPing(false);
      return new Response("", { status: 404 });
    });
    const client = clientFor(fetcher, allowedPermissions(), memoryStorage(), () => now);
    expect(await client.ping()).toEqual({
      ok: true,
      value: { app: "helios", version: "0.1.0", bridge: 1, paired: false },
      port: 16789,
    });
    const probes = fetcher.mock.calls.length;
    await client.ping();
    expect(fetcher).toHaveBeenCalledTimes(probes);
    now += 10_001;
    await client.ping();
    expect(fetcher.mock.calls.length).toBeGreaterThan(probes);
  });

  it("maps forbidden and unauthorized HTTP responses", async () => {
    const rejectedPing = clientFor(vi.fn<typeof fetch>(async () => new Response("{\"error\":\"Forbidden\"}", { status: 403 })));
    expect(await rejectedPing.ping()).toMatchObject({ ok: false, error: { code: "forbidden", status: 403 } });

    const forbidden = clientFor(vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/v1/ping")) return heliosPing();
      if (String(input).endsWith("/v1/status")) return new Response("{\"error\":\"Forbidden\"}", { status: 403 });
      return new Response("", { status: 404 });
    }), allowedPermissions(), memoryStorage({ token: "secret" }));
    expect(await forbidden.status()).toMatchObject({ ok: false, error: { code: "forbidden", status: 403 } });

    const unauthorized = clientFor(vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/v1/ping")) return heliosPing();
      return new Response("{\"error\":\"Unauthorized\"}", { status: 401 });
    }), allowedPermissions(), memoryStorage({ token: "secret" }));
    expect(await unauthorized.status()).toMatchObject({ ok: false, error: { code: "unauthorized", status: 401 } });
  });

  it("distinguishes a disabled bridge from a rejected authorized request", async () => {
    let disabled = false;
    const client = clientFor(vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/ping")) return disabled ? new Response("{\"error\":\"Bridge disabled\"}", { status: 403 }) : heliosPing();
      if (url.endsWith("/v1/status")) {
        disabled = true;
        return new Response("{\"error\":\"Forbidden\"}", { status: 403 });
      }
      return new Response("", { status: 404 });
    }), allowedPermissions(), memoryStorage({ token: "secret" }));

    expect(await client.status()).toMatchObject({ ok: false, error: { code: "bridge_disabled", status: 403 } });
  });

  it("maps invalid and locked pairing responses and preserves remaining attempts", async () => {
    const makePairClient = (status: number, body: object) => clientFor(vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/v1/ping")) return heliosPing(false);
      return new Response(JSON.stringify(body), { status });
    }));
    expect(await makePairClient(401, { error: "Invalid pairing code", remainingAttempts: 3 }).pair("111111", "Firefox"))
      .toMatchObject({ ok: false, error: { code: "bad_code", remainingAttempts: 3, status: 401 } });
    expect(await makePairClient(429, { error: "Pairing temporarily locked" }).pair("111111", "Firefox"))
      .toMatchObject({ ok: false, error: { code: "locked", status: 429 } });
  });

  it("reports sanitized results for every port and the extension origin", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes(":16780/")) return heliosPing();
      if (url.includes(":16781/")) return new Response("{\"error\":\"Forbidden\"}", { status: 403 });
      throw new TypeError("Failed to fetch");
    });
    const client = clientFor(fetcher);
    const result = await client.diagnose();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extensionOrigin).toBe("moz-extension://test-extension");
    expect(result.value.ports).toHaveLength(10);
    expect(result.value.ports[0]).toMatchObject({ port: 16780, status: 200 });
    expect(result.value.ports[1]).toMatchObject({ port: 16781, status: 403, error: "forbidden", kind: "http", message: expect.any(String) });
    expect(result.value.ports[2]).toMatchObject({ port: 16782, error: "refused", kind: "network", message: expect.stringContaining("Failed to fetch") });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("requests loopback host permission from the caller's user gesture", async () => {
    const permissions = allowedPermissions(false);
    permissions.request = vi.fn(async () => true);
    const result = await clientFor(vi.fn<typeof fetch>(), permissions).requestHostPermission();
    expect(result).toEqual({ ok: true, value: true });
    expect(permissions.request).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
  });

  it("pairs, persists the token, and uses bearer auth while returning typed results", async () => {
    const storage = memoryStorage();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/ping")) return heliosPing(false);
      if (url.endsWith("/v1/pair")) return new Response(JSON.stringify({ token: "test-secret-token" }), { status: 200 });
      if (url.endsWith("/v1/status")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-secret-token");
        return new Response(JSON.stringify({ version: "0.1.0", online: true, active: 2, speeds: { download: 5, upload: 1 } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    const client = clientFor(fetcher, allowedPermissions(), storage);
    expect(await client.pair("123456", "Firefox on windows")).toMatchObject({ ok: true, value: { version: "0.1.0" } });
    expect(await storage.get("token")).toEqual({ token: "test-secret-token" });
    expect(await client.status()).toMatchObject({ ok: true, value: { online: true, active: 2 } });
  });

  it("returns typed results for add and show", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/ping")) return heliosPing();
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer stored-token");
      if (url.endsWith("/v1/add")) return new Response(JSON.stringify({ ok: true, gids: ["gid-1"] }), { status: 200 });
      if (url.endsWith("/v1/show")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response("", { status: 404 });
    });
    const client = clientFor(fetcher, allowedPermissions(), memoryStorage({ token: "stored-token" }));
    expect(await client.add("start", [{ url: "https://files.example.test/file.zip" }]))
      .toMatchObject({ ok: true, value: { ok: true, gids: ["gid-1"] } });
    expect(await client.show()).toEqual({ ok: true, value: { ok: true }, port: 16780 });
  });
});
