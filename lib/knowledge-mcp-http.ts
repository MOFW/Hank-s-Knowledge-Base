import { z } from "zod";
import { authenticateMcp, authorizeSitesMcp, checkMcpOrigin } from "@/adapters/mcp-identity";
import { zodInputDetails } from "@/domain/input-details";
import { knowledgeMcpInstructions as instructions } from "@/domain/knowledge-mcp";
import { Problem } from "@/domain/problem";
import { privateHeaders, readBody } from "@/lib/http";
import { callKnowledgeMcpTool, knowledgeMcpTools } from "@/services/knowledge-mcp";

const protocolVersions = ["2025-11-25", "2025-06-18"];
const sitesProtocolVersion = "2026-07-28";
const serverInfo = { name: "hanks-knowledge-base", title: "Hank’s Knowledge Base", version: "0.3.6" };
const rpcBodyLimit = 904_096; // 900,000-byte import plus the JSON-RPC envelope.
const object = z.custom<Record<string, unknown>>((value) => value !== null && typeof value === "object" && !Array.isArray(value));
const messageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number().int().safe()]).optional(),
  method: z.string().min(1),
  params: object.optional(),
}).strict();
const initializeParams = z.object({
  protocolVersion: z.string().min(1),
  capabilities: object,
  clientInfo: z.object({ name: z.string().min(1), version: z.string().min(1) }),
});
const callParams = z.object({
  name: z.string().min(1),
  arguments: object.optional(),
  _meta: object.optional(),
}).strict();

function rpcError(id: string | number | null, code: number, message: string, status = 200, data?: Record<string, unknown>) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message, data } }, { status, headers: privateHeaders });
}

function rpcResult(id: string | number, result: Record<string, unknown>) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: privateHeaders });
}

function safeError(error: unknown, requestId: string, args?: unknown) {
  const problem = error instanceof Problem ? error : error instanceof z.ZodError
    ? new Problem(422, "INVALID_INPUT", "Check the tool arguments.", zodInputDetails(error.issues, args))
    : new Problem(500, "SERVER_ERROR", "MCP could not complete the request. Retry later.");
  if (problem.status === 500) console.error("MCP request failed", requestId);
  return {
    status: problem.status,
    data: { error: { code: problem.code, message: problem.message, fields: problem.fields, retryable: problem.status >= 500 }, requestId },
  };
}

function validateSitesProtocol(request: Request, { id, method, params }: z.infer<typeof messageSchema>) {
  const headerVersion = request.headers.get("MCP-Protocol-Version");
  const headerMethod = request.headers.get("Mcp-Method");
  const headerName = request.headers.get("Mcp-Name");
  const meta = object.safeParse(params?._meta);
  const bodyVersion = meta.data?.["io.modelcontextprotocol/protocolVersion"];
  // The Sites Worker contract is JSON-RPC. Any HTTP routing metadata forwarded
  // by Dispatch must agree with the request body.
  if ((headerVersion !== null && bodyVersion !== undefined && headerVersion !== bodyVersion) ||
    (headerMethod !== null && headerMethod !== method) ||
    (headerName !== null && method === "tools/call" && headerName !== params?.name)) {
    return rpcError(id ?? null, -32020, "MCP request headers do not match the body.", 400);
  }
  const version = bodyVersion ?? headerVersion;
  if (version != null && version !== sitesProtocolVersion) {
    return rpcError(id ?? null, -32022, "Unsupported MCP protocol version.", 400,
      { supported: [sitesProtocolVersion], ...(typeof version === "string" ? { requested: version } : {}) });
  }
}

type ToolContext = { ownerId: string; origin: string };

