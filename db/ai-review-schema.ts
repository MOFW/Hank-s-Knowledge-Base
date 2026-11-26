import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { AiReport, ReviewSettings, SourceWitness } from "@/domain/ai-review";
import { importItems, users } from "./schema";

export const aiReviewSettings = sqliteTable("ai_review_settings", {
  ownerId: text("owner_id").primaryKey().notNull().references(() => users.id, { onDelete: "restrict" }),
  settings: text("settings", { mode: "json" }).$type<ReviewSettings>().notNull(),
  revision: integer("revision").notNull(),
  conditionalSince: text("conditional_since"),
  updatedAt: text("updated_at").notNull(),
});

export const aiReviewSources = sqliteTable("ai_review_sources", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  digest: text("digest").notNull(),
  witness: text("witness", { mode: "json" }).$type<SourceWitness>().notNull(),
  verifiedAt: text("verified_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.digest] })]);

export const aiReviews = sqliteTable("ai_reviews", {
  id: text("id").primaryKey().notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  itemId: text("item_id").notNull().references(() => importItems.id, { onDelete: "restrict" }),
  itemVersion: integer("item_version").notNull(),
  requestKey: text("request_key").notNull(),
  state: text("state", { enum: ["queued", "running", "complete", "failed", "auto_committed"] }).notNull(),
  settingsRevision: integer("settings_revision").notNull(),
  leaseUntil: text("lease_until"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  model: text("model"),
  providerModel: text("provider_model"),
  durationMs: integer("duration_ms"),
  report: text("report", { mode: "json" }).$type<AiReport>(),
  reasons: text("reasons", { mode: "json" }).$type<string[]>(),
  failure: text("failure"),
  approvedDay: text("approved_day"),
  questionId: text("question_id"),
}, (t) => [
  unique("ai_reviews_request").on(t.ownerId, t.itemId, t.itemVersion, t.requestKey),
  index("ai_reviews_owner_state").on(t.ownerId, t.state, t.leaseUntil),
  index("ai_reviews_item_date").on(t.itemId, t.createdAt),
]);

export const aiReviewUsage = sqliteTable("ai_review_usage", {
  runId: text("run_id").notNull().references(() => aiReviews.id, { onDelete: "restrict" }),
  attempt: integer("attempt").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  day: text("day").notNull(),
  costMicros: integer("cost_micros").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
}, (t) => [
  primaryKey({ columns: [t.runId, t.attempt] }),
  index("ai_review_usage_owner_day").on(t.ownerId, t.day),
]);
