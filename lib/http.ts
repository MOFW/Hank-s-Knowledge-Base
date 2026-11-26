import { z } from "zod";
import { resolveOwner } from "@/adapters/identity";
import type { WriteContext } from "@/db/queries/catalog";
import { Problem } from "@/domain/problem";
import { sha256 } from "@/lib/hash";

export { sha256 } from "@/lib/hash";

export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const maxRequestBytes = 900_000;

type RequestContext = { ownerId: string; timezone: string; requestId: string };

export function api<Route = unknown>(handler: (request: Request, ctx: RequestContext, route: Route) => Promise<Response>) {
  return async (request: Request, route: Route) => {
    const requestId = crypto.randomUUID();
    try {
      const access = await resolveOwner();
      if (access.status === "anonymous") throw new Problem(401, "UNAUTHENTICATED", "请先登录。");
      if (access.status === "denied") throw new Problem(403, "FORBIDDEN", "当前账户没有操作权限。");
      return await handler(request, { ownerId: access.owner.id, timezone: access.owner.timezone, requestId }, route);
    } catch (error) {
      const problem = error instanceof Problem ? error : error instanceof z.ZodError
        ? new Problem(422, "INVALID_INPUT", "请检查输入字段。", error.issues.map((issue) => ({
          path: issue.path.join("."), message: issue.message,
        })))
        : new Problem(500, "SERVER_ERROR", "暂时无法完成操作，请稍后重试。");
      if (problem.status === 500) console.error("API request failed", requestId, error instanceof Error ? error.name : "unknown");
      return Response.json({
        error: { code: problem.code, message: problem.message, fields: problem.fields, retryable: problem.status >= 500 },
        requestId,
      }, { status: problem.status, headers: privateHeaders });
    }
  };
}

export function result(data: unknown, requestId: string, status = 200, version?: number) {
  const headers = new Headers(privateHeaders);
  if (version !== undefined) headers.set("ETag", `"v${version}"`);
  return Response.json({ data, meta: { requestId } }, { status, headers });
}

export function expectedVersion(request: Request) {
  const header = request.headers.get("If-Match");
  if (!header) throw new Problem(428, "VERSION_REQUIRED", "请提供当前内容版本。");
  const match = /^"v([1-9]\d*)"$/.exec(header);
  const version = Number(match?.[1]);
  if (!Number.isSafeInteger(version)) throw new Problem(400, "INVALID_VERSION", "内容版本格式不正确。");
  return version;
}

export async function readBody(request: Request, limit = maxRequestBytes) {
  if (Number(request.headers.get("Content-Length")) > limit) {
    throw new Problem(413, "TOO_LARGE", "请求内容过大。");
  }
  if (!request.body) throw new Problem(400, "INVALID_JSON", "请输入 JSON 内容。");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Problem(413, "TOO_LARGE", "请求内容过大。");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(400, "INVALID_BODY", "无法读取 UTF-8 请求正文。");
  } finally {
    reader.releaseLock();
  }
}

export function requireWriteOrigin(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new Problem(403, "INVALID_ORIGIN", "保存请求必须来自本站。");
  }
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
    throw new Problem(400, "IDEMPOTENCY_KEY_REQUIRED", "请提供有效的保存标识。");
  }
  return key;
}

export async function writeInput<T>(request: Request, ownerId: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<{
  input: T; ctx: WriteContext; raw: string;
}> {
  requireWriteOrigin(request);
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new Problem(415, "INVALID_CONTENT_TYPE", "请求须使用 application/json。");
  }
  const key = idempotencyKey(request);
  const raw = await readBody(request);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Problem(400, "INVALID_JSON", "请求正文不是有效的 JSON。");
  }
  const input = schema.parse(json);
  const signature = JSON.stringify([request.method, new URL(request.url).pathname, request.headers.get("If-Match"), raw]);
  const hash = await sha256(new TextEncoder().encode(signature));
  return { input, raw, ctx: { actorId: ownerId, key, hash, now: new Date().toISOString() } };
}
