import { createHash, timingSafeEqual } from "node:crypto";
import { findActiveOwner } from "@/adapters/identity";
import { readChatGPTIdentity } from "@/app/chatgpt-auth";
import { Problem } from "@/domain/problem";

const tokenPattern = /^[a-zA-Z0-9_-]{32,128}$/;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function siteOrigin(request: Request, config: Cloudflare.Env) {
  if (import.meta.env.DEV) {
    const url = new URL(request.url);
    return loopbackHosts.has(url.hostname) ? url.origin : undefined;
  }

  if (!config.HKB_MCP_SITE_ORIGIN) return;
  try {
    const url = new URL(config.HKB_MCP_SITE_ORIGIN);
    if (config.HKB_MCP_SITE_ORIGIN === url.origin && url.protocol === "https:") return url.origin;
  } catch { /* An invalid deployment binding leaves the grant disabled. */ }
}

export function checkMcpOrigin(request: Request, config: Cloudflare.Env) {
  const origin = siteOrigin(request, config);
  const browserOrigin = request.headers.get("Origin");
  if ((browserOrigin !== null && browserOrigin !== origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new Problem(403, "INVALID_ORIGIN", "MCP request origin is not allowed.");
  }
  return origin;
}

export async function authenticateMcp(request: Request, config: Cloudflare.Env) {
  const origin = checkMcpOrigin(request, config);

  const provider = import.meta.env.DEV ? "local" : "chatgpt-sites";
  const scope = import.meta.env.DEV
    ? (config.HKB_LOCAL_AUTH_MODE === "portable-loopback" ? "hkb-local" : undefined)
    : config.HKB_SITE_SCOPE;
  const token = config.HKB_MCP_TOKEN;
  const subject = config.HKB_MCP_OWNER_SUBJECT;
  const supplied = /^Bearer ([a-zA-Z0-9_-]{32,128})$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!origin || !scope || !subject || !token || !tokenPattern.test(token) || !supplied ||
    !timingSafeEqual(digest(token), digest(supplied))) {
    throw new Problem(401, "UNAUTHENTICATED", "A valid MCP credential is required.");
  }

  // The deployment grants the credential access to one registered Sites subject.
  // Browser identity headers and cookies have no bearing on this lookup.
  const owner = await findActiveOwner(provider, scope, subject);
  if (!owner) throw new Problem(403, "FORBIDDEN", "This MCP credential has no active owner grant.");
  return { ownerId: owner.id, origin };
}

export async function authorizeSitesMcp(request: Request, config: Cloudflare.Env, origin: string | undefined) {
  // The native route is reachable in production only through Sites Dispatch. It
  // validates the caller's Site access and supplies these authenticated headers.
  const identity = readChatGPTIdentity(request.headers);
  if (!identity || !origin || !config.HKB_SITE_SCOPE) {
    throw new Problem(401, "UNAUTHENTICATED", "An authenticated Sites MCP caller is required.");
  }
  const owner = await findActiveOwner("chatgpt-sites", config.HKB_SITE_SCOPE, identity.userId);
  if (!owner) throw new Problem(403, "FORBIDDEN", "The Sites MCP caller has no active owner grant.");
  return { ownerId: owner.id, origin };
}
