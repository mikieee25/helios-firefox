export interface LocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface OriginPermissionApi {
  contains(permission: { origins: string[] }): Promise<boolean>;
  request?(permission: { origins: string[] }): Promise<boolean>;
}

export interface BridgePing {
  app: "helios";
  version: string;
  bridge: 1;
  paired: boolean;
}

export interface BridgeStatus {
  version: string;
  online: boolean;
  active: number;
  speeds: { download: number; upload: number };
}

export interface AddItem {
  url: string;
  referrer?: string;
  userAgent?: string;
  cookie?: string;
  filename?: string;
}

export type AddMode = "start" | "ask";
export type BridgeErrorCode =
  | "no_host_permission"
  | "refused"
  | "timeout"
  | "forbidden"
  | "unauthorized"
  | "bad_code"
  | "locked"
  | "not_helios"
  | "bridge_disabled";

export type BridgeErrorKind = "network" | "timeout" | "http" | "bad_response" | "permission" | "client";
export class BridgeError extends Error {
  readonly name = "BridgeError";
  constructor(
    readonly kind: BridgeErrorKind,
    message: string,
    readonly code: BridgeErrorCode,
    readonly status?: number,
    readonly remainingAttempts?: number,
    readonly portsTried?: PortDiagnostic[],
  ) { super(message); }
}
export type BridgeResult<T> =
  | { ok: true; value: T; port?: number }
  | { ok: false; error: BridgeError };

export interface PortDiagnostic {
  port: number;
  status?: number;
  error?: BridgeErrorCode;
  kind?: BridgeErrorKind;
  message?: string;
}

export interface BridgeDiagnostics {
  extensionOrigin: string;
  ports: PortDiagnostic[];
}

export const LOOPBACK_PERMISSION = { origins: ["http://127.0.0.1/*"] };

