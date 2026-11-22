/**
 * `warden-mcp gateway`: configuration. One JSON file names the tool servers the gateway stands in front of, where it
 * listens, which tokens it accepts and where it keeps its state. Secrets are never written in the file: a header value
 * may name an environment variable as `${NAME}`, and the tokens are read from variables the file names.
 *
 * Unknown fields are an error, as in `wrap --policy`: a typo must stop the start, not silently relax a check.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { asPolicy } from './mcp-tools.js';
import { RESULT_POLICIES, type ResultPolicy } from './result-screen.js';
import type { WardenPolicy } from './types.js';
import { defaultStateDir } from './state.js';
import { loadMaskConfig, parseMaskConfig, type MaskConfig } from './mask.js';

export type GatewayServerType = 'mcp-http' | 'openapi';

export interface GatewayServer {
  /** Path segment and flow-guard server name: its tools are `mcp__<name>__<tool>` to the policy. */
  name: string;
  type: GatewayServerType;
  /** MCP endpoint (`mcp-http`) or the base URL whose `openapi.json` describes the operations (`openapi`). */
  url: string;
  /** Sent to the tool server on every request; `${NAME}` is replaced by that environment variable. */
  headers: Record<string, string>;
  /** OpenAPI only: where the spec is, relative to `url`. Default `openapi.json`. */
  specPath?: string;
}

export interface GatewayConfig {
  host: string;
  port: number;
  /** Bearer token OpenWebUI (or any client) sends to the proxy and to /v1 (except /v1/approve when approveToken is set). */
  token: string;
  /** Optional second token for /v1/approve only, held by the adapter and never by a tool server connection. */
  approveToken?: string;
  /** Request headers that carry the chat and the user. OpenWebUI sends these with ENABLE_FORWARD_USER_INFO_HEADERS. */
  chatHeader: string;
  userHeader: string;
  servers: GatewayServer[];
  stateDir: string;
  /** Flow policy file (labels, mode, …); default `<stateDir>/flow-policy.json`. */
  flowPolicy?: string;
  /** Tool-definition gates, as `wrap --policy`. */
  policy: WardenPolicy;
  /** Result screening, as `wrap --results`. */
  results: ResultPolicy;
  /** Word the user types before an approval code. `approve` is always accepted as well. */
  approvePhrase: string;
  approvalTtlSeconds: number;
  /** Chat state older than this is removed (days). Outside text never expires while the state exists. */
  retentionDays: number;
  maxBodyBytes: number;
  /** Per upstream request. */
  upstreamTimeoutMs: number;
  /** A chat the platform adapter never reported a message for counts as having read outside text (default true). */
  requireAdapter: boolean;
  /** Masking (mask.ts): credentials on, personal data off unless set; without the field, the WARDEN_MASK* environment. */
  mask: MaskConfig;
}

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const HEADER = /^[A-Za-z0-9-]{1,100}$/;
const KEYS = new Set(['listen', 'tokenEnv', 'approveTokenEnv', 'chatHeader', 'userHeader', 'servers', 'stateDir', 'flowPolicy',
  'policy', 'results', 'approvePhrase', 'approvalTtlSeconds', 'retentionDays', 'maxBodyBytes', 'upstreamTimeoutMs', 'requireAdapter', 'mask']);
