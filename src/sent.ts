export interface SentItem {
  label: string;
  mode: "start" | "ask" | "browser";
  result: "sent" | "error";
  at: number;
}

const KEY = "recentSent";

export async function recordSent(
  label: string,
  mode: SentItem["mode"],
  result: SentItem["result"]
): Promise<void> {
  const stored = await browser.storage.local.get(KEY);
  const previous = (stored[KEY] as SentItem[] | undefined) ?? [];
  const item: SentItem = { label, mode, result, at: Date.now() };
  await browser.storage.local.set({ [KEY]: [item, ...previous].slice(0, 5) });
}

export async function getRecentSent(): Promise<SentItem[]> {
  const stored = await browser.storage.local.get(KEY);
  return ((stored[KEY] as SentItem[] | undefined) ?? []).slice(0, 5);
}
