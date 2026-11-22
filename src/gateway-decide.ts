/**
 * `warden-mcp gateway`: the decision service. It answers one question for platforms without agent hooks: "in this
 * chat the model read this, and now wants to call that — may it?". There are no rules of its own here: every answer
 * is the flow guard's (`flowPre`, `flowPost`, `flowPrompt`), on the same per-session state the Claude Code plugin
 * keeps, under the gateway's own state folder.
 *
 * Where the Claude Code hook shows a dialog, a server-side caller cannot. An `ask` becomes a one-time approval code:
 * bound to the chat, the tool and the exact arguments, valid for `approvalTtlSeconds`, used once. Only the adapter's
 * call to `approve()` — triggered by the person's own message or the platform's confirmation dialog — turns it into
 * a grant, and the next identical call consumes it.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeRfc8785 } from './jcs.js';
import { flowApproval, flowPost, flowPre, flowPrompt, loadPolicy } from './flow-guard.js';
import type { FlowPreDetail } from './flow-guard.js';
import { flowPaths, sessionKey, stateDir } from './flow-guard-paths.js';
import { log, readFlowState, safeToolName } from './flow-guard-state.js';
import { flowEnv, type GatewayConfig } from './gateway-config.js';
import { screenResult, resultNotice } from './result-screen.js';
import { displaySafe } from './index.js';
import { secretPattern } from './flow-guard-fingerprints.js';
import type { McpServerRef } from './types.js';
import { Masker, MaskRefusal, USER_ORIGIN, maskSummary } from './mask.js';

export type GatewayDecision = 'allow' | 'deny' | 'ask';

export interface Who {
  /** OpenWebUI user id; empty when the caller did not send one. */
  user: string;
  /** OpenWebUI chat id; empty when unknown — the call is then judged as made after outside text. */
  chat: string;
}

export interface PreAnswer {
  decision: GatewayDecision;
  /** Flow-guard reason code (`FlowReason`), when a rule fired. */
  reason?: string;
  /** Text for the model or the person: the guard's explanation, never the call's arguments. */
  message?: string;
  /** For `ask`: the one-time code the person types (or the adapter approves after a dialog). */
  code?: string;
  /** For a dialog: the arguments with secret-looking values masked and long text cut, never the raw call. */
  preview?: string;
  /** `approved` when a grant was consumed; `audit` when audit mode let a refused call through. */
  resolution?: 'approved' | 'policy' | 'audit';
  /** Audit mode only: the reason code the call would have been refused with in `ask` or `deny`. */
  wouldRefuse?: string;
  mode: string;
}

export interface PostAnswer {
  /** The result read as instructions to the model: put this in front of it. */
  notice?: string;
  /** The flow guard's note for the model (outside text; stronger when it addresses the model): put it after the result. */
  flowNote?: string;
  /** The flow note says the result addressed the model as if instructing it. */
  instruction?: boolean;
  /** The result read as instructions and `results` is `block`: the caller must withhold it. */
  withhold?: boolean;
  codes?: string[];
}

export type SourceKind = 'web_search' | 'url' | 'document' | 'file' | 'knowledge' | 'other';
const SOURCE_KINDS: readonly SourceKind[] = ['web_search', 'url', 'document', 'file', 'knowledge', 'other'];

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_GRANTS = 10_000;
const TOOL = /^[A-Za-z0-9_.:-]{1,128}$/;
const SERVER = /^[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_.:@-]{1,200}$/;

interface Grant { session: string; tool: string; args: string; expires: number; approved: boolean; chat: string; user: string; code: string; preview?: string }

/**
 * Approval codes on disk (`<stateDir>/gateway/approvals`), so a restart keeps them and several gateway processes on one
 * state folder agree. One grant file per call identity (session, tool, argument hash) and one file per code that points
 * to it. Every change is a rename or an exclusive create, so a code is answered once and a grant is consumed once.
 */
