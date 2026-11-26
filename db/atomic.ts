import { SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { getDb } from "@/db";

const dialect = new SQLiteAsyncDialect();
export type AtomicStatement = SQL | { toSQL(): { sql: string; params: unknown[] } };

export function atomicBatch(db: ReturnType<typeof getDb>, operations: AtomicStatement[]) {
  return db.$client.batch(operations.map((operation) => {
    const { sql, params } = operation instanceof SQL ? dialect.sqlToQuery(operation) : operation.toSQL();
    return db.$client.prepare(sql).bind(...params);
  }));
}