const SERVER_KEYS = new Set(['name', 'type', 'url', 'headers', 'specPath']);

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function int(v: unknown, what: string, min: number, max: number, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${what} must be an integer from ${min} to ${max}`);
  return v;
}

/** `${NAME}` → env value. A missing variable is an error: an empty credential would only fail later, upstream. */
export function expandEnv(value: string, env: NodeJS.ProcessEnv, what: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    const v = env[name];
    if (v === undefined || v === '') throw new Error(`${what} names environment variable ${name}, which is not set`);
    return v;
  });
}

function url(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what} must be a URL`);
  let u: URL;
  try { u = new URL(v); } catch { throw new Error(`${what} must be a URL`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${what} must be http or https`);
  if (u.username || u.password) throw new Error(`${what} must not carry credentials; use headers with \${ENV}`);
  return u.toString();
}

export function parseGatewayConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env, baseDir = process.cwd()): GatewayConfig {
  const r = obj(raw, 'gateway config');
  for (const k of Object.keys(r)) if (!KEYS.has(k)) throw new Error(`Unknown gateway config field ${k}`);
  const listen = r.listen === undefined ? {} : obj(r.listen, 'listen');
  for (const k of Object.keys(listen)) if (!['host', 'port'].includes(k)) throw new Error(`Unknown listen field ${k}`);
  const host = listen.host === undefined ? '127.0.0.1' : String(listen.host);
  if (!/^[A-Za-z0-9.:[\]-]{1,100}$/.test(host)) throw new Error('listen.host is not a host name or address');
  const port = int(listen.port, 'listen.port', 1, 65535, 8787);
  const tokenEnv = typeof r.tokenEnv === 'string' ? r.tokenEnv : 'WARDEN_GATEWAY_TOKEN';
  const token = env[tokenEnv] ?? '';
  // A short token is guessable from inside the same Docker network; refuse to start rather than run open.
  if (token.length < 24) throw new Error(`Set ${tokenEnv} to a random token of at least 24 characters (the gateway refuses to run without one)`);
  let approveToken: string | undefined;
  if (r.approveTokenEnv !== undefined) {
    if (typeof r.approveTokenEnv !== 'string') throw new Error('approveTokenEnv must be a variable name');
    approveToken = env[r.approveTokenEnv] ?? '';
    if (approveToken.length < 24) throw new Error(`Set ${r.approveTokenEnv} to a random token of at least 24 characters`);
    if (approveToken === token) throw new Error('approveTokenEnv must hold a different token than tokenEnv');
  }
  const header = (v: unknown, what: string, fallback: string) => {
    const h = v === undefined ? fallback : String(v);
    if (!HEADER.test(h)) throw new Error(`${what} is not a header name`);
    return h.toLowerCase();
  };
  if (!Array.isArray(r.servers)) throw new Error('servers must be a list');
  const names = new Set<string>();
  const servers = r.servers.map((s, i): GatewayServer => {
    const o = obj(s, `servers[${i}]`);
    for (const k of Object.keys(o)) if (!SERVER_KEYS.has(k)) throw new Error(`Unknown servers[${i}] field ${k}`);
    if (typeof o.name !== 'string' || !NAME.test(o.name)) throw new Error(`servers[${i}].name must match ${NAME}`);
    if (names.has(o.name)) throw new Error(`Duplicate server name ${o.name}`);
    names.add(o.name);
    if (o.type !== 'mcp-http' && o.type !== 'openapi') throw new Error(`servers[${i}].type must be mcp-http or openapi`);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.headers === undefined ? {} : obj(o.headers, `servers[${i}].headers`))) {
      if (!HEADER.test(k) || typeof v !== 'string') throw new Error(`servers[${i}].headers must map header names to strings`);
      headers[k.toLowerCase()] = expandEnv(v, env, `servers[${i}].headers.${k}`);
    }
    const specPath = o.specPath === undefined ? undefined : String(o.specPath);
    if (specPath !== undefined && (o.type !== 'openapi' || !/^[A-Za-z0-9_./-]{1,200}$/.test(specPath) || specPath.includes('..'))) throw new Error(`servers[${i}].specPath must be a relative path, for openapi servers`);
    return { name: o.name, type: o.type, url: url(o.url, `servers[${i}].url`), headers, ...(specPath ? { specPath } : {}) };
  });
  const dirOf = (v: unknown, what: string) => {
    if (typeof v !== 'string' || !v) throw new Error(`${what} must be a path`);
    return isAbsolute(v) ? v : resolve(baseDir, v);
  };
  const stateDir = r.stateDir === undefined ? join(dirname(defaultStateDir()), 'warden-gateway') : dirOf(r.stateDir, 'stateDir');
  const results = r.results === undefined ? 'warn' : r.results;
  if (!(RESULT_POLICIES as readonly unknown[]).includes(results)) throw new Error(`results must be one of ${RESULT_POLICIES.join(', ')}`);
  const approvePhrase = r.approvePhrase === undefined ? 'подтверждаю' : String(r.approvePhrase);
  if (!/^[\p{L}]{2,30}$/u.test(approvePhrase)) throw new Error('approvePhrase must be one word');
  return {
    host, port, token, ...(approveToken ? { approveToken } : {}),
    chatHeader: header(r.chatHeader, 'chatHeader', 'X-OpenWebUI-Chat-Id'),
    userHeader: header(r.userHeader, 'userHeader', 'X-OpenWebUI-User-Id'),
    servers, stateDir,
    ...(r.flowPolicy !== undefined ? { flowPolicy: dirOf(r.flowPolicy, 'flowPolicy') } : {}),
    policy: asPolicy(r.policy),
    results: results as ResultPolicy,
    approvePhrase,
    approvalTtlSeconds: int(r.approvalTtlSeconds, 'approvalTtlSeconds', 30, 86_400, 600),
    retentionDays: int(r.retentionDays, 'retentionDays', 1, 3650, 30),
    maxBodyBytes: int(r.maxBodyBytes, 'maxBodyBytes', 1024, 64 * 1_048_576, 4 * 1_048_576),
    upstreamTimeoutMs: int(r.upstreamTimeoutMs, 'upstreamTimeoutMs', 1000, 600_000, 120_000),
    requireAdapter: r.requireAdapter === undefined ? true : (() => { if (typeof r.requireAdapter !== 'boolean') throw new Error('requireAdapter must be true or false'); return r.requireAdapter; })(),
    mask: r.mask === undefined ? loadMaskConfig({}, env) : parseMaskConfig(r.mask, baseDir),
  };
}

export function loadGatewayConfig(path: string, env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`Cannot read gateway config ${path}: ${e instanceof Error ? e.message : String(e)}`); }
  return parseGatewayConfig(raw, env, dirname(resolve(path)));
}

/** The environment the flow guard reads: the gateway's own state folder, never the Claude Code plugin's. */
export function flowEnv(config: GatewayConfig, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, WARDEN_STATE_DIR: config.stateDir, ...(config.flowPolicy ? { WARDEN_FLOW_POLICY: config.flowPolicy } : { WARDEN_FLOW_POLICY: join(config.stateDir, 'flow-policy.json') }) };
}
