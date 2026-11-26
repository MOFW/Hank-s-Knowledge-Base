import { env } from "cloudflare:workers";
import { createHash, timingSafeEqual } from "node:crypto";

export function ownerSetupConfig() {
  const { DB, HKB_SITE_SCOPE: scope, HKB_MCP_SITE_ORIGIN: origin, HKB_OWNER_SETUP_CODE_HASH: digest } = env;
  if (import.meta.env.DEV || !DB || !scope || scope !== scope.trim() || !origin ||
      !digest || !/^[a-f0-9]{64}$/i.test(digest)) return;

  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && url.origin === origin) return { scope, origin, digest };
  } catch { /* Invalid configuration leaves setup disabled. */ }
}

export function matchesOwnerSetupCode(code: string, digest: string) {
  return /^[a-zA-Z0-9_-]{43}$/.test(code) &&
    timingSafeEqual(createHash("sha256").update(code).digest(), Buffer.from(digest, "hex"));
}