class GrantStore {
  constructor(private dir: string, private now: () => number) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  private grantPath(key: string) { return join(this.dir, `grant-${key}.json`); }
  private codePath(code: string) { return join(this.dir, `code-${code}`); }
  static key(session: string, tool: string, args: string): string {
    return createHash('sha256').update(`${session}\0${tool}\0${args}`).digest('hex').slice(0, 40);
  }
  private read(key: string): Grant | undefined {
    try { return JSON.parse(readFileSync(this.grantPath(key), 'utf8')) as Grant; } catch { return undefined; }
  }
  private write(key: string, g: Grant): void {
    const tmp = `${this.grantPath(key)}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(g), { mode: 0o600 });
    renameSync(tmp, this.grantPath(key));
  }
  private drop(path: string): void { try { unlinkSync(path); } catch { /* gone already */ } }
  /** An approved, unexpired grant for exactly this call: claimed atomically, so only one call consumes it. */
  claim(key: string): Grant | undefined {
    const g = this.read(key);
    if (!g?.approved || g.expires <= this.now()) return undefined;
    const claimed = `${this.grantPath(key)}.claimed-${randomUUID()}`;
    try { renameSync(this.grantPath(key), claimed); } catch { return undefined; }
    this.drop(claimed);
    this.drop(this.codePath(g.code));
    return g;
  }
  pendingCode(key: string): string | undefined {
    const g = this.read(key);
    return g && !g.approved && g.expires > this.now() && this.codeTarget(g.code) === key ? g.code : undefined;
  }
  private codeTarget(code: string): string | undefined {
    try { return readFileSync(this.codePath(code), 'utf8').trim(); } catch { return undefined; }
  }
  count(): number { try { return readdirSync(this.dir).filter(n => n.startsWith('grant-') && n.endsWith('.json')).length; } catch { return 0; } }
  create(key: string, g: Omit<Grant, 'code'>): string {
    for (let i = 0; i < 64; i++) {
      const code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      try { writeFileSync(this.codePath(code), key, { flag: 'wx', mode: 0o600 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
      this.write(key, { ...g, code });
      return code;
    }
    throw new GatewayError(503, 'could not allocate an approval code');
  }
  /** The pending grant behind a code, if this chat and user may answer it now. */
  peek(code: string, who: Who): { key: string; g: Grant } | undefined {
    const key = this.codeTarget(code);
    if (!key) return undefined;
    const g = this.read(key);
    if (!g || g.code !== code || g.approved || g.chat !== who.chat || g.user !== who.user || g.expires <= this.now()) return undefined;
    return { key, g };
  }
  /** The person's answer to a code: from its own chat and user, before it expires, once. */
  answer(code: string, who: Who, approved: boolean): Grant | undefined {
    const found = this.peek(code, who);
    if (!found) return undefined;
    const { key, g } = found;
    // Take the code first: two answers to one code cannot both land.
    const taken = `${this.codePath(code)}.answered-${randomUUID()}`;
    try { renameSync(this.codePath(code), taken); } catch { return undefined; }
    this.drop(taken);
    if (approved) this.write(key, { ...g, approved: true });
    else this.drop(this.grantPath(key));
    return g;
  }
  sweep(ttlMs: number): void {
    let names: string[] = [];
    try { names = readdirSync(this.dir); } catch { return; }
    const now = this.now();
    for (const n of names) {
      const p = join(this.dir, n);
      if (n.startsWith('grant-') && n.endsWith('.json')) {
        try { const g = JSON.parse(readFileSync(p, 'utf8')) as Grant; if (g.expires <= now) { this.drop(p); this.drop(this.codePath(g.code)); } } catch { this.drop(p); }
      } else if (n.startsWith('code-') || n.includes('.tmp') || n.includes('.claimed-') || n.includes('.answered-')) {
        try { if (statSync(p).mtimeMs < now - ttlMs - 60_000) this.drop(p); } catch { /* raced */ }
      }
    }
  }
}

/** OpenWebUI's built-in web tools are the flow guard's own readers: host rules and URL leak checks apply as in Claude Code. */
const BUILTIN_AS: Record<string, (a: Record<string, unknown>) => { name: string; input: Record<string, unknown> }> = {
  search_web: a => ({ name: 'WebSearch', input: { query: typeof a.query === 'string' ? a.query : JSON.stringify(a) } }),
  fetch_url: a => ({ name: 'WebFetch', input: { url: typeof a.url === 'string' ? a.url : '' } }),
};

export class GatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/**
 * Arguments as a person may see them in a confirmation: secret-looking values masked. Whatever is shortened says so
 * (`[… 312 chars not shown …]`, `[+7 more keys not shown]`): a person must never approve text they could not see
 * without being told it was there.
 */
export function previewArgs(args: Record<string, unknown>): string {
  const mask = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      if (secretPattern([v])) return '[secret]';
      return v.length > 400 ? `${v.slice(0, 240)} [… ${v.length - 320} chars not shown …] ${v.slice(-80)}` : v;
    }
    if (depth > 6) return '[nested value not shown]';
    if (Array.isArray(v)) return [...v.slice(0, 30).map(x => mask(x, depth + 1)), ...(v.length > 30 ? [`[+${v.length - 30} more items not shown]`] : [])];
    if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      const shown: Record<string, unknown> = Object.fromEntries(entries.slice(0, 50).map(([k, x]) => [k, mask(x, depth + 1)]));
      if (entries.length > 50) shown['[not shown]'] = `+${entries.length - 50} more keys: ${entries.slice(50).map(([k]) => k).join(', ').slice(0, 300)}`;
      return shown;
    }
    return v;
  };
  const text = JSON.stringify(mask(args, 0), null, 1);
  // Line breaks are JSON's own layout (string values keep theirs escaped); every other control or bidi character is
  // shown as an escape, so the dialog shows lines, not `\u000A`.
  const safe = (t: string) => t.split('\n').map(line => displaySafe(line, 6000)).join('\n');
  return text.length > 6000 ? `${safe(text.slice(0, 6000))}\n[… the rest of the arguments is not shown …]` : safe(text);
}

/** The digest an approval is bound to. RFC 8785, so any JSON the call can carry (decimals included) has one; a value
 *  that has none (a lone surrogate) is refused as a request, never treated as an outage. */
export function argsHash(args: Record<string, unknown>): string {
  try { return createHash('sha256').update(canonicalizeRfc8785(args)).digest('hex'); }
  catch (e) { throw new GatewayError(400, `the call's arguments have no canonical form (${e instanceof Error ? e.message.slice(0, 120) : 'error'}); refused`); }
}

/** `mcp__<server>__<tool>`, the name the flow policy's labels match. */
export function guardToolName(server: string, tool: string): string {
  if (!SERVER.test(server)) throw new GatewayError(400, 'server must match [A-Za-z0-9_-]{1,64}');
  if (!TOOL.test(tool)) throw new GatewayError(400, 'tool must match [A-Za-z0-9_.:-]{1,128}');
  return `mcp__${server}__${tool}`;
}

/** The call as the flow guard sees it. Server `builtin` is the platform's own tools: web search and fetch become
 *  `WebSearch` / `WebFetch`, the rest `mcp__owui__<tool>`. */
export function guardCall(server: string, tool: string, args: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  if (server === 'builtin') {
    guardToolName('owui', tool);
    return BUILTIN_AS[tool]?.(args) ?? { name: `mcp__owui__${tool}`, input: args };
  }
  return { name: guardToolName(server, tool), input: args };
}

export function checkWho(who: Who): Who {
  if (who.user && !ID.test(who.user)) throw new GatewayError(400, 'user id is not an identifier');
  if (who.chat && !ID.test(who.chat)) throw new GatewayError(400, 'chat id is not an identifier');
  return who;
}

export class Decider {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  private grants: GrantStore;
  private readonly expiredDir: string;
  /** Placeholders per chat, in memory only (mask.ts). The header values the gateway sends its servers are masked too. */
  readonly masker: Masker;