export function bridgeErrorGuidance(error: BridgeError): { message: string; nextStep: string } {
  const attempts = error.remainingAttempts === undefined ? "" : ` ${error.remainingAttempts} attempts remain.`;
  if (error.kind === "network") return {
    message: `Firefox or Zen blocked the request to Helios (${error.message}).`,
    nextStep: "Check Local Network Access and the add-on's site access in about:addons.",
  };
  if (error.kind === "timeout") return {
    message: "Helios did not respond within 1.5 seconds.",
    nextStep: "Check that Helios is running and Browser integration is enabled.",
  };
  if (error.kind === "bad_response") return {
    message: `The service on this port did not return a valid Helios response (${error.message}).`,
    nextStep: "Check that no other app is using ports 16780–16789, then restart Helios.",
  };
  if (error.kind === "http") return {
    message: `Helios returned HTTP ${error.status ?? "error"}${error.message ? `: ${error.message}` : ""}.`,
    nextStep: error.code === "forbidden"
      ? "Check Local Network Access, the add-on's site access in about:addons, and Helios Browser integration."
      : error.code === "bridge_disabled"
        ? "Open Helios Settings and enable Browser integration."
        : error.code === "bad_code"
          ? "Generate a new code in Helios Settings and enter it within two minutes."
          : error.code === "locked"
            ? "Wait one minute, then generate a new code in Helios."
            : error.code === "unauthorized"
              ? "Pair the add-on with Helios again in Settings."
              : "Check the port and request details, then try again.",
  };
  if (error.kind === "client") return {
    message: "The add-on could not access its saved pairing information.",
    nextStep: "Check Firefox extension storage and pair with Helios again if needed.",
  };
  switch (error.code) {
    case "no_host_permission":
      return { message: "This add-on cannot access Helios on this computer.", nextStep: "Allow access to all websites for this add-on in about:addons > Permissions, or grant loopback access here." };
    case "refused":
      return { message: "Helios did not answer on ports 16780–16789.", nextStep: "Start Helios and make sure Browser integration is enabled in Settings." };
    case "timeout":
      return { message: "Helios took too long to respond.", nextStep: "Check that Helios is open and try again." };
    case "forbidden":
      return { message: "Helios rejected this request's host or origin.", nextStep: "Restart Helios and check that this extension is allowed to access the local bridge." };
    case "unauthorized":
      return { message: "This browser is no longer authorized.", nextStep: "Pair the add-on with Helios again in Settings." };
    case "bad_code":
      return { message: `That pairing code is incorrect or expired.${attempts}`, nextStep: "Generate a new code in Helios Settings and enter it within two minutes." };
    case "locked":
      return { message: "Pairing is temporarily locked after too many incorrect codes.", nextStep: "Wait one minute, then generate a new code in Helios." };
    case "not_helios":
      return { message: "A different service answered on a Helios bridge port.", nextStep: "Check ports 16780–16789 and restart Helios." };
    case "bridge_disabled":
      return { message: "Browser integration is turned off in Helios.", nextStep: "Open Helios Settings and enable Browser integration." };
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PortPing = { port: number; ping: BridgePing };
const PORTS = Array.from({ length: 10 }, (_, index) => 16_780 + index);
const CACHE_MS = 10_000;
const TIMEOUT_MS = 1_500;

const success = <T>(value: T, port?: number): BridgeResult<T> => ({ ok: true, value, ...(port ? { port } : {}) });
const failure = (code: BridgeErrorCode, remainingAttempts?: number, status?: number, kind = errorKind(code), message = ""): BridgeResult<never> => ({
  ok: false,
  error: new BridgeError(kind, message || defaultErrorMessage(code, status), code, status, remainingAttempts),
});

export class BridgeClient {
  private cache?: PortPing & { expiresAt: number };
  private scanPromise: Promise<PortPing> | undefined;

  constructor(
    private readonly storage: LocalStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly permissions: OriginPermissionApi = unavailablePermissions,
    private readonly extensionOrigin: () => string = () => "unknown"
  ) {}

  async ping(): Promise<BridgeResult<BridgePing>> {
    const result = await this.resolve();
    return result.ok ? success(result.value.ping, result.value.port) : result;
  }

  async isHealthy(): Promise<BridgeResult<boolean>> {
    const result = await this.ping();
    return result.ok ? success(result.value.paired, result.port) : result;
  }

  async pair(code: string, label: string): Promise<BridgeResult<BridgePing>> {
    const bridge = await this.resolve();
    if (!bridge.ok) return bridge;
    let response: BridgeResult<{ token?: unknown }>;
    try {
      response = success(await this.request<{ token?: unknown }>(
        bridge.value.port,
        "/v1/pair",
        { method: "POST", body: JSON.stringify({ code, label }) }
      ), bridge.value.port);
    } catch (error) { return failureResult(error); }
    if (!response.ok) return response;
    if (typeof response.value.token !== "string" || !response.value.token) return failure("not_helios");
    try {
      await this.storage.set({ token: response.value.token });
    } catch {
      return failure("refused", undefined, undefined, "client", "Could not save the pairing token.");
    }
    this.cache = {
      ...bridge.value,
      ping: { ...bridge.value.ping, paired: true },
      expiresAt: this.now() + CACHE_MS,
    };
    return success(this.cache.ping, this.cache.port);
  }

  async status(): Promise<BridgeResult<BridgeStatus>> {
    return this.authorizedRequest("/v1/status", { method: "GET" });
  }

  async add(mode: AddMode, items: AddItem[]): Promise<BridgeResult<{ ok: boolean; gids?: string[]; queued?: boolean }>> {
    return this.authorizedRequest("/v1/add", {
      method: "POST",
      body: JSON.stringify({ mode, items }),
    });
  }

  async show(): Promise<BridgeResult<{ ok: true }>> {
    return this.authorizedRequest("/v1/show", { method: "POST", body: "{}" });
  }

  async forget(): Promise<BridgeResult<void>> {
    try {
      await this.storage.remove("token");
      if (this.cache) this.cache = { ...this.cache, ping: { ...this.cache.ping, paired: false } };
      return success(undefined);
    } catch {
      return failure("refused", undefined, undefined, "client", "Could not remove the pairing token.");
    }
  }

  async requestHostPermission(): Promise<BridgeResult<boolean>> {
    try {
      if (!this.permissions.request) return failure("no_host_permission");
      const granted = await this.permissions.request(LOOPBACK_PERMISSION);
      return granted ? success(true) : failure("no_host_permission");
    } catch {
      return failure("no_host_permission");
    }
  }

  async diagnose(): Promise<BridgeResult<BridgeDiagnostics>> {
    let hasPermission = false;
    try {
      hasPermission = await this.permissions.contains(LOOPBACK_PERMISSION);
    } catch {
      hasPermission = false;
    }
    const ports = hasPermission
      ? await Promise.all(PORTS.map((port) => this.diagnosePort(port)))
      : PORTS.map((port) => ({ port, error: "no_host_permission" as const, kind: "permission" as const, message: "Loopback host permission is not granted." }));
    let extensionOrigin = "unknown";
    try { extensionOrigin = this.extensionOrigin(); } catch { /* Keep diagnostics free of runtime details. */ }
    return success({ extensionOrigin, ports });
  }

  private async authorizedRequest<T>(path: string, init: RequestInit): Promise<BridgeResult<T>> {
    const permission = await this.hasHostPermission();
    if (!permission) return failure("no_host_permission");
    let token: unknown;
    try {
      ({ token } = await this.storage.get("token"));
    } catch {
      return failure("refused", undefined, undefined, "client", "Could not read the pairing token.");
    }
    if (typeof token !== "string" || !token) return failure("unauthorized");
    const bridge = await this.resolve();
    if (!bridge.ok) return bridge;
    let result: BridgeResult<T>;
    try {
      result = success(await this.request<T>(bridge.value.port, path, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      }), bridge.value.port);
    } catch (error) { result = failureResult(error); }
    if (!result.ok && result.error.code === "forbidden") {
      try {
        await this.request<unknown>(bridge.value.port, "/v1/ping", { method: "GET" });
      } catch (error) {
        if (error instanceof BridgeError && error.code === "bridge_disabled") return failure("bridge_disabled", undefined, 403, "http", error.message);
      }
    }
    return result;
  }

  private async resolve(): Promise<BridgeResult<PortPing>> {
    if (!await this.hasHostPermission()) return failure("no_host_permission");
    if (this.cache && this.cache.expiresAt > this.now()) return success(this.cache);
    if (!this.scanPromise) {
      this.scanPromise = this.scan().finally(() => {
        this.scanPromise = undefined;
      });
    }
    try {
      const result = await this.scanPromise;
      this.cache = { ...result, expiresAt: this.now() + CACHE_MS };
      return success(this.cache);
    } catch (error) { return failureResult(error); }
  }

  private async scan(): Promise<PortPing> {
    const probes = PORTS.map(async (port) => {
      try {
        const ping = await this.request<unknown>(port, "/v1/ping", { method: "GET" });
        if (!isHeliosPing(ping)) throw new BridgeError("bad_response", "response app was not helios", "not_helios");
        return { port, value: { port, ping } } as const;
      } catch (error) {
        return { port, error: toBridgeError(error) } as const;
      }
    });
    try {
      return await Promise.any(probes.map(async (probe) => {
        const result = await probe;
        if ("value" in result) return result.value;
        throw result.error;
      }));
    } catch {
      // All ports failed; collect their errors to report the most useful one.
    }
    const settled = await Promise.all(probes);
    const failed = settled.filter((probe): probe is { port: number; error: BridgeError } => "error" in probe);
    const preferred = ["http", "bad_response", "network", "timeout"] as const;
    const informative = preferred.map((kind) => failed.find((probe) => probe.error.kind === kind)).find(Boolean) ?? failed[0];
    const portsTried = failed.map(({ port, error }) => ({
      port, kind: error.kind, error: error.code, message: error.message, ...(error.status === undefined ? {} : { status: error.status }),
    }));
    throw new BridgeError(informative?.error.kind ?? "network", informative?.error.message ?? "No response from Helios.", informative?.error.code ?? "refused", informative?.error.status, informative?.error.remainingAttempts, portsTried);
  }

  private async diagnosePort(port: number): Promise<PortDiagnostic> {
    try {
      const ping = await this.request<unknown>(port, "/v1/ping", { method: "GET" });
      if (!isHeliosPing(ping)) throw new BridgeError("bad_response", "response app was not helios", "not_helios", 200);
      return { port, status: 200, message: "Helios responded." };
    } catch (error) {
      const bridgeError = toBridgeError(error);
      return {
        port, error: bridgeError.code, kind: bridgeError.kind, message: bridgeError.message,
        ...(bridgeError.status === undefined ? {} : { status: bridgeError.status }),
      };
    }
  }

  private async hasHostPermission(): Promise<boolean> {
    try {
      return await this.permissions.contains(LOOPBACK_PERMISSION);
    } catch {
      return false;
    }
  }

  private async request<T>(port: number, path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher.call(globalThis, `http://127.0.0.1:${port}${path}`, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      });
      let body: unknown;
      try { body = await response.json() as unknown; }
      catch {
        if (!response.ok) throw this.httpFailure(response.status, path, undefined);
        throw new BridgeError("bad_response", "response was not valid JSON", "not_helios", response.status);
      }
      if (!response.ok) throw this.httpFailure(response.status, path, body);
      if (path === "/v1/ping" && !isHeliosPing(body)) {
        throw new BridgeError("bad_response", "response app was not helios", "not_helios", response.status);
      }
      return body as T;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new BridgeError("timeout", `request to port ${port} timed out`, "timeout");
      throw new BridgeError("network", error instanceof Error ? error.message : String(error), "refused");
    } finally {
      clearTimeout(timer);
    }
  }

  private httpFailure(status: number, path: string, body: unknown): BridgeError {
    const bodyError = getField(body, "error")?.toLowerCase() ?? "";
    if (bodyError.includes("disabled")) return new BridgeError("http", `HTTP ${status}: ${bodyError}`, "bridge_disabled", status);
    if (status === 403) return new BridgeError("http", `HTTP ${status}: forbidden`, "forbidden", status);
    if (status === 401 && path === "/v1/pair") {
      return new BridgeError("http", `HTTP ${status}: pairing rejected`, "bad_code", status, getRemainingAttempts(body));
    }
    if (status === 401) return new BridgeError("http", `HTTP ${status}: unauthorized`, "unauthorized", status);
    if (status === 429 && path === "/v1/pair") return new BridgeError("http", `HTTP ${status}: pairing locked`, "locked", status);
    if (status === 404 || (path === "/v1/ping" && status >= 500)) return new BridgeError("http", `HTTP ${status}`, "not_helios", status);
    return new BridgeError("http", `HTTP ${status}`, "refused", status);
  }
}

