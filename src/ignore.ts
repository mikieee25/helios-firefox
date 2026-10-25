export function createIgnoreSet() {
  const ignored = new Map<string, number>();
  return {
    add(url: string, ttlMs = 30_000, now = Date.now()) {
      ignored.set(url, now + ttlMs);
    },
    has(url: string, now = Date.now()) {
      for (const [key, expiresAt] of ignored) if (expiresAt <= now) ignored.delete(key);
      return (ignored.get(url) ?? 0) > now;
    },
  };
}

export const ignoreSet = createIgnoreSet();