  constructor(readonly config: GatewayConfig, env: NodeJS.ProcessEnv = process.env, private now: () => number = Date.now) {
    this.env = flowEnv(config, env);
    // The flow guard resolves local paths against a project folder; the gateway has none, so it gets an empty one.
    this.cwd = join(config.stateDir, 'gateway', 'cwd');
    mkdirSync(this.cwd, { recursive: true, mode: 0o700 });
    this.grants = new GrantStore(join(config.stateDir, 'gateway', 'approvals'), () => this.now());
    this.expiredDir = join(config.stateDir, 'gateway', 'expired');
    mkdirSync(this.expiredDir, { recursive: true, mode: 0o700 });
    this.masker = new Masker(config.mask, env, () => this.now(), config.servers.flatMap(s => Object.values(s.headers)));
  }

  /** The masking session of a chat. A call with no chat id gets a session of its own: its placeholders cannot come back. */
  private maskSession(who: Who) {
    checkWho(who);
    return this.masker.session(who.chat ? `owui:${encodeURIComponent(who.user || '-')}:${encodeURIComponent(who.chat)}` : `nochat:${randomUUID()}`);
  }

  /**
   * Text on its way to the model: placeholders for credentials and, when on, personal data. `origin` is the server the
   * text came from (`user` for the person's own message). `history`: text the chat showed before and now sends again,
   * whose known values keep the origins they had.
   */
  mask<T>(who: Who, origin: string, tool: string | undefined, value: T, history = false): { value: T; total: number; counts: Record<string, number>; note?: string } {
    const s = this.maskSession(who);
    const r = s.mask(value, { server: origin, tool }, { keepOrigins: history });
    if (r.total && who.chat) this.note(this.session(who), who, { kind: 'mask', server: origin, tool: tool ? safeToolName(tool) : undefined, masked: maskSummary(r.counts) });
    return { ...r, note: s.note(r) };
  }

