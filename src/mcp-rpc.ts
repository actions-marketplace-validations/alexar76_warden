/**
 * JSON-RPC MCP methods for the stdio server (no transport).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callMcpTool, MCP_INSTRUCTIONS, MCP_TOOLS, McpToolError, payloadTooLarge } from "./mcp-tools.js";

export const PROTOCOL = "2025-03-26";
/**
 * MCP 2026-07-28 has no `initialize`: a request states its protocol version and the client's
 * capabilities in `params._meta`, and `server/discover` says what a server speaks. This server
 * answers both ways. A request carrying that metadata (or `server/discover`) is handled on its
 * own, per the 2026-07-28 rules; anything else goes through the handshake as before.
 */
export const MODERN_PROTOCOL = "2026-07-28";
/** Every revision this server speaks, newest first: what `server/discover` and the unsupported-version error list. */
export const SUPPORTED_PROTOCOLS = [MODERN_PROTOCOL, PROTOCOL] as const;
const META_PROTOCOL = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
/** Results a 2026-07-28 client may cache; the tool list here changes only with the package. */
const CACHEABLE = new Set(["server/discover", "tools/list", "resources/list", "resources/templates/list", "prompts/list"]);
const MODERN_TTL_MS = 300_000;
const FALLBACK_VERSION = "0.9.0";

export function packageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcRes {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function listedTools() {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    annotations: t.annotations,
  }));
}

export const MAX_FRAME_BYTES = 1_048_576;
export const MAX_HEADER_BYTES = 8192;

export function consumeLsp(buf: Buffer): { rest: Buffer; bodies: string[] } {
  const bodies: string[] = [];
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      if (buf.length > MAX_HEADER_BYTES) throw new Error("MCP header too large");
      return { rest: buf, bodies };
    }
    if (headerEnd > MAX_HEADER_BYTES) throw new Error("MCP header too large");
    const header = buf.subarray(0, headerEnd).toString("ascii");
    const matches = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) {
      throw new Error("Invalid Content-Length header");
    }
    const len = Number(match[1]);
    if (!Number.isSafeInteger(len) || len > MAX_FRAME_BYTES) throw new Error("MCP frame too large");
    const start = headerEnd + 4;
    if (buf.length < start + len) return { rest: buf, bodies };
    bodies.push(buf.subarray(start, start + len).toString("utf8"));
    buf = buf.subarray(start + len);
  }
}

export async function handleRpc(raw: unknown): Promise<JsonRpcRes | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }
  const msg = raw as JsonRpcReq;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string" ||
      (msg.id !== undefined && msg.id !== null && typeof msg.id !== "string" &&
       !(typeof msg.id === "number" && Number.isFinite(msg.id)))) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }
  const method = msg.method;
  const id = msg.id;
  if (msg.id === undefined) return null;

  const fail = (code: number, message: string, data?: unknown): JsonRpcRes => ({
    jsonrpc: "2.0",
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  });

  if (msg.params !== undefined && (!msg.params || typeof msg.params !== "object" || Array.isArray(msg.params))) {
    return fail(-32602, "params must be an object");
  }
  const meta = isRecord(msg.params) ? (msg.params as Record<string, unknown>)._meta : undefined;
  if (meta !== undefined && !isRecord(meta)) return fail(-32602, "_meta must be an object");
  const modern = method === "server/discover" || (isRecord(meta) && (META_PROTOCOL in meta || META_CAPABILITIES in meta));
  if (modern) {
    if (!isRecord(meta) || typeof meta[META_PROTOCOL] !== "string" || !isRecord(meta[META_CAPABILITIES])) {
      return fail(-32602, `a ${MODERN_PROTOCOL} request needs ${META_PROTOCOL} and ${META_CAPABILITIES} in params._meta`);
    }
    if (meta[META_PROTOCOL] !== MODERN_PROTOCOL) {
      return fail(-32022, "Unsupported protocol version", {
        supported: [...SUPPORTED_PROTOCOLS],
        requested: String(meta[META_PROTOCOL]).slice(0, 40).replace(/[^ -~]/g, "?"),
      });
    }
    // initialize, ping and logging/setLevel are not part of this revision.
    if (method === "initialize" || method === "ping") return fail(-32601, `method not found: ${method}`);
  }
  /** A 2026-07-28 result also says it is complete, who answered, and how long a list may be kept. */
  const ok = (result: unknown): JsonRpcRes => {
    if (modern && isRecord(result)) {
      result.resultType = "complete";
      result._meta = { ...(isRecord(result._meta) ? result._meta : {}),
        [META_SERVER_INFO]: { name: "warden", title: "WARDEN MCP security firewall", version: packageVersion() } };
      if (CACHEABLE.has(method)) { result.ttlMs = MODERN_TTL_MS; result.cacheScope = "public"; }
    }
    return { jsonrpc: "2.0", id: id ?? null, result };
  };
  switch (method) {
    case "server/discover":
      return ok({
        supportedVersions: [...SUPPORTED_PROTOCOLS],
        capabilities: { tools: {} },
        instructions: MCP_INSTRUCTIONS,
      });
    case "initialize":
      return ok({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "warden",
          title: "WARDEN MCP security firewall",
          version: packageVersion(),
        },
        instructions: MCP_INSTRUCTIONS,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: listedTools() });
    case "tools/call": {
      if (id === undefined) return null;
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return fail(-32602, "tools/call requires params.name");
      if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))) {
        return fail(-32602, "arguments must be an object");
      }
      const args =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (payloadTooLarge(args)) {
        return ok({ content: [{ type: "text", text: "payload exceeds 256 KiB" }], isError: true });
      }
      try {
        const { structured } = await callMcpTool(name, args);
        return ok({
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!(err instanceof McpToolError) && !(err instanceof Error)) {
          return ok({ content: [{ type: "text", text: String(err) }], isError: true });
        }
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    case "resources/list":
      return ok({ resources: [] });
    case "resources/templates/list":
      return ok({ resourceTemplates: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      if (id === undefined) return null;
      return fail(-32601, `method not found: ${method}`);
  }
}
