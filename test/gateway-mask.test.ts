import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createGateway, type Gateway } from '../src/gateway.js';
import { parseGatewayConfig } from '../src/gateway-config.js';
import { parseSse } from '../src/gateway-mcp.js';

// The HTTP gateway (OpenWebUI and other remote-MCP clients) with masking: MCP over HTTP, OpenAPI, and the /v1 routes
// the OpenWebUI filter and the Hermes plugin use.
const TOKEN = 'gateway-token-0123456789abcdef';
const GH = 'ghp_' + 'x1Y2'.repeat(9);
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

async function listen(server: Server): Promise<string> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  cleanup.push(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

interface Fake { url: string; calls: Array<{ name: string; args: any }>; reads: string[]; result: (name: string, args: any) => any; sse: boolean }
async function fakeMcp(): Promise<Fake> {
  const fake: Fake = { url: '', calls: [], reads: [], sse: false, result: () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  const tools = [
    { name: 'read_config', description: 'Reads the service configuration.', inputSchema: { type: 'object', properties: {} } },
    { name: 'call_api', description: 'Calls the service API with a token.', inputSchema: { type: 'object', properties: { token: { type: 'string' }, to: { type: 'string' } } } },
  ];
  fake.url = await listen(createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      let result: any = {};
      if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fake', version: '1' } };
      else if (msg.method === 'tools/list') result = { tools };
      else if (msg.method === 'resources/read') { fake.reads.push(msg.params.uri); result = { contents: [{ uri: msg.params.uri, text: `api_key=${GH}` }] }; }
      else if (msg.method === 'tools/call') { fake.calls.push({ name: msg.params.name, args: msg.params.arguments }); result = fake.result(msg.params.name, msg.params.arguments); }
      const reply = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      if (fake.sse) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 's' });
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: `using token ${GH}` } })}\n\n`);
        res.end(`data: ${reply}\n\n`);
      } else { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's' }); res.end(reply); }
    });
  })) + '/mcp';
  return fake;
}

function setup(servers: any[], extra: Record<string, unknown> = {}, flowPolicy: Record<string, unknown> = { mode: 'audit' }) {
  const dir = mkdtempSync(join(tmpdir(), 'warden-gateway-mask-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'flow-policy.json'), JSON.stringify(flowPolicy));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('WARDEN_MASK'))), WARDEN_GATEWAY_TOKEN: TOKEN, UP_KEY: 'Upstream-Secret-77', WARDEN_FLOW_MODE: '' };
  const config = parseGatewayConfig({ listen: { port: 1 }, servers, stateDir: dir, requireAdapter: false, ...extra }, env);
  return createGateway(config, env, () => {});
}
async function start(g: Gateway): Promise<string> {
  await new Promise<void>(r => g.server.listen(0, '127.0.0.1', () => r()));
  cleanup.push(() => g.close());
  return `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`;
}
const chat = (id: string) => ({ 'x-openwebui-chat-id': id, 'x-openwebui-user-id': 'u1' });
async function rpc(base: string, name: string, msg: any, headers: Record<string, string>): Promise<any> {
  const r = await fetch(`${base}/mcp/${name}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': 's', ...headers }, body: JSON.stringify(msg) });
  const text = await r.text();
  if ((r.headers.get('content-type') ?? '').includes('text/event-stream')) return parseSse(text).map(e => JSON.parse(e.data));
  return JSON.parse(text);
}
async function v1(base: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${base}/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const call = (id: number, name: string, args: any) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const textOf = (r: any) => (r.result?.content ?? []).map((c: any) => c.text).join('\n');

describe('gateway masking: MCP over HTTP', () => {
  it('masks a credential in a result and restores it only for the server it came from', async () => {
    const a = await fakeMcp(), b = await fakeMcp();
    a.result = name => name === 'read_config' ? { content: [{ type: 'text', text: `token: ${GH}` }] } : { content: [{ type: 'text', text: 'called' }] };
    const base = await start(setup([{ name: 'svc', type: 'mcp-http', url: a.url }, { name: 'other', type: 'mcp-http', url: b.url }]));
    await rpc(base, 'svc', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, chat('c1'));
    await rpc(base, 'other', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, chat('c1'));
    const r = await rpc(base, 'svc', call(2, 'read_config', {}), chat('c1'));
    const shown = textOf(r);
    expect(shown).not.toContain(GH);
    const p = /WARDEN_SECRET_[0-9A-Z]{10}/.exec(shown)![0];
    expect(textOf(await rpc(base, 'svc', call(3, 'call_api', { token: p }), chat('c1')))).toContain('called');
    expect(a.calls.at(-1)!.args).toEqual({ token: GH });
    const refused = await rpc(base, 'other', call(4, 'call_api', { token: p }), chat('c1'));
    expect(refused.result.isError).toBe(true);
    expect(textOf(refused)).toMatch(/credential read from svc/);
    expect(b.calls.filter(c => c.name === 'call_api')).toHaveLength(0);
    // Another chat cannot use this chat's placeholder: it passes as plain text.
    await rpc(base, 'svc', call(5, 'call_api', { token: p }), chat('c2'));
    expect(a.calls.at(-1)!.args).toEqual({ token: p });
  });

  it('masks log notifications in a streamed call and resource contents; header secrets never reach the model', async () => {
    const a = await fakeMcp();
    a.sse = true;
    a.result = () => ({ content: [{ type: 'text', text: 'header was Upstream-Secret-77' }] });
    const base = await start(setup([{ name: 'svc', type: 'mcp-http', url: a.url, headers: { Authorization: 'Bearer ${UP_KEY}' } }]));
    await rpc(base, 'svc', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, chat('c1'));
    const events = await rpc(base, 'svc', call(2, 'read_config', {}), chat('c1'));
    expect(JSON.stringify(events)).not.toContain(GH);
    expect(JSON.stringify(events)).not.toContain('Upstream-Secret-77');
    a.sse = false;
    const read = await rpc(base, 'svc', { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'config://main' } }, chat('c1'));
    expect(JSON.stringify(read)).not.toContain(GH);
  });

  it('personal data with the gdpr profile; the person sees it again through /v1/reveal, credentials stay masked', async () => {
    const a = await fakeMcp();
    a.result = () => ({ content: [{ type: 'text', text: `Customer ann.smith@acme.org, +44 20 7946 0958, key ${GH}` }] });
    const base = await start(setup([{ name: 'crm', type: 'mcp-http', url: a.url }], { mask: { personal: 'gdpr' } }));
    await rpc(base, 'crm', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, chat('c1'));
    const shown = textOf(await rpc(base, 'crm', call(2, 'read_config', {}), chat('c1')));
    expect(shown).not.toMatch(/ann\.smith|7946|ghp_/);
    const answer = `I found ${/warden_email_\w+@mask\.invalid/.exec(shown)![0]} and ${/WARDEN_SECRET_\w+/.exec(shown)![0]}.`;
    const revealed = (await v1(base, 'reveal', { chat_id: 'c1', user_id: 'u1', text: answer })).text;
    expect(revealed).toContain('ann.smith@acme.org');
    expect(revealed).toMatch(/WARDEN_SECRET_/);
  });
});

