import { env } from "cloudflare:workers";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "@/db/schema";

// Only table names from the application schema are interpolated as SQL identifiers.
const emptyDatabase = Object.values(schema).filter((table) => is(table, SQLiteTable))
  .map((table) => `NOT EXISTS (SELECT 1 FROM "${getTableName(table).replaceAll('"', '""')}")`)
  .join(" AND ");

export async function ownerSetupIsAvailable() {
  const available = await env.DB?.prepare(`SELECT (${emptyDatabase}) AS available`).first<number>("available");
  return available === 1;
}

export async function createFirstOwner(scope: string, subject: string) {
  const db = env.DB;
  if (!db) throw new Error("D1 binding is unavailable.");
  const ownerId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Keep the empty database check inside the first write. The subsequent
  // statements in the same D1 transaction only run for this newly inserted ID.
  const insertedOwner = "EXISTS (SELECT 1 FROM users WHERE id = ?)";
  const [owner] = await db.batch([
    db.prepare(`INSERT INTO users (id, display_name, role, created_at)
      SELECT ?, '所有者', 'owner', ? WHERE ${emptyDatabase}`).bind(ownerId, now),
    db.prepare(`INSERT INTO identities (id, user_id, provider, provider_scope, subject, created_at)
      SELECT ?, ?, 'chatgpt-sites', ?, ?, ? WHERE ${insertedOwner}`).bind(identityId, ownerId, scope, subject, now, ownerId),
    db.prepare(`INSERT INTO system_state (id, updated_at) SELECT 1, ? WHERE ${insertedOwner}`).bind(now, ownerId),
  ]);
  return owner.meta.changes === 1;
}
