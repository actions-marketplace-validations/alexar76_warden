/**
 * Masking, part 2: placeholders on the way to the model, real values on the way back to a tool.
 *
 * A tool result passes through `MaskSession.mask` before the model reads it: every credential (on by default) and,
 * when the operator turns it on, every personal identifier is replaced by a placeholder, `WARDEN_SECRET_7Q2M9XD4RK`.
 * The model works with the placeholder; when it puts one in a tool call's arguments, `MaskSession.restore` puts the
 * real value back, but only for a destination the policy allows: by default the server the value came from. A
 * placeholder sent anywhere else stops the call (`MaskRefusal`), so a prompt injection cannot move a key or a
 * customer's address to another server even when it fools the model.
 *
 * In the terms of the EDPB's Guidelines 01/2025 on pseudonymisation: the model, its provider and its logs are the
 * pseudonymisation domain; the table that links a placeholder to its value is the additional information, and it stays
 * in this process's memory: never written to disk, never logged, gone when the process ends. Placeholders are random
 * (50 bits from the system CSPRNG), carry no part of the value, and differ between sessions, so two sessions cannot be
 * linked through them. Within one session the same value always gets the same placeholder, so the model can tell that
 * two results mention the same person or key.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { wildcardMatch } from './glob.js';
import {
  ID_ALPHABET, ID_LENGTH, KIND_RE, PERSONAL_KINDS, PLACEHOLDER_ANY_RE, PLACEHOLDER_RE, PROFILES, credentialSpans, credentialValue, personalSpans,
  placeholderFor, resolveSpans, type MaskClass, type PersonalOptions, type Span,
} from './mask-detect.js';

export type RestorePolicy = 'origin' | 'never' | 'anywhere';
export const RESTORE_POLICIES: readonly RestorePolicy[] = ['origin', 'never', 'anywhere'];

export interface ClassPolicy {
  enabled: boolean;
  /** Where a placeholder may be turned back into its value: `origin` (default) the server it came from, plus `restoreTo`;
   *  `anywhere` any tool; `never` nowhere, the tool receives the placeholder. */
  restore: RestorePolicy;
  /** More destinations: `server` or `server/tool` (`*` matches any run of characters). */
  restoreTo: string[];
  /** Results of these tools are not masked: `server/tool` or `tool` patterns. */
  exceptTools: string[];
}
export interface CredentialPolicy extends ClassPolicy {
  /** Mask the values of this process's environment variables whose names say they hold a credential. */
  autoEnv: boolean;
  /** More environment variables whose values are masked wherever they appear. */
  envNames: string[];
}
export interface PersonalPolicy extends ClassPolicy, PersonalOptions {
  profile: string;
}
export interface MaskConfig {
  credentials: CredentialPolicy;
  personal: PersonalPolicy;
  /** Placeholders a session keeps; the least recently used go first (their placeholders then pass as plain text). */
  maxEntries: number;
  /** A session idle this long is forgotten (gateway chats; a stdio wrap is one session for its lifetime). */
  idleMinutes: number;
  /** What the user sees (OpenWebUI outlet, Hermes final answer): personal data restored, credentials kept masked. */
  display: { credentials: boolean; personal: boolean };
}

const CLASS_KEYS = ['enabled', 'restore', 'restoreTo', 'exceptTools'];
const CRED_KEYS = new Set([...CLASS_KEYS, 'autoEnv', 'envNames']);
const PERS_KEYS = new Set([...CLASS_KEYS, 'profile', 'kinds', 'privateIps', 'terms', 'termsFile', 'patterns', 'keep']);
const TOP_KEYS = new Set(['credentials', 'personal', 'maxEntries', 'idleMinutes', 'display']);
const TARGET = /^[A-Za-z0-9._*-]{1,64}(?:\/[A-Za-z0-9._*-]{1,128})?$/;

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} must be an object`);
  return v as Record<string, unknown>;
}
function bool(v: unknown, what: string, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new Error(`${what} must be true or false`);
  return v;
}
function list(v: unknown, what: string, check?: (s: string) => boolean): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x || (check && !check(x)))) throw new Error(`${what} must be a list of ${check ? 'valid ' : ''}strings`);
  return v as string[];
}
function restoreOf(v: unknown, what: string): RestorePolicy {
  if (v === undefined) return 'origin';
  if (!(RESTORE_POLICIES as readonly unknown[]).includes(v)) throw new Error(`${what} must be one of ${RESTORE_POLICIES.join(', ')}`);
  return v as RestorePolicy;
}
function int(v: unknown, what: string, min: number, max: number, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${what} must be an integer from ${min} to ${max}`);
  return v;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A term matches as a whole word (Unicode letters and digits), any case, with any run of spaces between its words. */
