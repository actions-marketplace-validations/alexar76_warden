/**
 * `warden-mcp gateway`: the proxy in front of an MCP server over Streamable HTTP. What `wrap` does for stdio, through
 * the same checks:
 * - `tools/list` is answered by the gateway: it reads every page from the server, runs the tool-definition gates and
 *   pinning (`vetAndPin`, the function `wrap` uses) and returns only the tools the verdict allows;
 * - `tools/call` asks the decision service first (`flowPre`), forwards an allowed call, records the result
 *   (`flowPost`) and screens it (`screenResult`) before the client sees it;
 * - `resources/read`, `prompts/get` and `completion/complete` are judged, recorded and screened the same way;
 * - everything else (initialize, notifications, listings, the GET stream, DELETE) passes through, and in its answers
 *   only the response to the client's own request, requests and notifications reach the client.
 *
 * A refused call is an MCP tool error (`isError: true`) with the reason and, for `ask`, the approval code, so the model
 * reads why and the person can approve. Responses come back as JSON or as an SSE stream, like the server's.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FilePinStore, Warden, displaySafe, pinToolsHash } from './index.js';
import { ThreatFeed } from './threat-feed.js';
import { listAllTools } from './tool-list.js';
import { vetAndPin, WardenBlock } from './wrap-state.js';
import type { McpServerRef, ToolDef, WardenVerdict } from './types.js';
import type { GatewayConfig, GatewayServer } from './gateway-config.js';
import { Decider, GatewayError, type Who } from './gateway-decide.js';

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: any; error?: any };

/** Headers a client may send on to the tool server. Its Authorization is the gateway's token and stays here. */
// No `last-event-id`: a resumed stream could replay a tool response the gateway never screened.
const PASS_REQUEST = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version'];
/** Reads whose results reach the model like a tool result: recorded as outside text and screened. */
const READ_METHODS: Record<string, string> = { 'resources/read': 'resources_read', 'prompts/get': 'prompts_get', 'completion/complete': 'completion_complete' };
/** JSON-RPC ids compare as the client compares them: 5 and "5" are one id (the MCP Python SDK normalises them). */
const sameId = (a: unknown, b: unknown) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
/**
 * What one message from the tool server is, judged the way a lenient client reads it: anything that carries `result` or
 * `error` is a response, whatever its `method` says (`"method": null` is still an answer to the MCP Python SDK). Only a
 * message with a string `method` and neither field is a request or notification. Empty event data carries nothing.
 */
type Kind = 'empty' | 'message' | 'response' | 'other';
function kindOf(data: string): { kind: Kind; m?: Rpc } {
  if (!data.trim()) return { kind: 'empty' };
  let m: any;
  try { m = JSON.parse(data); } catch { return { kind: 'other' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { kind: 'other' };
  if ('result' in m || 'error' in m) return { kind: 'response', m };
  if (typeof m.method === 'string') return { kind: 'message', m };
  return { kind: 'other' };
}
/** Headers the server's answer may carry back to the client. */
const PASS_RESPONSE = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control'];
const MAX_SESSIONS = 2000;

export interface SseEvent { id?: string; event?: string; data: string }

/** Split an SSE body into events (WHATWG rules for `data`, `id`, `event`; comments and `retry` ignored). */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data: string[] = [];
    let id: string | undefined, event: string | undefined;
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':'), field = i < 0 ? line : line.slice(0, i);
      let value = i < 0 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
      else if (field === 'event') event = value;
    }
    if (data.length) events.push({ ...(id !== undefined ? { id } : {}), ...(event !== undefined ? { event } : {}), data: data.join('\n') });
  }
  return events;
}

function sseFrame(e: SseEvent): string {
  return `${e.event ? `event: ${e.event}\n` : ''}${e.id !== undefined ? `id: ${e.id}\n` : ''}${e.data.split('\n').map(l => `data: ${l}`).join('\n')}\n\n`;
}

