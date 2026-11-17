/**
 * `warden-mcp gateway`: the proxy in front of an OpenAPI tool server (OpenWebUI's "OpenAPI tool servers", `mcpo`).
 * Every operation in the server's `openapi.json` is a tool named by its `operationId`; to the flow policy it is
 * `mcp__<server>__<operationId>`. Operation descriptions get the same gates and pinning as an MCP `tools/list`, and the
 * spec the client receives lists only the operations the verdict allows. A call is matched to its operation, judged
 * by the decision service, forwarded, recorded and screened.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { FilePinStore, Warden, displaySafe } from './index.js';
import { ThreatFeed } from './threat-feed.js';
import { vetAndPin, WardenBlock } from './wrap-state.js';
import type { McpServerRef, ToolDef, WardenVerdict } from './types.js';
import type { GatewayConfig, GatewayServer } from './gateway-config.js';
import { Decider, GatewayError, type Who } from './gateway-decide.js';
import { createHash } from 'node:crypto';
import { canonicalizeRfc8785 } from './jcs.js';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const MAX_OPERATIONS = 500;

interface Operation { id: string; method: string; path: string; regex: RegExp; params: string[]; tool: ToolDef; literal: number }

/** OpenAPI's own rule: a path with more literal segments wins over a templated one (`/files/purge` over `/files/{name}`). */
export function matchOperation(ops: Operation[], method: string, path: string): Operation {
  const hits = ops.filter(o => o.method === method && o.regex.test(path)).sort((a, b) => b.literal - a.literal);
  if (!hits.length) throw new GatewayError(404, 'WARDEN: no allowed operation matches this request');
  if (hits.length > 1 && hits[0]!.literal === hits[1]!.literal) throw new GatewayError(400, `WARDEN: the request matches ${hits[0]!.id} and ${hits[1]!.id} equally; refused`);
  return hits[0]!;
}

function obj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
}

/** Resolve a local `#/components/...` reference once (no network, bounded depth). */
function deref(spec: any, v: any, depth = 0): any {
  if (depth > 8 || !v || typeof v !== 'object') return v;
  if (typeof v.$ref === 'string' && v.$ref.startsWith('#/')) {
    let cur = spec;
    for (const part of v.$ref.slice(2).split('/')) cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    return deref(spec, cur, depth + 1);
  }
  return v;
}

/** The spec's operations as tools, in the shape the MCP gates read. */
export function operationsOf(spec: unknown): Operation[] {
  const s = obj(spec), ops: Operation[] = [], ids = new Set<string>();
  for (const [path, item] of Object.entries(obj(s.paths))) {
    for (const method of METHODS) {
      const op = obj(obj(item)[method]);
      if (!Object.keys(op).length) continue;
      const id = typeof op.operationId === 'string' && op.operationId ? op.operationId : `${method}_${path}`.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id) || ids.has(id)) throw new GatewayError(502, `OpenAPI operation id ${displaySafe(id, 80)} is invalid or repeated`);
      ids.add(id);
      const properties: Record<string, unknown> = {}, required: string[] = [];
      const params = [...(Array.isArray(obj(item).parameters) ? obj(item).parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])].map(p => deref(s, p));
      for (const p of params) {
        if (typeof p?.name !== 'string') continue;
        properties[p.name] = { ...obj(deref(s, p.schema)), ...(typeof p.description === 'string' ? { description: p.description } : {}) };
        if (p.required) required.push(p.name);
      }
      const body = obj(deref(s, obj(obj(deref(s, op.requestBody)).content)['application/json']?.schema));
      for (const [k, v] of Object.entries(obj(body.properties))) properties[k] = deref(s, v);
      if (Array.isArray(body.required)) required.push(...body.required.filter((x: unknown) => typeof x === 'string'));
      const description = [op.summary, op.description].filter(x => typeof x === 'string' && x).join('\n\n');
      const tool: ToolDef = { name: id, description, inputSchema: { type: 'object', properties, ...(required.length ? { required: [...new Set(required)] } : {}) } };
      const names: string[] = [];
      const regex = new RegExp('^' + path.split(/(\{[^}]+\})/).map(seg => {
        const m = /^\{([^}]+)\}$/.exec(seg);
        if (m) { names.push(m[1]!); return '([^/]+)'; }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('') + '$');
      ops.push({ id, method: method.toUpperCase(), path, regex, params: names, tool, literal: path.split('/').filter(seg => seg && !/^\{[^}]+\}$/.test(seg)).length });
      if (ops.length > MAX_OPERATIONS) throw new GatewayError(502, `OpenAPI spec has more than ${MAX_OPERATIONS} operations`);
    }
  }
  return ops;
}