export function termPattern(term: string): RegExp {
  const body = term.trim().split(/\s+/).map(escape).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Operator patterns run on every result: refuse the constructs that can backtrack for a long time. */
function operatorPattern(source: string, what: string): RegExp {
  if (source.length > 300) throw new Error(`${what} is longer than 300 characters`);
  if (/\\[1-9]|\(\?<?[=!]|\)\s*[*+{]|[*+}]\s*[*+{]/.test(source)) throw new Error(`${what} uses a backreference, a lookaround or a nested quantifier; WARDEN refuses patterns that can run for a long time`);
  try { return new RegExp(source, 'gu'); } catch (e) { throw new Error(`${what} is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`); }
}

function terms(v: unknown, what: string): Array<{ kind: string; re: RegExp }> {
  if (v === undefined) return [];
  // ["Ann Smith", …] are names; {"NAME": [...], "CUSTOMER": [...]} gives each list its kind.
  const groups: Record<string, unknown> = Array.isArray(v) ? { NAME: v } : obj(v, what);
  const out: Array<{ kind: string; re: RegExp }> = [];
  for (const [kind, words] of Object.entries(groups)) {
    if (!KIND_RE.test(kind)) throw new Error(`${what}: kind ${kind} must be 2–12 capital letters`);
    for (const t of list(words, `${what}.${kind}`)) if (t.trim().length >= 2) out.push({ kind, re: termPattern(t) });
  }
  return out;
}

/**
 * Read a mask configuration. `raw` is the JSON object (`--mask FILE`, the gateway's `mask` field), or `undefined` for
 * the defaults: credentials masked with restore to their origin, personal data not masked. Shorthands:
 * `"credentials": false` turns credential masking off; `"personal": "gdpr"` turns personal masking on with that profile.
 * Unknown fields are an error, as everywhere in WARDEN's configuration.
 */
export function parseMaskConfig(raw: unknown, baseDir = process.cwd()): MaskConfig {
  const r = raw === undefined ? {} : obj(raw, 'mask');
  for (const k of Object.keys(r)) if (!TOP_KEYS.has(k)) throw new Error(`Unknown mask field ${k}`);
  const c = r.credentials === false ? { enabled: false } : r.credentials === true || r.credentials === undefined ? {} : obj(r.credentials, 'mask.credentials');
  for (const k of Object.keys(c)) if (!CRED_KEYS.has(k)) throw new Error(`Unknown mask.credentials field ${k}`);
  const p = typeof r.personal === 'string' ? { enabled: true, profile: r.personal } : r.personal === false || r.personal === undefined ? { enabled: false } : r.personal === true ? { enabled: true } : obj(r.personal, 'mask.personal');
  for (const k of Object.keys(p)) if (!PERS_KEYS.has(k)) throw new Error(`Unknown mask.personal field ${k}`);
  const profile = p.profile === undefined ? 'gdpr' : String(p.profile);
  if (!PROFILES[profile]) throw new Error(`mask.personal.profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  const kinds = p.kinds === undefined ? PROFILES[profile]!.kinds : list(p.kinds, 'mask.personal.kinds', k => (PERSONAL_KINDS as readonly string[]).includes(k));
  let termList = terms(p.terms, 'mask.personal.terms');
  if (p.termsFile !== undefined) {
    if (typeof p.termsFile !== 'string') throw new Error('mask.personal.termsFile must be a path');
    const path = p.termsFile.startsWith('/') ? p.termsFile : `${baseDir}/${p.termsFile}`;
    // One term per line; `KIND: term` gives it a kind. Blank lines and lines starting with # are skipped.
    const lines = readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    for (const line of lines) {
      const m = /^([A-Z]{2,12}):\s*(.+)$/.exec(line);
      termList = termList.concat(terms({ [m ? m[1]! : 'NAME']: [m ? m[2]! : line] }, `mask.personal.termsFile`));
    }
  }
  const patterns: Array<{ kind: string; re: RegExp }> = [];
  if (p.patterns !== undefined) {
    if (!Array.isArray(p.patterns)) throw new Error('mask.personal.patterns must be a list of {kind, pattern}');
    p.patterns.forEach((x, i) => {
      const o = obj(x, `mask.personal.patterns[${i}]`);
      for (const k of Object.keys(o)) if (k !== 'kind' && k !== 'pattern') throw new Error(`Unknown mask.personal.patterns[${i}] field ${k}`);
      if (typeof o.kind !== 'string' || !KIND_RE.test(o.kind)) throw new Error(`mask.personal.patterns[${i}].kind must be 2–12 capital letters`);
      if (typeof o.pattern !== 'string') throw new Error(`mask.personal.patterns[${i}].pattern must be a string`);
      patterns.push({ kind: o.kind, re: operatorPattern(o.pattern, `mask.personal.patterns[${i}].pattern`) });
    });
  }
  const d = r.display === undefined ? {} : obj(r.display, 'mask.display');
  for (const k of Object.keys(d)) if (k !== 'credentials' && k !== 'personal') throw new Error(`Unknown mask.display field ${k}`);
  return {
    credentials: {
      enabled: bool(c.enabled, 'mask.credentials.enabled', true),
      restore: restoreOf(c.restore, 'mask.credentials.restore'),
      restoreTo: list(c.restoreTo, 'mask.credentials.restoreTo', s => TARGET.test(s)),
      exceptTools: list(c.exceptTools, 'mask.credentials.exceptTools', s => TARGET.test(s)),
      autoEnv: bool(c.autoEnv, 'mask.credentials.autoEnv', true),
      envNames: list(c.envNames, 'mask.credentials.envNames', s => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s)),
    },
    personal: {
      enabled: bool(p.enabled, 'mask.personal.enabled', false),
      profile,
      kinds,
      phoneNational: PROFILES[profile]!.phoneNational,
      restore: restoreOf(p.restore, 'mask.personal.restore'),
      restoreTo: list(p.restoreTo, 'mask.personal.restoreTo', s => TARGET.test(s)),
      exceptTools: list(p.exceptTools, 'mask.personal.exceptTools', s => TARGET.test(s)),
      privateIps: bool(p.privateIps, 'mask.personal.privateIps', false),
      terms: [...termList, ...patterns],
      keep: list(p.keep, 'mask.personal.keep').map(s => s.toLowerCase()),
    },
    maxEntries: int(r.maxEntries, 'mask.maxEntries', 16, 1_000_000, 10_000),
    idleMinutes: int(r.idleMinutes, 'mask.idleMinutes', 1, 525_600, 1440),
    display: { credentials: bool(d.credentials, 'mask.display.credentials', false), personal: bool(d.personal, 'mask.display.personal', true) },
  };
}

export interface MaskOverrides {
  /** A JSON file (`--mask FILE`); without it `WARDEN_MASK` is read. */
  file?: string;
  /** `--mask-credentials on|off`. */
  credentials?: boolean;
  /** `--mask-personal <profile>|on|off`. */
  personal?: string | false;
}

/**
 * The configuration a wrap or gateway runs with, for clients that start WARDEN with no flags as much as for those that
 * pass them. In order, later wins: the defaults; the file (`--mask FILE`, else `WARDEN_MASK`); the environment
 * switches `WARDEN_MASK_CREDENTIALS=off` and `WARDEN_MASK_PERSONAL=<profile>|off` (only without `--mask FILE`, so a
 * file the operator names is the whole policy); the flags.
 */
export function loadMaskConfig(o: MaskOverrides = {}, env: NodeJS.ProcessEnv = process.env): MaskConfig {
  const path = o.file ?? env.WARDEN_MASK;
  let raw: Record<string, unknown> = {};
  if (path) {
    try { raw = obj(JSON.parse(readFileSync(path, 'utf8')), 'mask'); }
    catch (e) { throw new Error(`Cannot read mask config ${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (!o.file) {
    const cred = env.WARDEN_MASK_CREDENTIALS?.trim().toLowerCase();
    if (cred === 'off' || cred === '0' || cred === 'false') raw = { ...raw, credentials: false };
    const pers = env.WARDEN_MASK_PERSONAL?.trim();
    if (pers) raw = { ...raw, personal: personalOverride(raw.personal, /^(off|0|false)$/i.test(pers) ? false : pers) };
  }
  if (o.credentials !== undefined) {
    raw = { ...raw, credentials: !o.credentials ? false : raw.credentials && typeof raw.credentials === 'object' ? { ...raw.credentials as object, enabled: true } : true };
  }
  if (o.personal !== undefined) raw = { ...raw, personal: personalOverride(raw.personal, o.personal) };
  return parseMaskConfig(raw, path ? path.replace(/\/[^/]*$/, '') || '/' : process.cwd());
}

/** Turn personal masking on with a profile (keeping the file's terms, patterns and restore rules) or off. */
function personalOverride(current: unknown, value: string | false): unknown {
  if (value === false) return current && typeof current === 'object' ? { ...current as object, enabled: false } : false;
  const base = current && typeof current === 'object' ? current as Record<string, unknown> : {};
  if (value === 'on') return { ...base, enabled: true };
  if (!PROFILES[value]) throw new Error(`personal masking profile must be one of ${Object.keys(PROFILES).join(', ')}, on or off`);
  // A profile named on the command line or in the environment picks its own kinds.
  const { kinds: _kinds, ...rest } = base;
  return { ...rest, enabled: true, profile: value };
}

/** @deprecated name kept for callers of the first draft: same as loadMaskConfig({ file }, env). */
export function maskConfigFromEnv(env: NodeJS.ProcessEnv = process.env, file?: string): MaskConfig {
  return loadMaskConfig({ file }, env);
}

/** Environment variables whose names say they hold a credential, and whose values look like one. */
export function credentialEnvValues(env: NodeJS.ProcessEnv, extraNames: readonly string[] = []): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    const named = extraNames.includes(name);
    if (!named && !/(?:PASSWORD|PASSWD|PASSPHRASE|TOKEN|SECRET|_KEY|APIKEY|_PAT|CREDENTIALS?)$/i.test(name) && !credentialValue(name, value)) continue;
    const v = value.trim();
    if (v.length < 8 || /^(?:\/|~|\.\.?\/|[A-Za-z]:\\|https?:\/\/)/.test(v)) continue; // paths and URLs name a credential, they are not one
    if (!named && !credentialValue('secret', v)) continue;
    out.add(v);
  }
  // Longest first, so a key that contains another known value is masked whole.
  return [...out].sort((a, b) => b.length - a.length);
}

export interface MaskOrigin { server: string; tool?: string }
export interface MaskResult<T> { value: T; total: number; counts: Record<string, number> }
export interface RestoreResult<T> { value: T; restored: number; kinds: Record<string, number> }

/** A placeholder in a call's arguments that the policy does not let through to this destination. The call is not sent. */
export class MaskRefusal extends Error {}

interface Entry { id: string; kind: string; cls: MaskClass; value: string; origins: Set<string>; used: number }

function newId(): string {
  const b = randomBytes(8);
  let n = b.readBigUInt64BE() >> 14n; // 50 bits
  let s = '';
  for (let i = 0; i < ID_LENGTH; i++) { s = ID_ALPHABET[Number(n & 31n)]! + s; n >>= 5n; }
  return s;
}

function normalize(kind: string, value: string): string {
  if (kind === 'SECRET') return value;
  if (kind === 'EMAIL' || kind === 'IP') return value.toLowerCase();
  if (['PHONE', 'CARD', 'IBAN', 'SSN', 'SNILS', 'INN'].includes(kind)) return value.replace(/[^A-Za-z0-9+]/g, '').toUpperCase();
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

/** `server` or `server/tool` patterns against a destination. */
function matches(patterns: readonly string[], server: string, tool: string | undefined): boolean {
  const s = server.toLowerCase(), t = (tool ?? '').toLowerCase();
  return patterns.some(p => {
    const [ps, pt] = p.toLowerCase().split('/') as [string, string | undefined];
    return wildcardMatch(ps, s) && (pt === undefined || wildcardMatch(pt, t));
  });
}

function exceptMatch(patterns: readonly string[], origin: MaskOrigin): boolean {
  const s = origin.server.toLowerCase(), t = (origin.tool ?? '').toLowerCase();
  return patterns.some(p => {
    const lp = p.toLowerCase();
    if (!lp.includes('/')) return wildcardMatch(lp, t);
    const [ps, pt] = lp.split('/') as [string, string];
    return wildcardMatch(ps, s) && wildcardMatch(pt, t);
  });
}

/** The origin of values the user typed into the chat: theirs to use, so personal data from it is restored anywhere. */
export const USER_ORIGIN = 'user';

/**
 * Walk a JSON value and rewrite every string, keeping the shape. Binary payloads (an image's or audio's `data`, a
 * resource's `blob`) are base64, not text, and are left alone. Object keys are not rewritten.
 */
function rewrite<T>(value: T, fn: (s: string, field: string | undefined) => string, field?: string, depth = 0): T {
  if (depth > 64) return value;
  // A data URL is an image or a file, not text: base64 can look like anything.
  if (typeof value === 'string') return (/^data:[\w.+-]+\/[\w.+-]+(?:;[\w=.+-]+)*;base64,/i.test(value) ? value : fn(value, field)) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map(v => { const n = rewrite(v, fn, field, depth + 1); if (n !== v) changed = true; return n; });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const binary = o.type === 'image' || o.type === 'audio';
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const n = (k === 'blob' || (binary && k === 'data')) ? v : rewrite(v, fn, k, depth + 1);
      if (n !== v) changed = true;
      out[k] = n;
    }
    return (changed ? out : value) as T;
  }
  return value;
}

export class Masker {
  readonly config: MaskConfig;
  private readonly known: string[];
  private readonly sessions = new Map<string, { session: MaskSession; seen: number }>();
  private readonly now: () => number;

  /** `extraKnown`: more exact credentials to mask, such as the header values a gateway sends its tool servers. */
  constructor(config: MaskConfig, env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now, extraKnown: readonly string[] = []) {
    this.config = config;
    this.now = now;
    this.known = config.credentials.enabled
      ? [...new Set([
        ...(config.credentials.autoEnv ? credentialEnvValues(env, config.credentials.envNames) : []),
        ...config.credentials.envNames.map(n => env[n]?.trim() ?? '').filter(v => v.length >= 6),
        ...extraKnown.map(v => v.replace(/^(?:Bearer|Basic|Token)\s+/i, '').trim()).filter(v => v.length >= 8 && credentialValue('secret', v)),
      ])].sort((a, b) => b.length - a.length)
      : [];
  }

  get enabled(): boolean { return this.config.credentials.enabled || this.config.personal.enabled; }

  /** The session for a chat (gateway) or the one session of a stdio wrap. Idle sessions are forgotten. */
  session(key = 'default'): MaskSession {
    const now = this.now();
    const idle = this.config.idleMinutes * 60_000;
    for (const [k, s] of this.sessions) if (now - s.seen > idle) this.sessions.delete(k);
    let s = this.sessions.get(key);
    if (!s) {
      if (this.sessions.size >= 5000) {
        const oldest = [...this.sessions.entries()].sort((a, b) => a[1].seen - b[1].seen)[0];
        if (oldest) this.sessions.delete(oldest[0]);
      }
      s = { session: new MaskSession(this, this.known), seen: now };
      this.sessions.set(key, s);
    }
    s.seen = now;
    return s.session;
  }

  /** Spans to mask in one string, for an origin. */
  spans(text: string, origin: MaskOrigin, field: string | undefined, known: readonly string[]): Span[] {
    const { credentials: c, personal: p } = this.config;
    const spans: Span[] = [];
    if (c.enabled && !exceptMatch(c.exceptTools, origin)) spans.push(...credentialSpans(text, known, field));
    if (p.enabled && !exceptMatch(p.exceptTools, origin)) spans.push(...personalSpans(text, p));
    return spans.length ? resolveSpans(text, spans) : spans;
  }
}

export class MaskSession {
  private readonly byKey = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private clock = 0;
  private noted = false;

  constructor(private readonly masker: Masker, private readonly known: readonly string[]) {}

  private entry(kind: string, cls: MaskClass, value: string, origin: string, keepOrigins = false): Entry {
    const key = `${kind}\u0000${normalize(kind, value)}`;
    let e = this.byKey.get(key);
    if (!e) {
      let id = newId();
      while (this.byId.has(id)) id = newId();
      e = { id, kind, cls, value, origins: new Set(), used: ++this.clock };
      this.byKey.set(key, e); this.byId.set(id, e);
      const max = this.masker.config.maxEntries;
      if (this.byId.size > max) {
        // Least recently used first: its placeholder becomes plain text that no call can turn back into the value.
        const victims = [...this.byId.values()].sort((a, b) => a.used - b.used).slice(0, this.byId.size - max);
        for (const v of victims) { this.byId.delete(v.id); this.byKey.delete(`${v.kind}\u0000${normalize(v.kind, v.value)}`); }
      }
    }
    // Re-masking a chat history must not widen where a known value may go: only a new value takes this origin.
    if (!keepOrigins || e.origins.size === 0) e.origins.add(origin.toLowerCase());
    e.used = ++this.clock;
    return e;
  }

  /**
   * Replace credentials (and personal data, when on) in every string of `value` with placeholders. `keepOrigins`: for
   * text that was shown before (a chat history sent to the model again), a value this session already knows keeps the
   * origins it had; only new values take `origin`.
   */
  mask<T>(value: T, origin: MaskOrigin, opts: { keepOrigins?: boolean } = {}): MaskResult<T> {
    const counts: Record<string, number> = {};
    let total = 0;
    if (!this.masker.enabled) return { value, total, counts };
    const out = rewrite(value, (s, field) => {
      const spans = this.masker.spans(s, origin, field, this.known);
      if (!spans.length) return s;
      let res = '', at = 0;
      for (const sp of spans) {
        const e = this.entry(sp.kind, sp.cls, s.slice(sp.start, sp.end), origin.server, opts.keepOrigins);
        res += s.slice(at, sp.start) + placeholderFor(e.kind, e.id);
        at = sp.end;
        counts[sp.kind] = (counts[sp.kind] ?? 0) + 1; total++;
      }
      return res + s.slice(at);
    });
    return { value: out, total, counts };
  }

  private policy(cls: MaskClass): ClassPolicy {
    return cls === 'credential' ? this.masker.config.credentials : this.masker.config.personal;
  }

  /** May this entry's value go to `server`/`tool`? */
  allowed(e: Entry, server: string, tool: string | undefined): boolean {
    const p = this.policy(e.cls);
    if (p.restore === 'never') return false;
    if (p.restore === 'anywhere') return true;
    if (matches(p.restoreTo, server, tool)) return true;
    if (e.origins.has(server.toLowerCase())) return true;
    // What the user typed is theirs to use: personal data from their own message goes to any tool; a credential they
    // typed only where the policy names (restoreTo), as the flow guard treats a typed secret.
    return e.cls === 'personal' && e.origins.has(USER_ORIGIN);
  }

  /**
   * Put real values back into a call's arguments. A placeholder this session made, sent to a destination its policy
   * allows, becomes its value; with `restore: never` it stays a placeholder; sent anywhere else it stops the call
   * (MaskRefusal). A placeholder this session does not know (another WARDEN layer's, or one that aged out) is passed on
   * unchanged: the layer that made it restores or refuses it, and as plain text it carries no value.
   */
  restore<T>(value: T, target: MaskOrigin, encode?: (v: string) => string): RestoreResult<T> {
    const kinds: Record<string, number> = {};
    let restored = 0;
    const refused: string[] = [];
    const out = rewrite(value, s => s.replace(PLACEHOLDER_ANY_RE, (whole: string, kind: string, id: string) => {
      const e = this.byId.get(id.toUpperCase());
      if (!e || e.kind !== kind.toUpperCase()) return whole;
      if (this.policy(e.cls).restore === 'never') return whole;
      if (!this.allowed(e, target.server, target.tool)) { refused.push(whole); return whole; }
      e.used = ++this.clock;
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; restored++;
      return encode ? encode(e.value) : e.value;
    }));
    if (refused.length) {
      const first = this.byId.get(placeholderId(refused[0]!));
      const from = first ? [...first.origins].map(o => o === USER_ORIGIN ? 'your message' : o).join(', ') : 'another server';
      throw new MaskRefusal(`WARDEN masking: ${[...new Set(refused)].slice(0, 3).join(', ')}${refused.length > 3 ? ' and more' : ''} stands for a ${first?.cls === 'personal' ? 'personal value' : 'credential'} read from ${from}; ` +
        `the masking policy lets it go back only there${this.policy(first?.cls ?? 'credential').restoreTo.length ? ' and to the destinations in restoreTo' : ''}, not to ${target.server}${target.tool ? `/${target.tool}` : ''}. The call was not sent.`);
    }
    return { value: out, restored, kinds };
  }

  /**
   * Placeholders back to values for the person reading the answer (OpenWebUI outlet, Hermes final reply). By default
   * personal data is shown and credentials stay masked: a chat transcript is copied, shared and sent to the model again.
   */
  reveal(text: string): string {
    const d = this.masker.config.display;
    return text.replace(PLACEHOLDER_RE, (whole: string, kind: string, id: string) => {
      const e = this.byId.get(id.toUpperCase());
      if (!e || e.kind !== kind.toUpperCase()) return whole;
      return (e.cls === 'credential' ? d.credentials : d.personal) ? e.value : whole;
    });
  }

  /** The note that goes with a masked result: the full text once per session, a short line after. */
  note(result: MaskResult<unknown>): string | undefined {
    if (!result.total) return undefined;
    const parts = Object.entries(result.counts).map(([k, n]) => `${n} ${k}`).join(', ');
    if (this.noted) return `[WARDEN] masked ${parts} (placeholders WARDEN_<KIND>_<ID>; see the earlier WARDEN note).`;
    this.noted = true;
    return `[WARDEN] ${parts} in this result ${result.total === 1 ? 'was' : 'were'} replaced by placeholders such as WARDEN_SECRET_7Q2M9XD4RK or warden_email_…@mask.invalid. ` +
      'You can still use a masked value: write its placeholder, exactly as shown, where the value belongs in a tool call (a command, a header, a field). ' +
      'The tool receives the real value if it may have it (by default: the place the value came from); otherwise WARDEN refuses the call and says why. ' +
      'You never need to see the value, so do not guess, reconstruct or ask for it.';
  }

  /** Placeholders this session holds (for tests and the audit count; never the values). */
  get size(): number { return this.byId.size; }
}

function placeholderId(p: string): string {
  const m = new RegExp(PLACEHOLDER_ANY_RE.source, 'i').exec(p);
  return m ? m[2]!.toUpperCase() : '';
}

/**
 * Put the masking note where the model reads it: after a tool result's content, a resource's contents, a prompt's
 * messages, or an error's message. A value of another shape is returned as it is (the note is optional).
 */
export function withMaskNote<T>(value: T, note: string | undefined): T {
  if (!note || !value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.content)) return { ...v, content: [...v.content, { type: 'text', text: note }] } as T;
  if (Array.isArray(v.contents)) return { ...v, contents: [...v.contents, { uri: 'warden:mask-note', mimeType: 'text/plain', text: note }] } as T;
  if (Array.isArray(v.messages)) return { ...v, messages: [...v.messages, { role: 'user', content: { type: 'text', text: note } }] } as T;
  if (typeof v.message === 'string') return { ...v, message: `${v.message}\n${note}` } as T;
  return value;
}

/** One log line of what a mask or restore did: kinds and counts, never values or placeholders' meaning. */
export function maskSummary(counts: Record<string, number>): string {
  return Object.entries(counts).map(([k, n]) => `${k}×${n}`).join(' ');
}
