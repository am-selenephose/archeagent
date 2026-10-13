import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("local completion build isolation", () => {
  it("preserves the existing preview's default output", async () => {
    vi.stubEnv("ARCHEAGENT_LOCAL_BUILD", ""); vi.resetModules();
    const config = (await import("../next.config")).default;
    expect(config.distDir ?? ".next").toBe(".next");
  });
  it("uses a fixed alternative directory for the owned completion preview", async () => {
    vi.stubEnv("ARCHEAGENT_LOCAL_BUILD", "completion"); vi.resetModules();
    expect((await import("../next.config")).default.distDir).toBe(".next-local-completion");
  });
  it("rejects arbitrary directory selectors", async () => {
    vi.stubEnv("ARCHEAGENT_LOCAL_BUILD", "../another-checkout"); vi.resetModules();
    await expect(import("../next.config")).rejects.toThrow("Invalid local build selection");
  });
});
