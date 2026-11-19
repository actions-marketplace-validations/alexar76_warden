import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createGateway } from '../src/gateway.js';
import { loadGatewayConfig } from '../src/gateway-config.js';
import { CHAT_HEADERS, Owui, check, parseEnv, planConnections, routedName, setup, undo, type OwuiConnection, type SetupOptions } from '../src/openwebui-setup.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

async function listen(server: Server, port = 0): Promise<string> {
  await new Promise<void>(r => server.listen(port, '127.0.0.1', () => r()));
  cleanup.push(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(r => s.close(() => r()));
  return port;
}

function body(req: any): Promise<string> {
  return new Promise(r => { let b = ''; req.on('data', (c: Buffer) => { b += c; }); req.on('end', () => r(b)); });
}

/** An MCP tool server that wants its own bearer key. */
async function upstreamMcp(key: string): Promise<{ url: string; auth: string[] }> {
  const auth: string[] = [];
  const server = createServer(async (req, res) => {
    const msg = JSON.parse(await body(req) || '{}');
    auth.push(String(req.headers.authorization));
    if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; }
    if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'crm', version: '1' } }
      : msg.method === 'tools/list' ? { tools: [{ name: 'send_email', description: 'Sends an email to a customer.', inputSchema: { type: 'object', properties: { to: { type: 'string' } } } }] } : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
  return { url: (await listen(server)) + '/mcp', auth };
}

/** An OpenAPI tool server that wants a static X-Api-Key header. */
async function upstreamOpenapi(apiKey: string): Promise<{ url: string; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(String(req.headers['x-api-key']));
    if (req.headers['x-api-key'] !== apiKey) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ openapi: '3.1.0', info: { title: 'notes', version: '1' }, paths: { '/notes': { get: { operationId: 'list_notes', summary: 'Lists the notes.' } } } }));
  });
  return { url: await listen(server), seen };
}

interface FakeOwui { url: string; token: string; conns: OwuiConnection[]; fn?: { content: string; is_active: boolean; is_global: boolean; valves: Record<string, unknown> }; tools: { id: string; content: string }[]; verified: string[] }

/** The parts of the OpenWebUI admin API setup uses. `verify` really connects, as OpenWebUI does: bearer key plus the
 *  connection's headers with the {{…}} templates empty (no chat during a verify). */
async function fakeOwui(conns: OwuiConnection[]): Promise<FakeOwui> {
  const o: FakeOwui = { url: '', token: 'owui-admin-token', conns, tools: [{ id: 'weather', content: 'class Tools:\n  def get(self): ...' }], verified: [] };
  const server = createServer(async (req, res) => {
    const send = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.headers.authorization !== `Bearer ${o.token}`) return send(401, { detail: 'Not authenticated' });
    const b = await body(req);
    const p = req.url!;
    if (p === '/api/v1/auths/') return send(200, { role: 'admin' });
    if (p === '/api/version') return send(200, { version: '0.11.4' });
    if (p === '/api/v1/configs/tool_servers') {
      if (req.method === 'POST') o.conns = JSON.parse(b).TOOL_SERVER_CONNECTIONS;
      return send(200, { TOOL_SERVER_CONNECTIONS: o.conns });
    }
    if (p === '/api/v1/configs/tool_servers/verify') {
      const c = JSON.parse(b) as OwuiConnection;
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      if (c.auth_type === 'bearer' && c.key) headers.authorization = `Bearer ${c.key}`;
      for (const [k, v] of Object.entries((c.headers ?? {}) as Record<string, string>)) headers[k] = String(v).replace(/\{\{[A-Z_]+\}\}/g, '');
      try {
        const r = c.type === 'mcp'
          ? await fetch(c.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'owui', version: '0' } } }) })
          : await fetch(`${c.url.replace(/\/$/, '')}/${String(c.path).replace(/^\//, '')}`, { headers });
        if (!r.ok) return send(400, { detail: 'Failed to connect to the tool server' });
        o.verified.push(c.url);
        return send(200, { status: true });
      } catch { return send(400, { detail: 'Failed to connect to the tool server' }); }
    }
    const fm = /^\/api\/v1\/functions\/(?:id\/warden_filter(\/.*)?|create)$/.exec(p);
    if (fm) {
      const sub = fm[1] ?? '';
      if (p.endsWith('/create')) { o.fn = { content: JSON.parse(b).content, is_active: false, is_global: false, valves: {} }; return send(200, { id: 'warden_filter' }); }
      if (!o.fn) return send(404, { detail: 'not found' });
      if (sub === '' && req.method === 'GET') return send(200, { id: 'warden_filter', is_active: o.fn.is_active, is_global: o.fn.is_global });
      if (sub === '/update') { o.fn.content = JSON.parse(b).content; return send(200, {}); }
      if (sub === '/toggle') { o.fn.is_active = !o.fn.is_active; return send(200, {}); }
      if (sub === '/toggle/global') { o.fn.is_global = !o.fn.is_global; return send(200, {}); }
      if (sub === '/valves') return send(200, o.fn.valves);
      if (sub === '/valves/update') { o.fn.valves = JSON.parse(b); return send(200, o.fn.valves); }
    }
    if (p === '/api/v1/tools/export') return send(200, o.tools);
    return send(404, { detail: 'unknown' });
  });
  o.url = await listen(server);
  return o;
}

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'warden-owui-setup-'));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