export function createBridgeClient(
  storage: LocalStorage,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
  permissions: OriginPermissionApi = unavailablePermissions,
  extensionOrigin: () => string = () => "unknown"
): BridgeClient {
  return new BridgeClient(storage, fetcher, now, permissions, extensionOrigin);
}

function isHeliosPing(value: unknown): value is BridgePing {
  if (!value || typeof value !== "object") return false;
  const ping = value as Partial<BridgePing>;
  return ping.app === "helios" && ping.bridge === 1 && typeof ping.version === "string" && typeof ping.paired === "boolean";
}

function getField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function getRemainingAttempts(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const attempts = body.remainingAttempts ?? body.remaining_attempts ?? body.attemptsRemaining;
  return typeof attempts === "number" && Number.isFinite(attempts) ? attempts : undefined;
}

function errorKind(code: BridgeErrorCode): BridgeErrorKind {
  if (code === "no_host_permission") return "permission";
  if (code === "refused") return "network";
  if (code === "timeout") return "timeout";
  if (code === "not_helios") return "bad_response";
  return "http";
}

function defaultErrorMessage(code: BridgeErrorCode, status?: number): string {
  return status === undefined ? code.replaceAll("_", " ") : `HTTP ${status}`;
}

function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  if (error instanceof Error && error.name === "AbortError") return new BridgeError("timeout", error.message || "request timed out", "timeout");
  return new BridgeError("network", error instanceof Error ? error.message : String(error), "refused");
}

function failureResult(error: unknown): BridgeResult<never> {
  const bridgeError = toBridgeError(error);
  return { ok: false, error: bridgeError };
}

const unavailablePermissions: OriginPermissionApi = { async contains() { return false; } };
const unavailableStorage: LocalStorage = {
  async get() { return {}; },
  async set() { throw new Error("Extension storage is unavailable."); },
  async remove() { throw new Error("Extension storage is unavailable."); },
};

export const bridgeClient = createBridgeClient(
  typeof browser === "undefined" ? unavailableStorage : browser.storage.local,
  fetch,
  Date.now,
  typeof browser === "undefined" ? unavailablePermissions : browser.permissions,
  () => typeof browser === "undefined" ? "unknown" : new URL(browser.runtime.getURL("")).origin
);
