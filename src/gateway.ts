/**
 * `warden-mcp gateway --config gateway.json`: WARDEN for platforms without agent hooks (OpenWebUI first; n8n,
 * LangChain and hand-written agents the same way). One process, one state per chat:
 *
 * - `/mcp/<name>`: proxy in front of an MCP server over Streamable HTTP (gateway-mcp.ts);
 * - `/openapi/<name>/…`: proxy in front of an OpenAPI tool server (gateway-openapi.ts);
 * - `/v1/prompt|source|pre|post|approve|health`: the decision service the platform adapter calls for what never passes
 *   a proxy — the person's message, web search and documents, the platform's own Python tools (gateway-decide.ts).
 *
 * Node built-ins only. Listens on 127.0.0.1 unless told otherwise; every route but /v1/health needs the bearer token.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { stderr, stdout } from 'node:process';
import { loadGatewayConfig, flowEnv, type GatewayConfig } from './gateway-config.js';
import { Decider, GatewayError, argsOf, whoOf, type Who } from './gateway-decide.js';
import { McpProxy } from './gateway-mcp.js';
import { OpenApiProxy, operationsOf } from './gateway-openapi.js';
import { packageVersion } from './mcp-rpc.js';
import { displaySafe } from './index.js';
import { MaskRefusal, USER_ORIGIN } from './mask.js';

export { operationsOf };

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization;
  return typeof h === 'string' && /^Bearer /i.test(h) ? h.slice(7).trim() : '';
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new GatewayError(413, `request body exceeds ${limit} bytes`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export interface Gateway { server: Server; decider: Decider; config: GatewayConfig; close(): Promise<void> }

export function createGateway(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env, logLine: (m: string) => void = m => stderr.write(`warden-gateway: ${displaySafe(m, 4000)}\n`)): Gateway {
  const decider = new Decider(config, env);
  const mcp = new Map(config.servers.filter(s => s.type === 'mcp-http').map(s => [s.name, new McpProxy(s, config, decider, logLine)]));
  const openapi = new Map(config.servers.filter(s => s.type === 'openapi').map(s => [s.name, new OpenApiProxy(s, config, decider, logLine)]));
  const version = packageVersion();

  const who = (req: IncomingMessage): Who => {
    // Raw, as /v1 takes them: an id with `%` is refused by the id check on both paths instead of naming two sessions.
    const h = (name: string) => { const v = req.headers[name]; return typeof v === 'string' ? v.trim() : ''; };
    return { user: h(config.userHeader), chat: h(config.chatHeader) };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = req.url ?? '/';
    // A dot segment (`..`, `.`, or encoded) would let a proxied path parameter climb to another route, e.g. /v1/approve.
    // A backslash (raw or encoded) is a separator to the URL parser: `/openapi/x/..\..\v1/health` would become /v1/health.
    const rawPath = raw.split('?')[0]!;
    if (/(^|[/\\])(\.|%2e){1,2}([/\\?#]|$)/i.test(rawPath) || /\\|%5c/i.test(rawPath)) return send(res, 400, { error: 'WARDEN gateway: dot segments and backslashes are not accepted in the path' });
    const url = new URL(raw, 'http://gateway');
    const path = url.pathname;
    const token = bearer(req);
    if (path === '/v1/health' && req.method === 'GET') {
      // Liveness for anyone; servers and mode only for a caller with the token.
      return send(res, 200, same(token, config.token) ? { ok: true, version, mode: decider.mode(), servers: config.servers.map(s => ({ name: s.name, type: s.type })) } : { ok: true, version });
    }
    const approveRoute = path === '/v1/approve';
    const accepted = approveRoute && config.approveToken ? same(token, config.approveToken) : same(token, config.token);
    if (!accepted) return send(res, 401, { error: 'WARDEN gateway: missing or wrong bearer token' });
    const body = await readBody(req, config.maxBodyBytes);
    if (path.startsWith('/v1/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      let b: Record<string, unknown>;
      try { const p = JSON.parse(body || '{}'); if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(); b = p; }
      catch { throw new GatewayError(400, 'body must be a JSON object'); }
      const w = whoOf(b);
      switch (path) {
        case '/v1/prompt': return send(res, 200, { ok: true, ...decider.prompt(w, b.prompt) });
        case '/v1/source': return send(res, 200, decider.source(w, b));
        case '/v1/pre': {
          const server = typeof b.server === 'string' ? b.server : 'openwebui';
          const tool = typeof b.tool_name === 'string' ? b.tool_name : '';
          const args = argsOf(b.tool_input);
          const answer = decider.pre(w, server, tool, args);
          if (answer.decision !== 'allow') return send(res, 200, { ...answer, refusal: decider.refusal(answer, tool) });
          // An allowed call: the adapter runs the tool with `tool_input` when masking put real values back.
          try {
            const restored = decider.restore(w, server, tool, args);
            return send(res, 200, { ...answer, ...(restored !== args ? { tool_input: restored } : {}) });
          } catch (e) {
            if (!(e instanceof MaskRefusal)) throw e;
            return send(res, 200, { decision: 'deny', reason: 'mask_scope', mode: answer.mode, message: e.message, refusal: e.message });
          }
        }
        case '/v1/post': {
          const server = typeof b.server === 'string' ? b.server : 'openwebui';
          const tool = typeof b.tool_name === 'string' ? b.tool_name : '';
          const answer = await decider.post(w, server, tool, argsOf(b.tool_input), b.tool_response, b.tool_error === true);
          // The adapter gives the model `tool_response` (masked) instead of the raw result, with `mask_note` after it.
          const masked = decider.mask(w, server, tool, b.tool_response);
          return send(res, 200, { ...answer, ...(masked.total ? { tool_response: masked.value, masked: masked.counts, ...(masked.note ? { mask_note: masked.note } : {}) } : {}) });
        }
        // Masking for adapters that hold the model's messages themselves (the OpenWebUI filter, the Hermes plugin).
        case '/v1/mask': {
          // `origin: "user"` for the person's own words; otherwise the server (and tool) the text came from.
          const origin = b.origin === 'user' ? USER_ORIGIN : typeof b.server === 'string' && b.server ? b.server : 'openwebui';
          const tool = typeof b.tool_name === 'string' ? b.tool_name : undefined;
          const masked = decider.mask(w, origin, tool, b.value, b.history === true);
          return send(res, 200, { value: masked.value, total: masked.total, counts: masked.counts, ...(masked.note ? { note: masked.note } : {}) });
        }
        case '/v1/restore': {
          const server = typeof b.server === 'string' && b.server ? b.server : 'openwebui';
          const tool = typeof b.tool_name === 'string' ? b.tool_name : '';
          try { return send(res, 200, { ok: true, value: decider.restore(w, server, tool, b.value) }); }
          catch (e) { if (e instanceof MaskRefusal) return send(res, 200, { ok: false, refusal: e.message }); throw e; }
        }
        case '/v1/reveal': {
          if (typeof b.text !== 'string') throw new GatewayError(400, 'text must be a string');
          return send(res, 200, { text: decider.reveal(w, b.text) });
        }
        case '/v1/approve': return send(res, 200, decider.approve(w, b.code, b.approved, b.peek === true));
      }
      return send(res, 404, { error: 'unknown route' });
    }
    const m = /^\/(mcp|openapi)\/([A-Za-z0-9_-]{1,64})(\/.*)?$/.exec(path);
    const kind = m?.[1], name = m?.[2] ?? '', rest = m?.[3];
    const mp = kind === 'mcp' ? mcp.get(name) : undefined, op = kind === 'openapi' ? openapi.get(name) : undefined;
    if (mp && (!rest || rest === '/')) return mp.handle(req, res, body, who(req));
    if (op) return op.handle(req, res, rest ?? '/', url.search.slice(1), body, who(req));
    return send(res, 404, { error: 'unknown route' });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(err => {
      const status = err instanceof GatewayError ? err.status : 500;
      if (!(err instanceof GatewayError)) logLine(`error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      send(res, status, { error: err instanceof GatewayError ? err.message : 'WARDEN gateway internal error; the call was not judged and is refused' });
    });
  });
  server.requestTimeout = 0; // the MCP GET stream is long-lived; upstream requests carry their own timeout
  server.headersTimeout = 30_000;
  const purge = () => { const n = decider.purge(); if (n) logLine(`removed ${n} chat state files older than ${config.retentionDays} days`); };
  purge();
  const timer = setInterval(purge, 6 * 3_600_000);
  timer.unref();
  return {
    server, decider, config,
    close: () => new Promise<void>(resolve => { clearInterval(timer); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

const USAGE = `Usage: warden-mcp gateway --config gateway.json
       warden-mcp gateway labels --config gateway.json

Runs the HTTP proxy for MCP (Streamable HTTP) and OpenAPI tool servers and the flow-guard decision service for
platforms without agent hooks, such as OpenWebUI. See docs/gateway.md and docs/openwebui.md.
`;

export async function runGatewayCli(argv: string[]): Promise<number> {
  const args = [...argv];
  const labels = args[0] === 'labels';
  if (labels) args.shift();
  let configPath: string | undefined;
  while (args.length) {
    const a = args.shift()!;
    if (a === '--config') configPath = args.shift();
    else if (a === '--help' || a === '-h') { stdout.write(USAGE); return 0; }
    else { stderr.write(`warden-mcp gateway: unknown argument ${displaySafe(a, 100)}\n${USAGE}`); return 2; }
  }
  if (!configPath) { stderr.write(USAGE); return 2; }
  let config: GatewayConfig;
  try { config = loadGatewayConfig(configPath); }
  catch (e) { stderr.write(`warden-mcp gateway: ${displaySafe(e instanceof Error ? e.message : String(e), 2000)}\n`); return 2; }
  if (labels) {
    stdout.write((await import('./flow-guard.js')).flowLabelsReport(flowEnv(config)));
    return 0;
  }
  const g = createGateway(config);
  await new Promise<void>((resolve, reject) => { g.server.once('error', reject); g.server.listen(config.port, config.host, () => resolve()); });
  stderr.write(`warden-gateway: listening on http://${config.host}:${config.port} (mode ${g.decider.mode()}, ${config.servers.length} servers, state ${config.stateDir})\n`);
  await new Promise<void>(resolve => {
    const stop = () => { void g.close().then(resolve); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
  return 0;
}
