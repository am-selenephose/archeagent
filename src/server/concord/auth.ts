import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE = "archeagent_recorder_session";
const TTL_MS = 15 * 60 * 1000;
export class LocalAccessError extends Error {
  constructor(public readonly status = 401) { super("Local recorder access unavailable"); this.name = "LocalAccessError"; }
}
interface AccessConfig { origin: string; operatorSecret: string; signingKey: string; now?: () => number }
interface Session { sessionId: string; expiresAt: number }
const digest = (text: string) => createHash("sha256").update(text).digest();

/** Permission to read local records, never model identity or release authority. */
export class LocalAccess {
  private readonly origin: string;
  private readonly host: string;
  private readonly secretHash: Buffer;
  private readonly signingKey: string;
  private readonly now: () => number;
  private readonly sessions = new Map<string, number>();
  private failures = 0;
  private failureWindow = 0;
  constructor(config: AccessConfig) {
    let url: URL;
    try { url = new URL(config.origin); } catch { throw new LocalAccessError(503); }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || +url.port < 1 || +url.port > 65535 || url.origin !== config.origin || url.username || url.password) throw new LocalAccessError(503);
    if (typeof config.operatorSecret !== "string" || config.operatorSecret.length < 32 || config.operatorSecret.length > 4096 || typeof config.signingKey !== "string" || config.signingKey.length < 32 || config.signingKey.length > 4096 || config.signingKey === config.operatorSecret) throw new LocalAccessError(503);
    this.origin = url.origin; this.host = url.host; this.secretHash = digest(config.operatorSecret); this.signingKey = config.signingKey; this.now = config.now ?? Date.now;
  }
  private boundary(request: Request, mutation = false) {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (request.headers.get("host") !== this.host || new URL(request.url).origin !== this.origin || (origin !== null && origin !== this.origin) || (mutation && origin !== this.origin) || (site !== null && site !== "same-origin" && site !== "none")) throw new LocalAccessError(403);
  }
  private prune(now: number) { for (const [id, expiry] of this.sessions) if (expiry <= now) this.sessions.delete(id); }
  private signature(body: string) { return createHmac("sha256", this.signingKey).update(body).digest("base64url"); }
  signIn(request: Request, submittedSecret: string): string {
    this.boundary(request, true);
    if (request.method !== "POST") throw new LocalAccessError(403);
    const now = this.now(); this.prune(now);
    if (now - this.failureWindow >= 60000) { this.failures = 0; this.failureWindow = now; }
    if (this.failures >= 8) throw new LocalAccessError(429);
    const valid = typeof submittedSecret === "string" && submittedSecret.length <= 4096 && timingSafeEqual(digest(submittedSecret), this.secretHash);
    if (!valid) { if (!this.failures) this.failureWindow = now; this.failures++; throw new LocalAccessError(); }
    if (this.sessions.size >= 64) throw new LocalAccessError(429);
    const id = randomUUID(); const expiresAt = now + TTL_MS; const body = `${id}.${expiresAt}`;
    this.sessions.set(id, expiresAt);
    // This is deliberately a loopback HTTP preview, not a remote TLS deployment.
    return `${COOKIE}=${body}.${this.signature(body)}; Path=/api/concord; HttpOnly; SameSite=Strict; Max-Age=900`;
  }
  authorize(request: Request): Session {
    this.boundary(request, request.method !== "GET" && request.method !== "HEAD");
    const raw = request.headers.get("cookie") ?? "";
    if (raw.length > 8192) throw new LocalAccessError();
    const values = raw.split(";").map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
    if (values.length !== 1) throw new LocalAccessError();
    const token = values[0].slice(COOKIE.length + 1);
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9]{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) throw new LocalAccessError();
    const [, sessionId, expiry, signature] = match;
    const expected = this.signature(`${sessionId}.${expiry}`);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new LocalAccessError();
    const now = this.now(); this.prune(now); const expiresAt = Number(expiry);
    if (expiresAt <= now || this.sessions.get(sessionId) !== expiresAt) throw new LocalAccessError();
    return { sessionId, expiresAt };
  }
  revoke(request: Request): string {
    if (request.method !== "DELETE") throw new LocalAccessError(403);
    const session = this.authorize(request); this.sessions.delete(session.sessionId);
    return `${COOKIE}=; Path=/api/concord; HttpOnly; SameSite=Strict; Max-Age=0`;
  }
}

// Next route bundles share a process registry. Rotation replaces it and revokes all sessions.
const key = Symbol.for("archeagent.local-access.v1");
type Registry = typeof globalThis & { [key]?: { fingerprint: string; access: LocalAccess } };
export function getLocalAccess(): LocalAccess {
  const config = { origin: process.env.ARCHEAGENT_RECORDER_ORIGIN ?? "", operatorSecret: process.env.ARCHEAGENT_RECORDER_ACCESS_SECRET ?? "", signingKey: process.env.ARCHEAGENT_RECORDER_SESSION_KEY ?? "" };
  const fingerprint = digest(JSON.stringify(config)).toString("hex");
  const registry = globalThis as Registry;
  if (!registry[key] || registry[key].fingerprint !== fingerprint) registry[key] = { fingerprint, access: new LocalAccess(config) };
  return registry[key].access;
}