export class OpenApiProxy {
  private readonly ref: McpServerRef;
  private readonly store: FilePinStore;
  private feed?: ThreatFeed;
  /** The last vetted spec, by the digest of its bytes: an unchanged spec is not vetted again, a changed one always is. */
  private allowed?: { ops: Operation[]; spec: Record<string, any>; digest: string };

  constructor(private server: GatewayServer, private config: GatewayConfig, private decider: Decider, private logLine: (m: string) => void) {
    this.ref = { id: `gateway:${server.name}`, name: server.name, transport: 'http', url: server.url };
    this.store = new FilePinStore(join(config.stateDir, 'pins'));
  }

  private base(): string { return this.server.url.endsWith('/') ? this.server.url : this.server.url + '/'; }

  private async fetchUp(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path.replace(/^\/+/, ''), this.base()), { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), ...this.server.headers }, redirect: 'manual', signal: AbortSignal.timeout(this.config.upstreamTimeoutMs) });
    } catch (e) {
      throw new GatewayError(502, `tool server ${this.server.name} did not answer (${e instanceof Error ? e.name : 'error'})`);
    }
  }

  private async text(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > this.config.maxBodyBytes) { await reader.cancel().catch(() => {}); throw new GatewayError(502, 'tool server response too large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * Fetch the spec on every request (the spec read and every call), vet the operations when the spec changed, keep the
   * allowed ones. A server that changes its spec between two calls is checked before the second call runs.
   */
  async check(): Promise<{ ops: Operation[]; spec: Record<string, any> }> {
    const previous = this.allowed;
    // A failed or blocked check leaves nothing callable from an earlier one.
    this.allowed = undefined;
    const res = await this.fetchUp(this.server.specPath ?? 'openapi.json', { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) throw new GatewayError(502, `tool server ${this.server.name} spec answered HTTP ${res.status}`);
    const raw = await this.text(res);
    const digest = createHash('sha256').update(raw).digest('hex');
    if (previous && previous.digest === digest) { this.allowed = previous; return previous; }
    let spec: Record<string, any>;
    try { spec = obj(JSON.parse(raw)); } catch { throw new GatewayError(502, 'tool server spec is not JSON'); }
    const ops = operationsOf(spec);
    if (!this.feed) {
      const quiet = { debug() {}, info() {}, warn: (m: string) => this.logLine(m), error: (m: string) => this.logLine(m), child() { return this as any; } };
      this.feed = new ThreatFeed({ stateDir: this.config.stateDir, log: quiet as any });
      await this.feed.load(undefined);
    }
    const warden = Warden.create({ policy: this.config.policy, threatFeed: this.feed, store: this.store });
    const record = (v: WardenVerdict) => this.logLine(`${v.allow ? 'ALLOW' : 'BLOCK'} ${this.ref.id} score=${v.score.toFixed(2)} ${v.findings.map(f => `${displaySafe(f.code)}${f.tool ? `(${displaySafe(f.tool)})` : ''}`).join(' ')}`);
    const verdict = await vetAndPin(this.config.stateDir, this.ref, ops.map(o => o.tool), this.config.policy, this.store, warden, this.feed, false, () => true, record);
    if (!verdict.allow) throw new WardenBlock(`blocked by WARDEN: ${verdict.findings.filter(f => !f.advisory).map(f => f.code).join(', ')}; review with WARDEN_STATE_DIR=${this.config.stateDir} warden-mcp pins status --id ${this.ref.id}`);
    const keep = ops.filter(o => verdict.allowedTools.includes(o.id));
    // The client sees only allowed operations, and calls them through this proxy (no `servers` to go around it).
    const paths: Record<string, any> = {};
    for (const [path, item] of Object.entries(obj(spec.paths))) {
      const copy: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj(item))) {
        // No `servers` at any level: every call must come back through this proxy.
        if (k === 'servers') continue;
        if (!METHODS.includes(k)) { copy[k] = v; continue; }
        if (keep.some(o => o.path === path && o.method === k.toUpperCase())) { const op = { ...obj(v) }; delete op.servers; copy[k] = op; }
      }
      if (Object.keys(copy).some(k => METHODS.includes(k))) paths[path] = copy;
    }
    const filtered: Record<string, any> = { ...spec, paths };
    delete filtered.servers;
    this.allowed = { ops: keep, spec: filtered, digest };
    return this.allowed;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async handle(req: IncomingMessage, res: ServerResponse, sub: string, query: string, body: string, who: Who): Promise<void> {
    const specPath = '/' + (this.server.specPath ?? 'openapi.json');
    if (req.method === 'GET' && sub === specPath) {
      try { return this.json(res, 200, (await this.check()).spec); }
      catch (e) { if (e instanceof WardenBlock) return this.json(res, 403, { detail: e.message }); throw e; }
    }
    let checked;
    try { checked = await this.check(); }
    catch (e) { if (e instanceof WardenBlock) return this.json(res, 403, { detail: e.message }); throw e; }
    const method = (req.method ?? 'GET').toUpperCase();
    let op: Operation;
    try { op = matchOperation(checked.ops, method, sub); }
    catch (e) { const g = e as GatewayError; return this.json(res, g.status ?? 400, { detail: g.message }); }
    // One flat argument set for the flow guard, but a name may come from one place only: a body key that repeats a path
    // or query parameter would let one approved request stand for another.
    const args: Record<string, unknown> = {};
    const add = (k: string, v: unknown) => { if (Object.prototype.hasOwnProperty.call(args, k)) throw new GatewayError(400, `WARDEN: argument ${displaySafe(k, 60)} appears in more than one place; refused`); args[k] = v; };
    // What goes upstream is what WARDEN judged: the body as parsed, written in RFC 8785 form. A raw body could differ
    // from its parse (a repeated key that another parser reads first, an integer past 2^53 that JSON.parse rounds).
    let sent = '';
    try {
      const m = op.regex.exec(sub)!;
      op.params.forEach((p, i) => add(p, decodeURIComponent(m[i + 1] ?? '')));
      for (const [k, v] of new URLSearchParams(query)) add(k, v);
      if (body) {
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { throw new GatewayError(400, 'WARDEN gateway forwards JSON request bodies only'); }
        if (/(^|[^0-9.eE+-])-?\d{16,}(?![0-9.eE])/.test(body.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
          throw new GatewayError(400, 'WARDEN: the body has an integer too long to check exactly (more than 15 digits); send it as a string');
        }
        try { sent = canonicalizeRfc8785(parsed); } catch { throw new GatewayError(400, 'WARDEN: the body has no canonical JSON form; refused'); }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) for (const [k, v] of Object.entries(parsed)) add(k, v);
        else add('body', parsed);
      }
    } catch (e) { const g = e as GatewayError; return this.json(res, g.status ?? 400, { detail: g.message }); }
    // The approval is bound to the exact request forwarded, not only to the arguments read from it.
    const bind = createHash('sha256').update(`${method}\n${sub}\n${query}\n${sent}`).digest('hex');
    let pre;
    try { pre = this.decider.pre(who, this.server.name, op.id, args, bind); }
    catch (e) { const g = e as GatewayError; return this.json(res, g.status ?? 400, { detail: g.message }); }
    if (pre.decision !== 'allow') return this.json(res, 403, { detail: this.decider.refusal(pre, op.id) });
    const upstream = await this.fetchUp(sub + (query ? `?${query}` : ''), { method, headers: { accept: 'application/json', ...(sent ? { 'content-type': 'application/json' } : {}) }, ...(sent ? { body: sent } : {}) });
    const text = await this.text(upstream);
    let result: unknown = text;
    try { result = JSON.parse(text); } catch { /* plain text */ }
    const post = await this.decider.post(who, this.server.name, op.id, args, result, !upstream.ok);
    if (post.withhold) return this.json(res, 502, { detail: `Tool result withheld by WARDEN: it reads as instructions to the model (${(post.codes ?? []).join(', ')}). The tool already ran.` });
    // JSON results keep their shape; only text that addressed the model gets a note next to it.
    const notice = [post.notice, post.instruction ? post.flowNote : undefined].filter(Boolean).join('\n');
    if (!notice) {
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(text); return;
    }
    const wrapped = result && typeof result === 'object' && !Array.isArray(result) ? { warden_notice: notice, ...result as object } : { warden_notice: notice, result };
    return this.json(res, upstream.status, wrapped);
  }
}