async function run(owui: FakeOwui, dir: string, extra: Partial<SetupOptions> = {}) {
  const port = await freePort();
  const lines: string[] = [];
  const o: SetupOptions = { url: owui.url, dir, local: true, port, project: 'warden-test', start: true, dryRun: false, ...extra };
  const ok = await setup(o, new Owui(owui.url, owui.token), m => lines.push(m), {
    start: async (_s, d, env) => {
      const g = createGateway(loadGatewayConfig(join(d, 'config', 'gateway.json'), { ...process.env, ...env }), { ...process.env, ...env }, () => {});
      await new Promise<void>(r => g.server.listen(port, '127.0.0.1', () => r()));
      cleanup.push(() => g.close());
    },
  });
  return { ok, out: lines.join('\n'), port };
}

describe('planConnections', () => {
  const base = { gatewayUrl: 'http://warden-gateway:8787', gatewayToken: 'gw-token', gatewayInDocker: true };
  it('moves a bearer key and static headers into the gateway and points the connection at it', () => {
    const plan = planConnections([
      { type: 'mcp', url: 'http://crm:8000/mcp', path: '', auth_type: 'bearer', key: 'up-secret', headers: { 'X-Tenant': 'acme' }, config: { enable: true }, info: { id: 'crm', name: 'CRM' } },
      { type: 'openapi', url: 'http://notes:9103', path: '/openapi.json', auth_type: 'none', key: '', config: { enable: true }, info: { id: 'notes' } },
    ], base);
    expect(plan.skipped).toEqual([]);
    const [crm, notes] = plan.servers;
    expect(crm!.headers).toEqual({ authorization: 'Bearer ${WARDEN_UP_CRM_AUTH}', 'x-tenant': '${WARDEN_UP_CRM_H1}' });
    expect(crm!.env).toEqual({ WARDEN_UP_CRM_AUTH: 'up-secret', WARDEN_UP_CRM_H1: 'acme' });
    expect(crm!.routed).toMatchObject({ url: 'http://warden-gateway:8787/mcp/crm', auth_type: 'bearer', key: 'gw-token', headers: CHAT_HEADERS, info: { id: 'crm', name: 'CRM' } });
    expect(JSON.stringify(crm!.routed)).not.toContain('up-secret');
    expect(notes!).toMatchObject({ type: 'openapi', specPath: 'openapi.json', routed: { url: 'http://warden-gateway:8787/openapi/notes', path: 'openapi.json' } });
    expect(routedName(crm!.routed, base.gatewayUrl)).toBe('crm');
  });

  it('leaves per-user auth, header templates, cookies and the OpenWebUI container\'s localhost direct', () => {
    const plan = planConnections([
      { type: 'mcp', url: 'http://a:1/mcp', auth_type: 'oauth_2.1', info: { id: 'a' } },
      { type: 'mcp', url: 'http://b:1/mcp', auth_type: 'session', info: { id: 'b' } },
      { type: 'mcp', url: 'http://c:1/mcp', auth_type: 'none', headers: { 'X-User': '{{USER_EMAIL}}' }, info: { id: 'c' } },
      { type: 'mcp', url: 'http://d:1/mcp', auth_type: 'none', forward_cookies: true, info: { id: 'd' } },
      { type: 'openapi', url: 'http://localhost:8000', path: 'openapi.json', auth_type: 'none', info: { id: 'e' } },
      { type: 'mcp', url: 'http://warden-gateway:8787/mcp/f', auth_type: 'bearer', key: 'gw-token', info: { id: 'f' } },
    ], base);
    expect(plan.servers).toEqual([]);
    expect(plan.skipped.map(s => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(plan.already).toEqual([{ index: 5, name: 'f' }]);
    // Without Docker, localhost is the same host as the gateway.
    expect(planConnections([{ type: 'openapi', url: 'http://localhost:8000', path: 'openapi.json', auth_type: 'none', info: { id: 'e' } }], { ...base, gatewayInDocker: false }).servers).toHaveLength(1);
  });

  it('a connection behind the address an earlier run used is not taken for a tool server', () => {
    const plan = planConnections([{ type: 'mcp', url: 'http://old-gw:8787/mcp/crm', auth_type: 'bearer', key: 'gw-token', info: { id: 'crm' } }],
      { ...base, earlierGateways: ['http://old-gw:8787'] });
    expect(plan.servers).toEqual([]);
    expect(plan.already).toEqual([{ index: 0, name: 'crm' }]);
  });

  it('gives each server a unique name the gateway accepts', () => {
    const plan = planConnections([
      { type: 'mcp', url: 'http://x:1/mcp', auth_type: 'none', info: { id: 'my tools!' } },
      { type: 'mcp', url: 'http://y:1/mcp', auth_type: 'none', info: { id: 'my-tools' } },
    ], { ...base, taken: ['crm'] });
    expect(plan.servers.map(s => s.name)).toEqual(['my-tools', 'my-tools-2']);
  });
});

describe('warden-mcp openwebui setup', () => {
  it('puts a running OpenWebUI behind the gateway, proves it, and undoes it', async () => {
    const crm = await upstreamMcp('up-secret');
    const notes = await upstreamOpenapi('notes-key');
    const originals: OwuiConnection[] = [
      { type: 'mcp', url: crm.url, path: '', auth_type: 'bearer', key: 'up-secret', config: { enable: true }, info: { id: 'crm', name: 'CRM' } },
      { type: 'openapi', url: notes.url, path: 'openapi.json', auth_type: 'none', key: '', headers: { 'X-Api-Key': 'notes-key' }, config: { enable: true }, info: { id: 'notes', name: 'Notes' } },
      { type: 'mcp', url: 'http://sso:1/mcp', auth_type: 'oauth_2.1', config: { enable: false }, info: { id: 'sso' } },
    ];
    const owui = await fakeOwui(JSON.parse(JSON.stringify(originals)));
    const dir = tmp();
    const { ok, out, port } = await run(owui, dir);
    expect(out).toContain('2 to put behind the gateway');
    expect(out).toContain('sso: stays direct');
    expect(ok).toBe(true);

    // OpenWebUI's connections go through the gateway, with the chat headers and the gateway token only.
    const gw = `http://127.0.0.1:${port}`;
    expect(owui.conns[0]).toMatchObject({ url: `${gw}/mcp/crm`, auth_type: 'bearer', headers: CHAT_HEADERS, info: { id: 'crm', name: 'CRM' } });
    expect(owui.conns[1]).toMatchObject({ url: `${gw}/openapi/notes`, path: 'openapi.json', headers: CHAT_HEADERS });
    expect(owui.conns[2]).toEqual(originals[2]);
    expect(JSON.stringify(owui.conns)).not.toMatch(/up-secret|notes-key/);
    // …and the upstream servers got their own keys from the gateway.
    expect(crm.auth).toContain('Bearer up-secret');
    expect(notes.seen).toContain('notes-key');
    expect(owui.verified).toEqual(expect.arrayContaining([`${gw}/mcp/crm`, `${gw}/openapi/notes`]));

    // Secrets only in .env and backup/, mode 600; the config names variables.
    const env = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
    expect(env).toMatchObject({ WARDEN_UP_CRM_AUTH: 'up-secret', WARDEN_UP_NOTES_H1: 'notes-key' });
    expect(env.WARDEN_GATEWAY_TOKEN).toMatch(/^[0-9a-f]{48}$/);
    for (const f of ['.env', 'backup/connections-before.json']) expect(statSync(join(dir, f)).mode & 0o077).toBe(0);
    const cfg = readFileSync(join(dir, 'config', 'gateway.json'), 'utf8');
    expect(cfg).not.toMatch(/up-secret|notes-key|[0-9a-f]{48}/);
    expect(JSON.parse(readFileSync(join(dir, 'state', 'flow-policy.json'), 'utf8')).mode).toBe('audit');

    // The Filter is installed, on, and wired to the gateway.
    expect(owui.fn).toMatchObject({ is_active: true, is_global: true, valves: { gateway_url: gw, token: env.WARDEN_GATEWAY_TOKEN, approve_token: env.WARDEN_APPROVE_TOKEN } });
    expect(owui.fn!.content).toContain('class Filter');

    // check: both test decisions, the Python tool without the guard.
    const lines = await check(new Owui(owui.url, owui.token), dir);
    const text = lines.map(l => `${l.status} ${l.text}`).join('\n');
    expect(text).toMatch(/ok a page from a web search asks to send the chat out: audit, would be refused \(unnamed_destination\)/);
    expect(text).toMatch(/ok the person asks for a page themselves: allowed/);
    expect(text).toMatch(/warn Python tools without @warden_guard .*weather/);
    expect(text).toMatch(/warn tool server sso: direct .*\(disabled\)/);
    expect(lines.filter(l => l.status === 'fail')).toEqual([]);

    // A second run changes nothing.
    const again = await run(owui, dir, { port });
    expect(again.out).toContain('0 to put behind the gateway, 2 already behind it');

    // undo: the original connections come back (with their keys), the Filter is off.
    await undo(new Owui(owui.url, owui.token), dir, () => {});
    expect(owui.conns).toEqual(originals);
    expect(owui.fn).toMatchObject({ is_active: false, is_global: false });
  });

  it('check fails when a connection is direct or the Filter is off', async () => {
    const crm = await upstreamMcp('k');
    const owui = await fakeOwui([{ type: 'mcp', url: crm.url, path: '', auth_type: 'bearer', key: 'k', config: { enable: true }, info: { id: 'crm' } }]);
    const dir = tmp();
    expect((await run(owui, dir)).ok).toBe(true);
    owui.conns.push({ type: 'mcp', url: 'http://later:1/mcp', auth_type: 'none', config: { enable: true }, info: { id: 'later' } });
    owui.fn!.is_global = false;
    const text = (await check(new Owui(owui.url, owui.token), dir)).filter(l => l.status === 'fail').map(l => l.text).join('\n');
    expect(text).toMatch(/Filter: not global/);
    expect(text).toMatch(/tool server later: direct/);
  });

  it('a server OpenWebUI cannot reach through the gateway stays direct and setup reports it', async () => {
    const owui = await fakeOwui([{ type: 'mcp', url: 'http://127.0.0.1:9/mcp', path: '', auth_type: 'none', config: { enable: true }, info: { id: 'gone' } }]);
    const { ok, out } = await run(owui, tmp());
    expect(ok).toBe(false);
    expect(out).toMatch(/✗ gone: OpenWebUI cannot reach it through the gateway/);
    expect(owui.conns[0]!.url).toBe('http://127.0.0.1:9/mcp');
  });

  it('an OpenWebUI that does not answer is named, not "fetch failed"', async () => {
    const port = await freePort();
    await expect(new Owui(`http://127.0.0.1:${port}`, 't').req('GET', '/api/v1/auths/')).rejects.toThrow(new RegExp(`cannot reach OpenWebUI at http://127\\.0\\.0\\.1:${port} \\(ECONNREFUSED\\)`));
  });

  it('--dry-run writes nothing and changes nothing', async () => {
    const owui = await fakeOwui([{ type: 'mcp', url: 'http://crm:1/mcp', path: '', auth_type: 'none', config: { enable: true }, info: { id: 'crm' } }]);
    const dir = join(tmp(), 'out');
    const { out } = await run(owui, dir, { dryRun: true });
    expect(out).toContain('Dry run');
    expect(existsSync(dir)).toBe(false);
    expect(owui.conns[0]!.url).toBe('http://crm:1/mcp');
    expect(owui.fn).toBeUndefined();
  });
});
