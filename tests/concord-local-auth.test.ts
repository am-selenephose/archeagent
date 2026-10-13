import { describe, expect, it } from "vitest";
import { LocalAccess, LocalAccessError } from "../src/server/concord/auth";

const origin = "http://127.0.0.1:34686";
const operatorSecret = "operator-local-test-only-".padEnd(48, "x");
const signingKey = "separate-session-test-key-".padEnd(64, "y");
function request(cookie?: string, overrides: Record<string, string> = {}, method = "GET") {
  return new Request(`${origin}/api/concord/overview`, { method, headers: {
    host: "127.0.0.1:34686", ...(cookie ? { cookie } : {}),
    ...(method !== "GET" ? { origin, "sec-fetch-site": "same-origin" } : {}), ...overrides,
  } });
}
function cookieValue(setCookie: string) { return setCookie.split(";")[0]; }
function access(now = () => Date.parse("2026-10-13T00:00:00Z")) {
  return new LocalAccess({ origin, operatorSecret, signingKey, now });
}

describe("local recorder access is not evidence/release authority", () => {
  it.each(["", "wrong-local-secret", operatorSecret + "wrong"])("denies an invalid credential", (secret) => {
    expect(() => access().signIn(request(undefined, {}, "POST"), secret)).toThrow(LocalAccessError);
  });
  it("signs a scoped HttpOnly Strict cookie and authorizes only a live server registry entry", () => {
    const controller = access();
    const cookie = controller.signIn(request(undefined, {}, "POST"), operatorSecret);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/concord");
    expect(cookie).not.toContain(operatorSecret);
    expect(cookie).not.toContain(signingKey);
    expect(controller.authorize(request(cookieValue(cookie))).expiresAt).toBe(Date.parse("2026-10-13T00:15:00Z"));
    expect(() => access().authorize(request(cookieValue(cookie)))).toThrow(LocalAccessError);
  });
  it("denies missing/forged/ambiguous cookies", () => {
    const controller = access();
    const cookie = cookieValue(controller.signIn(request(undefined, {}, "POST"), operatorSecret));
    for (const value of [undefined, cookie + "x", cookie + "; " + cookie, "archeagent_recorder_session=caller-success"]) {
      expect(() => controller.authorize(request(value))).toThrow(LocalAccessError);
    }
  });
  it("expires after fifteen minutes and logout revokes copied cookies", () => {
    let now = Date.parse("2026-10-13T00:00:00Z");
    const controller = access(() => now);
    const first = cookieValue(controller.signIn(request(undefined, {}, "POST"), operatorSecret));
    controller.revoke(request(first, {}, "DELETE"));
    expect(() => controller.authorize(request(first))).toThrow(LocalAccessError);
    const second = cookieValue(controller.signIn(request(undefined, {}, "POST"), operatorSecret));
    now += 900000;
    expect(() => controller.authorize(request(second))).toThrow(LocalAccessError);
  });
  it("rejects hostile Host, Origin and cross-site metadata for reads and writes", () => {
    const controller = access();
    const cookie = cookieValue(controller.signIn(request(undefined, {}, "POST"), operatorSecret));
    for (const headers of [{ host: "attacker.example" }, { origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }] as Record<string, string>[]) {
      expect(() => controller.authorize(request(cookie, headers))).toThrow(LocalAccessError);
      expect(() => controller.signIn(request(undefined, headers, "POST"), operatorSecret)).toThrow(LocalAccessError);
    }
    expect(() => controller.signIn(request(undefined, { origin: "" }, "POST"), operatorSecret)).toThrow(LocalAccessError);
  });
  it("bounds active sessions without invalidating existing users", () => {
    const controller = access();
    const cookies = Array.from({ length: 64 }, () => cookieValue(controller.signIn(request(undefined, {}, "POST"), operatorSecret)));
    expect(() => controller.signIn(request(undefined, {}, "POST"), operatorSecret)).toThrow(LocalAccessError);
    expect(controller.authorize(request(cookies[0]))).toBeDefined();
  });
  it("rate limits credential failures with a bounded cooldown", () => {
    let now = Date.parse("2026-10-13T00:00:00Z");
    const controller = access(() => now);
    for (let n = 0; n < 8; n++) expect(() => controller.signIn(request(undefined, {}, "POST"), "wrong")).toThrow(LocalAccessError);
    expect(() => controller.signIn(request(undefined, {}, "POST"), operatorSecret)).toThrowError(expect.objectContaining({ status: 429 }));
    now += 60000;
    expect(controller.signIn(request(undefined, {}, "POST"), operatorSecret)).toContain("HttpOnly");
  });
  it.each(["http://0.0.0.0:34686", "https://127.0.0.1:34686", "http://localhost:34686", "http://127.0.0.1:0"])("rejects noncanonical local configuration %s", (origin) => {
    expect(() => new LocalAccess({ origin, operatorSecret, signingKey })).toThrow(LocalAccessError);
  });
  it("rejects missing or reused key material", () => {
    expect(() => new LocalAccess({ origin, operatorSecret: "", signingKey })).toThrow(LocalAccessError);
    expect(() => new LocalAccess({ origin, operatorSecret, signingKey: operatorSecret })).toThrow(LocalAccessError);
  });
});
