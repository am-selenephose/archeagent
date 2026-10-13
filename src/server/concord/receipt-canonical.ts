/** Canonical, JSON-only encoding. This provides integrity, never source identity. */
export function canonicalReceiptJson(input: unknown): string {
  const seen = new Set<object>();
  function encode(value: unknown, depth: number): string {
    if (depth > 32) throw new Error("Receipt unavailable");
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== "object" || value === null || seen.has(value)) throw new Error("Receipt unavailable");
    seen.add(value);
    try {
      if (Array.isArray(value)) return `[${value.map(item => encode(item, depth + 1)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Receipt unavailable");
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
    } finally { seen.delete(value); }
  }
  const encoded = encode(input, 0);
  if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) throw new Error("Receipt unavailable");
  return encoded;
}