  /** Real values back into a call to `server`/`tool`; a placeholder the policy keeps from it throws MaskRefusal. */
  restore<T>(who: Who, server: string, tool: string, value: T, encode?: (v: string) => string): T {
    const r = this.maskSession(who).restore(value, { server, tool }, encode);
    if (r.restored && who.chat) this.note(this.session(who), who, { kind: 'restore', server, tool: safeToolName(tool), restored: maskSummary(r.kinds) });
    return r.value;
  }

  /** Placeholders back to values for the person reading the answer (personal data by default; credentials stay masked). */
  reveal(who: Who, text: string): string {
    return who.chat ? this.maskSession(who).reveal(text) : text;
  }

  /**
   * `requireAdapter`: a chat the platform adapter never reported a message for is judged as having read outside text.
   * With the adapter switched off or failing, nothing tells the gateway what the chat read, so it must not assume a
   * clean chat. The first call of such a chat records that, once.
   */
  private unreported(session: string, who: Who): void {
    if (!this.config.requireAdapter || !who.chat) return;
    const paths = flowPaths(stateDir(this.env), session);
    let turn = 0;
    try { turn = readFlowState(paths.state).turn ?? 0; } catch { turn = 0; }
    if (turn > 0) return;
    let state;
    try { state = readFlowState(paths.state); } catch { state = undefined; }
    if (state?.untrusted.some(u => u.tool === 'mcp__gateway__no_adapter_report')) return;
    flowPost({ session_id: session, tool_name: 'mcp__gateway__no_adapter_report', tool_input: {},
      tool_response: 'No message of this chat reached WARDEN from the platform adapter; what the chat read is unknown.', cwd: this.cwd }, this.env);
    this.note(session, who, { kind: 'no_adapter_report' });
  }

  mode(): string { return loadPolicy(this.env).mode; }

  /**
   * The flow-guard session of a chat. One state per user and chat. Without a chat id there is nothing to tie the call
   * to, so it gets a fresh session that already holds outside text: a send from it is judged as one made after
   * reading a page (fail-closed), and no approval code issued for it can ever be redeemed from a real chat.
   */
  session(who: Who): string {
    checkWho(who);
    // Encoded, so `a:b` + `c` and `a` + `b:c` are two sessions, not one.
    if (who.chat) return `owui:${encodeURIComponent(who.user || '-')}:${encodeURIComponent(who.chat)}`;
    const session = `owui-nochat:${randomUUID()}`;
    flowPost({ session_id: session, tool_name: 'mcp__gateway__unknown_chat', tool_input: {}, tool_response: 'The calling chat is unknown; treat everything as outside text.', cwd: this.cwd }, this.env);
    return session;
  }

