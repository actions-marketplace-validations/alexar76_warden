import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WrapFrames } from '../src/wrap-wire.js';

// The stdio wrap end to end: a real child MCP server (test/fixtures/wrap-server.mjs) behind dist/mcp-server.js.
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const bin = join(root, 'dist/mcp-server.js'), fixture = join(root, 'test/fixtures/wrap-server.mjs');
const dirs: string[] = [], children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => { for (const p of children.splice(0)) p.kill('SIGKILL'); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const GH = 'ghp_' + 'x1Y2'.repeat(9);

function harness(config: Record<string, unknown>, flags: string[] = [], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'warden-wrap-mask-')); dirs.push(dir);
  const cfg = join(dir, 'fixture.json'), calls = join(dir, 'calls');
  writeFileSync(cfg, JSON.stringify({ callsFile: calls, ...config }));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('WARDEN_MASK')));
  const p = spawn(process.execPath, [bin, 'wrap', '--id', 'notes-server', '--state-dir', dir, ...flags, '--', process.execPath, fixture],
    { env: { ...clean, WARDEN_FIXTURE_CONFIG: cfg, ...env }, stdio: 'pipe' });
  children.push(p);
  let stderr = '', n = 0;
  const frames = new WrapFrames('ndjson'), pending = new Map<number, (m: any) => void>();
  p.stderr.on('data', b => { stderr += b; });
  p.stdin.on('error', () => {}); // a child killed by afterEach must not fail the next test with EPIPE
  p.stdout.on('data', b => { for (const raw of frames.push(b)) { const m = JSON.parse(raw); if (!m.method) { pending.get(m.id)?.(m); pending.delete(m.id); } } });
  const request = (method: string, params?: unknown) => new Promise<any>((res, rej) => {
    const id = ++n;
    const timer = setTimeout(() => rej(new Error(`timeout ${method}: ${stderr}`)), 12_000);
    pending.set(id, m => { clearTimeout(timer); res(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
  });
  const ready = async () => { await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }); await request('tools/list'); };
  const sent = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  return { request, ready, sent, stderr: () => stderr, change: (v: Record<string, unknown>) => writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, 'utf8')), ...v })) };
}

const text = (r: any) => r.result.content.map((c: any) => c.text).join('\n');

describe('wrap: masking', () => {
  it('credentials are masked by default and go back only to the server they came from', async () => {
    const h = harness({ callResult: { content: [{ type: 'text', text: `GITHUB_TOKEN=${GH}\nowner: ann.smith@acme.org` }] } });
    await h.ready();
    const r = await h.request('tools/call', { name: 'notes', arguments: {} });
    const shown = text(r);
    expect(shown).not.toContain(GH);
    expect(shown).toContain('ann.smith@acme.org'); // personal data is off by default
    expect(shown).toMatch(/replaced by placeholders/);
    const placeholder = /WARDEN_SECRET_[0-9A-Z]{10}/.exec(shown)![0];
    await h.request('tools/call', { name: 'notes', arguments: { auth: placeholder, note: `use ${placeholder}` } });
    expect(h.sent().at(-1).params.arguments).toEqual({ auth: GH, note: `use ${GH}` });
    expect(h.stderr()).toMatch(/masked SECRET×1 in notes from notes-server/);
    expect(h.stderr()).toMatch(/restored SECRET×2 into notes/);
    expect(h.stderr()).not.toContain(GH);
  });

  it('--mask-personal gdpr masks personal data too; e-mail placeholders stay addresses', async () => {
    const h = harness({ callResult: { content: [{ type: 'text', text: 'Customer ann.smith@acme.org, IBAN DE89 3704 0044 0532 0130 00' }], structuredContent: { email: 'ann.smith@acme.org' } } }, ['--mask-personal', 'gdpr']);
    await h.ready();
    const r = await h.request('tools/call', { name: 'notes', arguments: {} });
    expect(JSON.stringify(r.result)).not.toContain('ann.smith@acme.org');
    expect(JSON.stringify(r.result)).not.toContain('DE89');
    expect(r.result.structuredContent.email).toMatch(/^warden_email_[0-9a-z]{10}@mask\.invalid$/);
    await h.request('tools/call', { name: 'notes', arguments: { to: r.result.structuredContent.email } });
    expect(h.sent().at(-1).params.arguments.to).toBe('ann.smith@acme.org');
  });

  it('WARDEN_MASK_PERSONAL turns it on for clients that pass no flags; --mask-credentials off turns credentials off', async () => {
    const env = harness({ callResult: { content: [{ type: 'text', text: 'call +44 20 7946 0958' }] } }, [], { WARDEN_MASK_PERSONAL: 'gdpr' });
    await env.ready();
    expect(text(await env.request('tools/call', { name: 'notes' }))).not.toContain('7946');
    const off = harness({ callResult: { content: [{ type: 'text', text: `key ${GH}` }] } }, ['--mask-credentials', 'off']);
    await off.ready();
    expect(text(await off.request('tools/call', { name: 'notes' }))).toBe(`key ${GH}`);
  });

  it('restore: never sends the placeholder itself; resources and server log notifications are masked too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'warden-mask-cfg-')); dirs.push(dir);
    writeFileSync(join(dir, 'mask.json'), JSON.stringify({ credentials: { restore: 'never' } }));
    const h = harness({ callResult: { content: [{ type: 'text', text: `token ${GH}` }] } }, ['--mask', join(dir, 'mask.json')]);
    await h.ready();
    const p = /WARDEN_SECRET_[0-9A-Z]{10}/.exec(text(await h.request('tools/call', { name: 'notes' })))![0];
    await h.request('tools/call', { name: 'notes', arguments: { auth: p } });
    expect(h.sent().at(-1).params.arguments.auth).toBe(p);
    // Any other request is answered by the fixture with its params echoed back (`passthrough`).
    const echoed = await h.request('resources/read', { uri: `file:///x?token=${GH}` });
    expect(JSON.stringify(echoed)).not.toContain(GH);
  });

  it('a server error carrying a credential is masked; audit-only only reports', async () => {
    const h = harness({ callError: `upstream rejected Authorization: Bearer ${GH}` });
    await h.ready();
    const r = await h.request('tools/call', { name: 'notes' });
    expect(r.error.message).not.toContain(GH);
    const audit = harness({ callResult: { content: [{ type: 'text', text: `key ${GH}` }] } }, ['--audit-only']);
    await audit.ready();
    expect(text(await audit.request('tools/call', { name: 'notes' }))).toBe(`key ${GH}`);
    expect(audit.stderr()).toMatch(/AUDIT-ONLY would mask SECRET×1/);
  });
});