describe('gateway masking: /v1 for adapters', () => {
  it('mask (user origin and history), restore, refusal, and /v1/pre + /v1/post for native tools', async () => {
    const base = await start(setup([], { mask: { personal: 'gdpr' } }));
    const who = { chat_id: 'c9', user_id: 'u1' };
    // The person's own message: their e-mail goes to any tool, their typed key only where restoreTo names.
    const m = await v1(base, 'mask', { ...who, origin: 'user', value: `send it to bob@acme.org with ${GH}` });
    expect(m.value).not.toMatch(/bob@acme|ghp_/);
    const email = /warden_email_\w+@mask\.invalid/.exec(m.value)![0], key = /WARDEN_SECRET_\w+/.exec(m.value)![0];
    expect(await v1(base, 'restore', { ...who, server: 'mail', tool_name: 'send', value: { to: email } })).toEqual({ ok: true, value: { to: 'bob@acme.org' } });
    expect((await v1(base, 'restore', { ...who, server: 'github', value: key })).ok).toBe(false);
    // The same history sent again gets the same placeholders and widens nothing.
    expect((await v1(base, 'mask', { ...who, origin: 'user', value: `send it to bob@acme.org with ${GH}`, history: true })).value).toBe(m.value);
    // Native tools: /v1/post returns the masked result, /v1/pre the restored input.
    const post = await v1(base, 'post', { ...who, server: 'openwebui', tool_name: 'fetch_config', tool_input: {}, tool_response: `password=Hunter-2024x` });
    expect(post.tool_response).not.toContain('Hunter-2024x');
    expect(post.mask_note).toMatch(/placeholders/);
    const ph = /WARDEN_SECRET_\w+/.exec(post.tool_response)![0];
    const pre = await v1(base, 'pre', { ...who, server: 'openwebui', tool_name: 'login', tool_input: { password: ph } });
    expect(pre).toMatchObject({ decision: 'allow', tool_input: { password: 'Hunter-2024x' } });
    const denied = await v1(base, 'pre', { ...who, server: 'mail', tool_name: 'send', tool_input: { body: ph } });
    expect(denied).toMatchObject({ decision: 'deny', reason: 'mask_scope' });
  });

  it('OpenAPI: restores into path, query and body; masks the JSON result', async () => {
    const seen: Array<{ method: string; path: string; body: string }> = [];
    const spec = { openapi: '3.0.0', paths: {
      '/users/{id}': { get: { operationId: 'get_user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'email', in: 'query', schema: { type: 'string' } }] } },
      '/notify': { post: { operationId: 'notify', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } } } };
    const upstream = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.url === '/openapi.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(spec)); return; }
        seen.push({ method: req.method!, path: req.url!, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'u-1', email: 'ann.smith@acme.org', session_token: 'Sess-Token-9876abc' }));
      });
    });
    const url = await listen(upstream);
    const base = await start(setup([{ name: 'users', type: 'openapi', url }], { mask: { personal: 'gdpr' } }));
    const headers = { authorization: `Bearer ${TOKEN}`, ...chat('c1') };
    await fetch(`${base}/openapi/users/openapi.json`, { headers });
    const r1 = await (await fetch(`${base}/openapi/users/users/u-1`, { headers })).json() as any;
    expect(r1.email).toMatch(/^warden_email_\w+@mask\.invalid$/);
    expect(JSON.stringify(r1)).not.toContain('Sess-Token-9876abc');
    await fetch(`${base}/openapi/users/users/u-1?email=${encodeURIComponent(r1.email)}`, { headers });
    expect(seen.at(-1)!.path).toBe('/users/u-1?email=ann.smith%40acme.org');
    await fetch(`${base}/openapi/users/notify`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ to: r1.email }) });
    expect(JSON.parse(seen.at(-1)!.body)).toEqual({ to: 'ann.smith@acme.org' });
  });
});