async function readLimited(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); throw new GatewayError(502, `tool server response exceeds ${limit} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseRpc(text: string): Rpc {
  const m = JSON.parse(text);
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.jsonrpc !== '2.0') throw new GatewayError(400, 'expected one JSON-RPC 2.0 message');
  if (m.id !== undefined && m.id !== null && typeof m.id !== 'string' && typeof m.id !== 'number') throw new GatewayError(400, 'invalid JSON-RPC id');
  return m as Rpc;
}

export class McpProxy {
  private readonly ref: McpServerRef;
  private readonly store: FilePinStore;
  private feed?: ThreatFeed;
  /** What the last vetted tools/list exposed, per server session: a call to anything else is refused. */
  private visible = new Map<string, ToolDef[]>();

  constructor(private server: GatewayServer, private config: GatewayConfig, private decider: Decider, private logLine: (m: string) => void) {
    this.ref = { id: `gateway:${server.name}`, name: server.name, transport: 'http', url: server.url };
    this.store = new FilePinStore(join(config.stateDir, 'pins'));
  }

  private async warden(): Promise<{ warden: Warden; feed: ThreatFeed }> {
    if (!this.feed) {
      const quiet = { debug() {}, info() {}, warn: (m: string) => this.logLine(m), error: (m: string) => this.logLine(m), child() { return this as any; } };
      this.feed = new ThreatFeed({ stateDir: this.config.stateDir, log: quiet as any });
      await this.feed.load(undefined);
    }
    return { warden: Warden.create({ policy: this.config.policy, threatFeed: this.feed, store: this.store }), feed: this.feed };
  }

  private upstreamHeaders(req: IncomingMessage): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    for (const k of PASS_REQUEST) { const v = req.headers[k]; if (typeof v === 'string') h[k] = v; }
    return { ...h, ...this.server.headers };
  }

  private async send(method: string, headers: Record<string, string>, body?: string): Promise<Response> {
    try {
      return await fetch(this.server.url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.config.upstreamTimeoutMs) });
    } catch (e) {
      throw new GatewayError(502, `tool server ${this.server.name} did not answer (${e instanceof Error ? e.name : 'error'})`);
    }
  }

  /** One request to the server, waiting for the response with this id (JSON body or SSE stream). */
  private async request(headers: Record<string, string>, msg: Rpc): Promise<{ msg: Rpc; bytes: number }> {
    const res = await this.send('POST', headers, JSON.stringify(msg));
    const text = await readLimited(res, this.config.maxBodyBytes);
    if (!res.ok) throw new GatewayError(502, `tool server ${this.server.name} answered HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    const candidates = type.includes('text/event-stream') ? parseSse(text).map(e => e.data) : [text];
    for (const c of candidates) {
      const k = kindOf(c);
      if (k.kind !== 'response' || !sameId(k.m!.id, msg.id)) continue;
      let m: Rpc;
      try { m = parseRpc(c); } catch { continue; }
      return { msg: m, bytes: Buffer.byteLength(c) };
    }
    throw new GatewayError(502, `tool server ${this.server.name} sent no response to ${msg.method}`);
  }

  private key(req: IncomingMessage): string {
    const s = req.headers['mcp-session-id'];
    return typeof s === 'string' ? s : '';
  }

  /** Read every page, vet and pin, remember what may be called. Throws WardenBlock when the verdict blocks. */
  private async vetList(req: IncomingMessage): Promise<ToolDef[]> {
    const headers = this.upstreamHeaders(req);
    const tools = await listAllTools(async cursor => {
      const r = await this.request(headers, { jsonrpc: '2.0', id: `warden:${randomUUID()}`, method: 'tools/list', ...(cursor ? { params: { cursor } } : {}) });
      if (r.msg.error) throw new GatewayError(502, 'tools/list failed: ' + displaySafe(JSON.stringify(r.msg.error), 500));
      return { result: r.msg.result, bytes: r.bytes };
    });
    const { warden, feed } = await this.warden();
    const record = (v: WardenVerdict) => this.logLine(`${v.allow ? 'ALLOW' : 'BLOCK'} ${this.ref.id} score=${v.score.toFixed(2)} ${v.findings.map(f => `${displaySafe(f.code)}${f.tool ? `(${displaySafe(f.tool)})` : ''}`).join(' ')}`);
    let verdict: WardenVerdict;
    try { verdict = await vetAndPin(this.config.stateDir, this.ref, tools, this.config.policy, this.store, warden, feed, false, () => true, record); }
    catch (e) { this.visible.clear(); throw e; }
    // Nothing any session saw before stays callable once a list is blocked.
    if (!verdict.allow) this.visible.clear();
    if (!verdict.allow) throw new WardenBlock(`blocked by WARDEN: ${verdict.findings.filter(f => !f.advisory).map(f => f.code).join(', ')}; review with WARDEN_STATE_DIR=${this.config.stateDir} warden-mcp pins status --id ${this.ref.id}`);
    const allowed = tools.filter(t => verdict.allowedTools.includes(t.name));
    if (this.visible.size >= MAX_SESSIONS) this.visible.delete(this.visible.keys().next().value!);
    this.visible.set(this.key(req), allowed);
    return allowed;
  }

  private json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...extra });
    res.end(JSON.stringify(body));
  }

  private toolError(id: Rpc['id'], text: string): Rpc {
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
  }

  async handle(req: IncomingMessage, res: ServerResponse, body: string, who: Who): Promise<void> {
    if (req.method === 'GET' || req.method === 'DELETE') return this.passThrough(req, res, undefined);
    if (req.method !== 'POST') return this.json(res, 405, { error: 'method not allowed' });
    let msg: Rpc;
    try { msg = parseRpc(body); }
    catch { return this.json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'WARDEN gateway accepts one JSON-RPC 2.0 message per request' } }); }
    const sessionHeader: Record<string, string> = this.key(req) ? { 'mcp-session-id': this.key(req) } : {};
    if (msg.method === 'tools/list' && msg.id !== undefined) {
      try {
        const tools = await this.vetList(req);
        return this.json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools } }, sessionHeader);
      } catch (e) {
        // A list WARDEN blocked, or could not read or check (too long, invalid, server down), exposes no tools. It is an
        // empty list, not an error: some clients (OpenWebUI 0.11) fail the whole message on a tools/list error, and the
        // chat's other servers should keep working. Every call to this server is refused until a list passes.
        this.visible.clear();
        this.logLine(`${this.ref.id}: no tools exposed: ${e instanceof Error ? e.message : String(e)}`);
        return this.json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools: [] } }, sessionHeader);
      }
    }
    if (msg.method === 'tools/call' && msg.id === undefined) {
      // A call sent as a notification gets no answer to judge; some servers would run it anyway.
      return this.json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'WARDEN gateway: tools/call must carry an id' } });
    }
    if (msg.method === 'tools/call') return this.call(req, res, msg, who, sessionHeader);
    if (msg.method && READ_METHODS[msg.method] && msg.id !== undefined) return this.read(req, res, msg, who, sessionHeader);
    return this.passThrough(req, res, body);
  }

  /**
   * resources/read, prompts/get, completion/complete: judged like a tool call before they are sent (a resource URI or a
   * prompt argument can carry data out), forwarded, and their result recorded as outside text and screened. A refusal
   * is a JSON-RPC error with the guard's reason; there is no tool call for the model to repeat after an approval.
   */
  private async read(req: IncomingMessage, res: ServerResponse, msg: Rpc, who: Who, sessionHeader: Record<string, string>): Promise<void> {
    const tool = READ_METHODS[msg.method!]!;
    const args = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? msg.params : {};
    const fail = (message: string) => this.json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message } }, sessionHeader);
    let pre;
    try { pre = this.decider.pre(who, this.server.name, tool, args); }
    catch (e) { return fail(`WARDEN: ${e instanceof Error ? e.message : String(e)}`); }
    if (pre.decision !== 'allow') return fail(this.decider.refusal(pre, tool));
    const r = await this.request(this.upstreamHeaders(req), msg);
    let post;
    try { post = await this.decider.post(who, this.server.name, tool, args, r.msg.error !== undefined ? { error: r.msg.error } : r.msg.result, r.msg.error !== undefined); }
    catch { return fail('WARDEN flow guard could not record this result; withheld.'); }
    if (post.withhold) return fail(`Result withheld by WARDEN: it reads as instructions to the model (${(post.codes ?? []).join(', ')}).`);
    const notice = [post.notice, post.flowNote ? `[WARDEN] ${post.flowNote}` : undefined].filter(Boolean).join('\n');
    const result = r.msg.result;
    // The notice goes where the model reads: a resource's contents, a prompt's messages. A completion is argument
    // suggestions for the person, not text for the model.
    if (notice && result && Array.isArray(result.contents) && msg.method === 'resources/read') {
      return this.json(res, 200, { ...r.msg, id: msg.id, result: { ...result, contents: [{ uri: 'warden:notice', mimeType: 'text/plain', text: notice }, ...result.contents] } }, sessionHeader);
    }
    if (notice && result && Array.isArray(result.messages) && msg.method === 'prompts/get') {
      return this.json(res, 200, { ...r.msg, id: msg.id, result: { ...result, messages: [{ role: 'user', content: { type: 'text', text: notice } }, ...result.messages] } }, sessionHeader);
    }
    return this.json(res, 200, { ...r.msg, id: msg.id }, sessionHeader);
  }

  private async call(req: IncomingMessage, res: ServerResponse, msg: Rpc, who: Who, sessionHeader: Record<string, string>): Promise<void> {
    const name = typeof msg.params?.name === 'string' ? msg.params.name : '';
    const rawArgs = msg.params?.arguments ?? {};
    if (!name || !rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return this.json(res, 200, this.toolError(msg.id, 'WARDEN: tools/call needs a tool name and an arguments object.'), sessionHeader);
    const args = rawArgs as Record<string, unknown>;
    let visible = this.visible.get(this.key(req));
    try { if (!visible) visible = await this.vetList(req); }
    catch (e) { return this.json(res, 200, this.toolError(msg.id, e instanceof Error ? e.message : String(e)), sessionHeader); }
    if (!visible.some(t => t.name === name)) return this.json(res, 200, this.toolError(msg.id, `WARDEN: ${displaySafe(name, 128)} is not among the tools this server exposed after the check; list tools again.`), sessionHeader);
    let pre;
    try { pre = this.decider.pre(who, this.server.name, name, args); }
    catch (e) { return this.json(res, 200, this.toolError(msg.id, `WARDEN: ${e instanceof Error ? e.message : String(e)}`), sessionHeader); }
    if (pre.decision !== 'allow') return this.json(res, 200, this.toolError(msg.id, this.decider.refusal(pre, name)), sessionHeader);
    const upstream = await this.send('POST', this.upstreamHeaders(req), JSON.stringify(msg));
    const type = upstream.headers.get('content-type') ?? '';
    const passHeaders = this.responseHeaders(upstream);
    const finish = async (m: Rpc): Promise<Rpc> => {
      const isError = m.error !== undefined || m.result?.isError === true;
      let post;
      try { post = await this.decider.post(who, this.server.name, name, args, m.error !== undefined ? { error: m.error } : m.result, isError); }
      catch { return this.toolError(msg.id, 'WARDEN flow guard could not record this result; withheld to avoid untracked outside text. The tool already ran.'); }
      if (post.withhold) return this.toolError(msg.id, `Tool result withheld by WARDEN: it reads as instructions to the model (${(post.codes ?? []).join(', ')}). The tool already ran.`);
      if (m.result && Array.isArray(m.result.content) && (post.notice || post.flowNote)) {
        return { ...m, result: { ...m.result, content: [
          ...(post.notice ? [{ type: 'text', text: post.notice }] : []), ...m.result.content,
          ...(post.flowNote ? [{ type: 'text', text: `[WARDEN] ${post.flowNote}` }] : [])] } };
      }
      if ((post.notice || post.flowNote) && m.error) return { ...m, error: { ...m.error, message: [post.notice, String(m.error.message ?? ''), post.flowNote].filter(Boolean).join('\n') } };
      return m;
    };
    if (!upstream.ok) {
      const text = await readLimited(upstream, this.config.maxBodyBytes).catch(() => '');
      res.writeHead(upstream.status, passHeaders); res.end(text); return;
    }
    if (!type.includes('text/event-stream')) {
      const text = await readLimited(upstream, this.config.maxBodyBytes);
      let m: Rpc;
      try { if (kindOf(text).kind !== 'response') throw new Error('not a response'); m = parseRpc(text); }
      catch { return this.json(res, 200, this.toolError(msg.id, 'WARDEN: the tool server sent an unreadable response.'), sessionHeader); }
      return this.json(res, 200, await finish({ ...m, id: msg.id }), { ...passHeaders, 'content-type': 'application/json' });
    }
    // SSE: notifications (progress, logs) go on as they arrive; the response itself waits for its checks.
    res.writeHead(200, { ...passHeaders, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const reader = upstream.body!.getReader();
    let buffer = '', size = 0, answered = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.config.maxBodyBytes) throw new GatewayError(502, 'tool server response too large');
        buffer += Buffer.from(value).toString('utf8');
        const parts = buffer.replace(/\r\n?/g, '\n').split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const e of parseSse(part + '\n\n')) {
            const k = kindOf(e.data);
            if (k.kind === 'response' && sameId(k.m!.id, msg.id)) {
              let m: Rpc;
              try { m = parseRpc(e.data); } catch { continue; }
              res.write(sseFrame({ ...e, data: JSON.stringify(await finish({ ...m, id: msg.id })) }));
              answered = true;
            } else if (k.kind === 'message' || k.kind === 'empty') res.write(sseFrame(e));
            // Any other response, a batch or unreadable data is dropped: only the screened answer to this call may reach
            // the client.
          }
        }
        if (answered) break;
      }
    } catch (e) {
      if (!answered) res.write(sseFrame({ data: JSON.stringify(this.toolError(msg.id, `WARDEN: ${e instanceof Error ? e.message : String(e)}`)) }));
      answered = true;
    } finally {
      await reader.cancel().catch(() => {});
      if (!answered) res.write(sseFrame({ data: JSON.stringify(this.toolError(msg.id, 'WARDEN: the tool server closed the stream without a response.')) }));
      res.end();
    }
  }

  private responseHeaders(upstream: Response): Record<string, string> {
    const h: Record<string, string> = {};
    for (const k of PASS_RESPONSE) { const v = upstream.headers.get(k); if (v) h[k] = v; }
    return h;
  }

  /** Everything the gateway does not judge: sent on, answered as the server answers (streamed). */
  private async passThrough(req: IncomingMessage, res: ServerResponse, body: string | undefined): Promise<void> {
    const headers = this.upstreamHeaders(req);
    if (req.method === 'GET') { headers.accept = 'text/event-stream'; delete headers['content-type']; }
    let upstream: Response;
    try {
      // The GET stream stays open for as long as the client keeps it: no request timeout on it.
      upstream = req.method === 'GET'
        ? await fetch(this.server.url, { method: 'GET', headers, redirect: 'manual' })
        : await this.send(req.method ?? 'POST', headers, body);
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError(502, `tool server ${this.server.name} did not answer`);
    }
    const sse = (upstream.headers.get('content-type') ?? '').includes('text/event-stream');
    // The answer to the client's own request passes; in the GET stream there is no such request.
    let ownId: unknown;
    try { ownId = body ? (JSON.parse(body) as Rpc).id : undefined; } catch { ownId = undefined; }
    if (!sse && req.method === 'POST' && upstream.body) {
      // A JSON answer is read whole (bounded) and passes only as the response to this request, or as a request or
      // notification: a response to another id, or a batch, could carry a tool result past the screen.
      const text = await readLimited(upstream, this.config.maxBodyBytes);
      const k = kindOf(text);
      const ok = k.kind === 'empty' || k.kind === 'message' || (k.kind === 'response' && sameId(k.m!.id, ownId));
      if (!ok) return this.json(res, 502, { jsonrpc: '2.0', id: ownId ?? null, error: { code: -32603, message: 'WARDEN gateway: the tool server answered with a message that is not the response to this request; dropped.' } });
      res.writeHead(upstream.status, this.responseHeaders(upstream));
      res.end(text);
      return;
    }
    res.writeHead(upstream.status, this.responseHeaders(upstream));
    if (!upstream.body) { res.end(); return; }
    const reader = upstream.body.getReader();
    req.on('close', () => { reader.cancel().catch(() => {}); });
    let size = 0, buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        // A POST answer is bounded; the GET stream is a long-lived channel, bounded per event.
        if (req.method !== 'GET' && size > this.config.maxBodyBytes) break;
        if (!sse) { res.write(value); continue; }
        // In a stream the gateway did not open for a call, responses are dropped: a tool result could otherwise arrive
        // here (a resumed or misrouted answer) without being screened or recorded. Requests and notifications pass.
        buffer += Buffer.from(value).toString('utf8');
        if (buffer.length > this.config.maxBodyBytes) { buffer = ''; continue; }
        const parts = buffer.replace(/\r\n?/g, '\n').split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const e of parseSse(part + '\n\n')) {
            const k = kindOf(e.data);
            if (k.kind === 'message' || k.kind === 'empty' || (k.kind === 'response' && sameId(k.m!.id, ownId))) res.write(sseFrame(e));
          }
        }
      }
    } catch { /* client or server went away */ }
    res.end();
  }

  /** For tests and `gateway labels`: the tools the last check exposed for a session key. */
  exposed(sessionKey = ''): ToolDef[] | undefined { return this.visible.get(sessionKey); }
  static hash(tools: ToolDef[]): string { return pinToolsHash(tools); }
}
