export type BrowserRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

/** One deadline owns the fetch and body reads, including transports that ignore abort. */
export async function withBrowserDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal: owner, timeoutMs = 12_000 }: BrowserRequestOptions = {},
): Promise<T> {
  if (owner?.aborted) throw owner.reason ?? new DOMException("Cancelled", "AbortError");
  const controller = new AbortController();
  const cancel = () => controller.abort(owner?.reason ?? new DOMException("Cancelled", "AbortError"));
  owner?.addEventListener("abort", cancel, { once: true });
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 60_000) : 12_000;
  const timer = setTimeout(() => controller.abort(new DOMException("Request deadline exceeded", "TimeoutError")), deadline);
  let stopListening = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    stopListening = () => controller.signal.removeEventListener("abort", rejectAbort);
  });
  try {
    return await Promise.race([operation(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    owner?.removeEventListener("abort", cancel);
    stopListening();
    controller.abort();
  }
}
