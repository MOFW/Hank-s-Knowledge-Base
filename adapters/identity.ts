import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { identities, users } from "@/db/schema";

export function findActiveOwner(provider: "local" | "chatgpt-sites", scope: string, subject: string) {
  return getDb().select({ id: users.id, displayName: users.displayName, timezone: users.timezone })
    .from(identities).innerJoin(users, eq(users.id, identities.userId))
    .where(and(
      eq(identities.provider, provider), eq(identities.providerScope, scope),
      eq(identities.subject, subject), eq(users.role, "owner"), isNull(users.disabledAt),
    )).get();
}

export async function resolveOwner() {
  const identity = await getChatGPTUser();
  if (!identity) return { status: "anonymous" } as const;

  // The production entry point must be behind Sites dispatch.
  const provider = import.meta.env.DEV ? "local" : "chatgpt-sites";
  let scope = env.HKB_SITE_SCOPE;
  if (import.meta.env.DEV) {
    scope = env.HKB_LOCAL_AUTH_MODE === "portable-loopback" ? "hkb-local" : undefined;
  }
  if (!scope) return { status: "denied" } as const;

  const owner = await findActiveOwner(provider, scope, identity.userId);
  return owner ? { status: "owner", owner } as const : { status: "denied" } as const;
}
