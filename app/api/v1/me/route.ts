import { api, result } from "@/lib/http";

export const GET = api(async (_request, { ownerId, requestId }) => result({ id: ownerId, role: "owner" }, requestId));
