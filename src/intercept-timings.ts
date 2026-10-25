export interface InterceptTiming {
  listenerMs: number;
  cookiesMs: number;
  addMs: number;
}

export function appendInterceptTiming(
  entries: InterceptTiming[],
  entry: InterceptTiming
): InterceptTiming[] {
  return [...entries, entry].slice(-20);
}