  private note(session: string, who: Who, entry: Record<string, unknown>): void {
    log(flowPaths(stateDir(this.env), session), { event: 'gateway', user_id: who.user || undefined, chat_id: who.chat || undefined, ...entry });
  }

  /** The person wrote a message: their own words and the destinations they name. `first` is true when the gateway had
   *  no state for this chat (new, removed by retention, or older than the install): the adapter then reports what the
   *  chat's earlier messages may have brought in. */
  prompt(who: Who, prompt: unknown): { first: boolean } {
    if (typeof prompt !== 'string') throw new GatewayError(400, 'prompt must be a string');
    if (!who.chat) throw new GatewayError(400, 'a prompt needs the chat id');
    const session = this.session(who);
    let turn = 0;
    try { turn = readFlowState(flowPaths(stateDir(this.env), session).state).turn ?? 0; } catch { turn = 0; }
    this.expired(session, who);
    flowPrompt({ session_id: session, prompt: prompt.slice(0, 100_000), cwd: this.cwd }, this.env);
    return { first: turn === 0 };
  }

  /** Outside text reached the chat without a tool call: web search, a document, a file, a fetched page. */
  source(who: Who, body: Record<string, unknown>): { tainted: boolean } {
    const kind = body.kind as SourceKind;
    if (!SOURCE_KINDS.includes(kind)) throw new GatewayError(400, `kind must be one of ${SOURCE_KINDS.join(', ')}`);
    if (!who.chat) throw new GatewayError(400, 'a source needs the chat id');
    const session = this.session(who);
    const name = typeof body.name === 'string' ? body.name.slice(0, 500) : '';
    const text = typeof body.text === 'string' && body.text ? body.text.slice(0, 1_048_576) : `[${kind}] ${name || 'content the chat read'}`;
    let tool: string, input: Record<string, unknown>;
    if (kind === 'web_search') { tool = 'WebSearch'; input = { query: typeof body.query === 'string' ? body.query.slice(0, 2000) : '' }; }
    else if (kind === 'url') {
      if (typeof body.url !== 'string' || !/^https?:\/\//i.test(body.url)) throw new GatewayError(400, 'a url source needs an http(s) url');
      tool = 'WebFetch'; input = { url: body.url.slice(0, 4000) };
    } else { tool = `mcp__openwebui__${kind}`; input = name ? { name } : {}; }
    flowPost({ session_id: session, tool_name: tool, tool_input: input, tool_response: text, cwd: this.cwd }, this.env);
    this.note(session, who, { kind, tool });
    return { tainted: true };
  }

  /** Before a call. `allow` runs it; `deny` refuses it; `ask` refuses it until the code is approved. */
  /** `bind` replaces the argument digest an approval is tied to (the OpenAPI proxy binds the exact request). */
  pre(who: Who, server: string, tool: string, args: Record<string, unknown>, bind?: string): PreAnswer {
    const { name, input } = guardCall(server, tool, args);
    const hash = bind ?? argsHash(args);
    const session = this.session(who);
    this.expired(session, who);
    this.unreported(session, who);
    const detail: FlowPreDetail = {};
    let d;
    try { d = flowPre({ session_id: session, tool_name: name, tool_input: input, cwd: this.cwd }, this.env, 'hook', detail); }
    catch (e) {
      // A corrupt or unreadable state must not let the call through.
      this.note(session, who, { tool: safeToolName(name), decision: 'deny', resolution: 'guard_error' });
      return { decision: 'deny', reason: 'guard_error', mode: this.mode(), message: `WARDEN flow guard could not check this call (${e instanceof Error ? e.message : String(e)}). Refused.` };
    }
    const mode = this.mode();
    if (!d) {
      // In audit the flow guard still names the rule that would have refused the call: say so, the pilot counts these.
      const would = mode === 'audit' && detail.reason ? { wouldRefuse: detail.reason } : {};
      this.note(session, who, { tool: safeToolName(name), decision: 'allow', ...(mode === 'audit' ? { resolution: 'audit' } : {}), ...would });
      return { decision: 'allow', mode, ...(mode === 'audit' ? { resolution: 'audit' as const } : {}), ...would };
    }
    const reason = detail.reason;
    if (d.permissionDecision === 'deny') {
      this.note(session, who, { tool: safeToolName(name), decision: 'deny', reason });
      return { decision: 'deny', reason, mode, message: d.permissionDecisionReason };
    }
    if (!who.chat) {
      // A code issued here could never be redeemed (no chat to answer from); a fresh one per retry would only fill the store.
      this.note(session, who, { tool: safeToolName(name), decision: 'deny', reason, resolution: 'no_chat' });
      return { decision: 'deny', reason, mode, message: `${d.permissionDecisionReason}\nThe calling chat is unknown, so this call cannot be approved.` };
    }
    this.sweep();
    const key = GrantStore.key(session, name, hash);
    if (this.grants.claim(key)) {
      flowApproval({ session_id: session, tool_name: name }, 'approved', this.env);
      this.note(session, who, { tool: safeToolName(name), decision: 'allow', reason, resolution: 'approved' });
      return { decision: 'allow', reason, mode, resolution: 'approved' };
    }
    // The same pending call keeps its code: a retry before the person answers must not hand out new ones.
    let code = this.grants.pendingCode(key);
    if (!code) {
      if (this.grants.count() >= MAX_GRANTS) throw new GatewayError(503, 'too many pending approvals');
      code = this.grants.create(key, { session, tool: name, args: hash, expires: this.now() + this.config.approvalTtlSeconds * 1000, approved: false, chat: who.chat, user: who.user, preview: previewArgs(args) });
    }
    this.note(session, who, { tool: safeToolName(name), decision: 'ask', reason });
    return { decision: 'ask', reason, mode, code, message: d.permissionDecisionReason, preview: previewArgs(args) };
  }

  /** What the person answered. Only the adapter calls this, on the person's own message or dialog answer. */
  approve(who: Who, code: unknown, approved: unknown, peek = false): { ok: boolean; tool?: string; preview?: string } {
    if (typeof code !== 'string' || !/^[A-Z0-9]{4,8}$/.test(code.toUpperCase())) throw new GatewayError(400, 'code is not an approval code');
    if (!who.chat) throw new GatewayError(400, 'an approval needs the chat id');
    checkWho(who);
    this.sweep();
    if (peek) {
      // What the code would approve, so the adapter can show the person the tool and arguments before answering.
      const found = this.grants.peek(code.toUpperCase(), who);
      return found ? { ok: true, tool: found.g.tool, preview: found.g.preview } : { ok: false };
    }
    if (typeof approved !== 'boolean') throw new GatewayError(400, 'approved must be true or false');
    // A code from another chat or user, an expired one or one already answered is refused alike.
    const g = this.grants.answer(code.toUpperCase(), who, approved);
    if (!g) return { ok: false };
    if (!approved) {
      flowApproval({ session_id: g.session, tool_name: g.tool }, 'declined', this.env);
      this.note(g.session, who, { tool: safeToolName(g.tool), resolution: 'declined' });
      return { ok: true, tool: g.tool };
    }
    this.note(g.session, who, { tool: safeToolName(g.tool), resolution: 'approval_granted' });
    return { ok: true, tool: g.tool, preview: g.preview };
  }

  /** After a call: record what the result brought in, and screen it for text addressed to the model. */
  async post(who: Who, server: string, tool: string, args: Record<string, unknown>, result: unknown, isError = false): Promise<PostAnswer> {
    const { name, input } = guardCall(server, tool, args);
    const session = this.session(who);
    const out = flowPost({ session_id: session, tool_name: name, tool_input: input, tool_response: result, cwd: this.cwd, ...(isError ? { tool_error: true } : {}) }, this.env);
    const answer: PostAnswer = {};
    if (this.config.results !== 'off') {
      const ref: McpServerRef = { id: `gateway:${server}`, name: server, transport: 'http' };
      const screen = await screenResult(ref, tool, result, this.config.policy);
      if (screen.flagged) {
        answer.codes = screen.codes;
        if (this.config.results === 'block' && this.mode() !== 'audit') answer.withhold = true;
        else answer.notice = resultNotice(tool, screen.codes);
      }
    }
    if (out?.additionalContext) {
      answer.flowNote = out.additionalContext;
      answer.instruction = /as if it were an instruction/.test(out.additionalContext);
    }
    return answer;
  }

  /** The text a proxy returns instead of running a refused call. */
  refusal(answer: PreAnswer, tool: string): string {
    const why = displaySafe(answer.message ?? 'WARDEN flow guard refused this call.', 4000);
    if (answer.decision === 'ask' && answer.code) {
      return `${why}\n\nWARDEN: this call needs the user's confirmation. Ask the user to reply with exactly "${this.config.approvePhrase} ${answer.code}" ` +
        `(valid ${Math.round(this.config.approvalTtlSeconds / 60)} min, for this call of ${displaySafe(tool, 128)} with these arguments only), then call the tool again with the same arguments. Do not type the code yourself.`;
    }
    return `${why}\n\nRefused by the WARDEN flow guard. Do not retry this call in another form; tell the user what was refused.`;
  }

  private sweep(): void {
    this.grants.sweep(this.config.approvalTtlSeconds * 1000);
  }

  /**
   * Remove chat state older than `retentionDays`, and expired approval codes (with the argument previews they keep).
   * A chat whose state is removed leaves a mark (`gateway/expired/<state hash>`, empty): if the chat comes back, what it
   * read before is unknown, and its first call or message records that as outside text. Marks go after a year.
   * Returns the number of state files removed.
   */
  purge(): number {
    this.sweep();
    const dir = flowPaths(stateDir(this.env), 'x').dir;
    const cutoff = this.now() - this.config.retentionDays * 86_400_000;
    let removed = 0, names: string[] = [];
    try { names = readdirSync(dir); } catch { names = []; }
    for (const n of names) {
      if (!/^[0-9a-f]{64}(\.[a-z]+)*\.(json|fp|log)$/.test(n)) continue;
      const p = join(dir, n);
      try {
        if (statSync(p).mtimeMs >= cutoff) continue;
        if (/^[0-9a-f]{64}\.json$/.test(n)) writeFileSync(join(this.expiredDir, n.slice(0, 64)), '', { mode: 0o600 });
        unlinkSync(p); removed++;
      } catch { /* raced */ }
    }
    let marks: string[] = [];
    try { marks = readdirSync(this.expiredDir); } catch { marks = []; }
    for (const n of marks) {
      const p = join(this.expiredDir, n);
      try { if (statSync(p).mtimeMs < this.now() - 365 * 86_400_000) unlinkSync(p); } catch { /* raced */ }
    }
    return removed;
  }

  /** A chat whose state retention removed: record once that what it read before is unknown. */
  private expired(session: string, who: Who): void {
    if (!who.chat) return;
    const mark = join(this.expiredDir, sessionKey(session));
    try { statSync(mark); } catch { return; }
    flowPost({ session_id: session, tool_name: 'mcp__gateway__expired_state', tool_input: {},
      tool_response: 'WARDEN removed this chat\'s state after the retention period; what the chat read before is unknown.', cwd: this.cwd }, this.env);
    try { unlinkSync(mark); } catch { /* raced */ }
    this.note(session, who, { kind: 'expired_state' });
  }
}

/** Parse the who/where fields of a /v1 request body. */
export function whoOf(body: Record<string, unknown>): Who {
  const user = body.user_id === undefined ? '' : body.user_id;
  const chat = body.chat_id ?? body.session_id ?? '';
  if (typeof user !== 'string' || typeof chat !== 'string') throw new GatewayError(400, 'user_id and chat_id must be strings');
  return checkWho({ user, chat });
}

export function argsOf(v: unknown): Record<string, unknown> {
  if (v === undefined) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new GatewayError(400, 'tool_input must be a JSON object');
  return obj(v);
}
