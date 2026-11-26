import { z } from "zod";

const version = z.number().int().safe().positive();

export const revisionAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), rowVersion: version }).strict(),
  z.object({ action: z.literal("delete"), revisionNo: version }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
  z.object({ action: z.literal("restore"), revisionNo: version, rowVersion: version }).strict(),
]);

export type RevisionAction = z.infer<typeof revisionAction>;
