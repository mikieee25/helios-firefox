export interface LocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
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

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const PORTS = Array.from({ length: 10 }, (_, index) => 16_780 + index);
const CACHE_MS = 10_000;
const TIMEOUT_MS = 800;

export class BridgeClient {
  private cache?: { port: number; ping: BridgePing; expiresAt: number };
  private scanPromise: Promise<{ port: number; ping: BridgePing }> | undefined;

  constructor(
    private readonly storage: LocalStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now
  ) {}

  async ping(): Promise<BridgePing> {
    return (await this.resolve()).ping;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const ping = await this.ping();
      return ping.app === "helios" && ping.bridge === 1 && ping.paired;
    } catch {
      return false;
    }
  }

  async pair(code: string, label: string): Promise<BridgePing> {
    const bridge = await this.resolve();
    const response = await this.request<{ token: string }>(
      bridge.port,
      "/v1/pair",
      { method: "POST", body: JSON.stringify({ code, label }) }
    );
    await this.storage.set({ token: response.token });
    this.cache = { ...bridge, ping: { ...bridge.ping, paired: true }, expiresAt: this.now() + CACHE_MS };
    return this.cache.ping;
  }

  async status(): Promise<BridgeStatus> {
    return this.authorizedRequest("/v1/status", { method: "GET" });
  }

  async add(mode: AddMode, items: AddItem[]): Promise<{ ok: boolean; gids?: string[]; queued?: boolean }> {
    return this.authorizedRequest("/v1/add", {
      method: "POST",
      body: JSON.stringify({ mode, items }),
    });
  }

  async show(): Promise<void> {
    await this.authorizedRequest("/v1/show", { method: "POST", body: "{}" });
  }

  async forget(): Promise<void> {
    await this.storage.remove("token");
    if (this.cache) this.cache = { ...this.cache, ping: { ...this.cache.ping, paired: false } };
  }

  private async authorizedRequest<T>(path: string, init: RequestInit): Promise<T> {
    const [{ token }, bridge] = await Promise.all([
      this.storage.get("token"),
      this.resolve(),
    ]);
    if (typeof token !== "string" || !token) throw new Error("Pair Helios before using the bridge.");
    return this.request<T>(bridge.port, path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  }

  private async resolve(): Promise<{ port: number; ping: BridgePing }> {
    if (this.cache && this.cache.expiresAt > this.now()) return this.cache;
    if (!this.scanPromise) {
      this.scanPromise = this.scan().finally(() => {
        this.scanPromise = undefined;
      });
    }
    const result = await this.scanPromise;
    this.cache = { ...result, expiresAt: this.now() + CACHE_MS };
    return this.cache;
  }

  private async scan(): Promise<{ port: number; ping: BridgePing }> {
    const results = await Promise.all(
      PORTS.map(async (port) => {
        try {
          const ping = await this.request<BridgePing>(port, "/v1/ping", { method: "GET" });
          return ping.app === "helios" && ping.bridge === 1 ? { port, ping } : undefined;
        } catch {
          return undefined;
        }
      })
    );
    const found = results.find((result) => result !== undefined);
    if (!found) throw new Error("Helios desktop app is not reachable.");
    return found;
  }

  private async request<T>(port: number, path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(`http://127.0.0.1:${port}${path}`, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      });
      if (!response.ok) throw new Error(`Helios bridge returned HTTP ${response.status}.`);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError" && error.message.startsWith("Helios ")) throw error;
      throw new Error("Helios desktop app is not reachable.");
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createBridgeClient(
  storage: LocalStorage,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now
): BridgeClient {
  return new BridgeClient(storage, fetcher, now);
}

const unavailableStorage: LocalStorage = {
  async get() { return {}; },
  async set() { throw new Error("Extension storage is unavailable."); },
  async remove() { throw new Error("Extension storage is unavailable."); },
};

export const bridgeClient = createBridgeClient(
  typeof browser === "undefined" ? unavailableStorage : browser.storage.local
);