async function handleRpc(request: Request, authorize: () => Promise<ToolContext>, requestId: string, sites: boolean) {
  if (!sites) {
    const version = request.headers.get("MCP-Protocol-Version");
    if (version !== null && !protocolVersions.includes(version)) {
      throw new Problem(400, "UNSUPPORTED_PROTOCOL_VERSION", "Unsupported MCP protocol version.");
    }
  }

  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new Problem(415, "INVALID_CONTENT_TYPE", "MCP requires application/json.");
  }
  const raw = await readBody(request, rpcBodyLimit);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Invalid JSON.", 400);
  }
  const message = messageSchema.safeParse(value);
  if (!message.success) return rpcError(null, -32600, "Invalid JSON-RPC request.", 400);
  const { id, method, params } = message.data;
  if (sites) {
    const protocolError = validateSitesProtocol(request, message.data);
    if (protocolError) return protocolError;
  }
  if (id === undefined) {
    if (method !== "notifications/initialized" && method !== "notifications/cancelled") {
      return rpcError(null, -32600, "Unsupported JSON-RPC notification.", 400);
    }
    return new Response(null, { status: 202, headers: privateHeaders });
  }
  const respond = (result: Record<string, unknown>) => rpcResult(id, sites
    ? { resultType: "complete", _meta: { "io.modelcontextprotocol/serverInfo": serverInfo }, ...result }
    : result);
  switch (method) {
    case "initialize": {
      if (sites) return rpcError(id, -32601, `Use server/discover with MCP ${sitesProtocolVersion}.`, 404);
      const input = initializeParams.safeParse(params);
      if (!input.success) return rpcError(id, -32602, "Invalid initialize parameters.");
      const requestedVersion = input.data.protocolVersion;
      return respond({
        protocolVersion: protocolVersions.includes(requestedVersion) ? requestedVersion : protocolVersions[0],
        capabilities: { tools: {} },
        serverInfo,
        instructions,
      });
    }
    case "server/discover":
      if (!sites) return rpcError(id, -32601, "Method not found.");
      return respond({ supportedVersions: [sitesProtocolVersion], capabilities: { tools: {} }, instructions });
    case "ping":
      return respond({});
    case "tools/list":
      if (params?.cursor !== undefined) return rpcError(id, -32602, "Invalid tools cursor.");
      return respond({ tools: knowledgeMcpTools });
    case "tools/call": {
      const context = await authorize();
      const input = callParams.safeParse(params);
      if (!input.success) return rpcError(id, -32602, "Invalid tool call parameters.");
      const { name, arguments: args = {} } = input.data;
      if (!knowledgeMcpTools.some((tool) => tool.name === name)) return rpcError(id, -32602, "Unknown tool.");
      const respondToCall = (data: Record<string, unknown>, errorCode?: string) => {
        const serialized = JSON.stringify(data);
        if (sites) {
          // Counts and status only. Do not log learning content or tool arguments.
          const bytes = new TextEncoder();
          console.info("HKB MCP call", {
            requestId, tool: name, argumentBytes: bytes.encode(JSON.stringify(args)).byteLength,
            resultBytes: bytes.encode(serialized).byteLength, outcome: errorCode ?? "ok",
          });
        }
        return respond({ ...(errorCode ? { isError: true } : {}),
          content: [{ type: "text", text: serialized }], structuredContent: data });
      };
      try {
        const data = await callKnowledgeMcpTool(name, args, context);
        if (name === "propose_learning_import") console.info("Learning import proposal accepted", requestId);
        return respondToCall(data);
      } catch (error) {
        const { data } = safeError(error, requestId, args);
        // Keep correlation metadata only. Field paths and messages can contain client-supplied keys.
        if (name === "propose_learning_import") console.info("Learning import proposal rejected", requestId, data.error.code);
        return respondToCall(data, data.error.code);
      }
    }
    default:
      return rpcError(id, -32601, "Method not found.", sites ? 404 : 200);
  }
}

export async function knowledgeMcpHttp(request: Request, env: Cloudflare.Env, transport: "bearer" | "sites" = "bearer") {
  const requestId = crypto.randomUUID();
  const sites = transport === "sites";
  try {
    // Native discovery and listing are static so the private Site can register
    // its plugin before the app owner is provisioned. Only tools/call uses D1.
    let authorize: () => Promise<ToolContext>;
    if (sites) {
      const origin = checkMcpOrigin(request, env);
      authorize = () => authorizeSitesMcp(request, env, origin);
    } else {
      const context = await authenticateMcp(request, env);
      authorize = async () => context;
    }
    if (request.method !== "POST") {
      return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for MCP requests.", retryable: false }, requestId }, {
        status: 405, headers: { ...privateHeaders, Allow: "POST" },
      });
    }
    return await handleRpc(request, authorize, requestId, sites);
  } catch (error) {
    const { status, data } = safeError(error, requestId);
    const headers = new Headers(privateHeaders);
    if (!sites && status === 401) headers.set("WWW-Authenticate", 'Bearer realm="hkb-mcp"');
    return Response.json(data, { status, headers });
  }
}
