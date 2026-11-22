/**
 * Masking, part 1: finding credentials and personal data in text.
 *
 * Every detector returns spans (start, end, kind). It has no state: the same text always gives the same spans. Two
 * classes:
 *
 * - `credential`: a value that grants access. Known token formats (the flow guard's list plus common providers, named
 *   after gitleaks' rule ids where one exists), private key blocks, JWTs, Authorization header values, URL passwords
 *   and credential query parameters, values assigned to credential-named fields, and exact values the operator names.
 * - `personal`: identifiers of a person that a pattern can find reliably, each with its validity check: e-mail
 *   addresses, phone numbers in international form (national forms in the `us` and `ru-152fz` profiles), payment cards
 *   (Luhn and ISO/IEC 7812 issuer ranges), IBANs (ISO 13616 length and mod-97), public IP addresses, US SSNs, Russian
 *   SNILS and personal INN (checksums), plus the terms and patterns the operator lists. Names and street addresses need
 *   a language model to find; WARDEN does not guess them, it masks the names the operator lists.
 *
 * Patterns are bounded: no nested quantifiers over the same characters, so a hostile tool result cannot make a
 * detector run for long (test/mask-detect.test.ts times each one on adversarial input).
 */
import { isIPv4, isIPv6 } from 'node:net';
import { SECRET_PATTERNS } from './flow-guard-fingerprints.js';

export type MaskClass = 'credential' | 'personal';
export interface Span { start: number; end: number; kind: string; cls: MaskClass; label: string }

/** Personal-data kinds WARDEN finds by pattern. Operator terms and patterns add kinds of their own. */
export const PERSONAL_KINDS = ['EMAIL', 'PHONE', 'CARD', 'IBAN', 'IP', 'SSN', 'SNILS', 'INN'] as const;
export type PersonalKind = typeof PERSONAL_KINDS[number];

/** Jurisdiction profiles: which kinds are on. A profile picks detectors; it does not make processing lawful by itself. */
export const PROFILES: Record<string, { kinds: PersonalKind[]; phoneNational: Array<'us' | 'ru'> }> = {
  // EU/EEA GDPR, UK GDPR, Swiss FADP. IP addresses are personal data under the CJEU's Breyer judgment (C-582/14).
  gdpr: { kinds: ['EMAIL', 'PHONE', 'CARD', 'IBAN', 'IP'], phoneNational: [] },
  // California CCPA/CPRA and similar US state laws.
  us: { kinds: ['EMAIL', 'PHONE', 'CARD', 'SSN', 'IP'], phoneNational: ['us'] },
  // Russian Federal Law 152-FZ.
  'ru-152fz': { kinds: ['EMAIL', 'PHONE', 'CARD', 'SNILS', 'INN', 'IP'], phoneNational: ['ru'] },
  // Card data only (PCI DSS scope reduction).
  pci: { kinds: ['CARD'], phoneNational: [] },
  // Nothing built in: only the operator's terms and patterns.
  custom: { kinds: [], phoneNational: [] },
};

// --- placeholders -------------------------------------------------------------------------------------------------

/** Crockford base32: no I, L, O, U, so an id survives being read aloud or retyped. */
export const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_LENGTH = 10;
export const KIND_RE = /^[A-Z]{2,12}$/;
/**
 * `WARDEN_<KIND>_<ID>` everywhere, and `warden_email_<id>@mask.invalid` for e-mail addresses, so a field that must hold
 * an address (JSON Schema `format: email`) still does. ASCII letters, digits and `_` only: valid inside a URL, a JSON
 * string, Markdown and a shell word, so the model can copy it anywhere unchanged. `.invalid` is reserved (RFC 2606):
 * mail to it never leaves the machine.
 */
export const PLACEHOLDER_RE = /(?<![A-Za-z0-9])WARDEN_([A-Z]{2,12})_([0-9A-HJKMNP-TV-Z]{10})(@mask\.invalid)?(?![A-Za-z0-9])/gi;

/** The same, also matching `%40` for the `@` of an e-mail placeholder inside a URL-encoded query or path. */
export const PLACEHOLDER_ANY_RE = new RegExp(PLACEHOLDER_RE.source.replace('(@mask\\.invalid)', '((?:@|%40)mask\\.invalid)'), 'gi');

export function placeholderFor(kind: string, id: string): string {
  return kind === 'EMAIL' ? `warden_email_${id.toLowerCase()}@mask.invalid` : `WARDEN_${kind}_${id}`;
}

export interface PlaceholderSpan { start: number; end: number; kind: string; id: string }
export function placeholderSpans(text: string): PlaceholderSpan[] {
  const out: PlaceholderSpan[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: m[1]!.toUpperCase(), id: m[2]!.toUpperCase() });
  return out;
}

// --- credentials ----------------------------------------------------------------------------------------------------

/** Provider formats beyond the flow guard's list. */
const EXTRA_CREDENTIAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9+/=]{24,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['Twilio API key', /\bSK[0-9a-f]{32}\b/],
  ['DigitalOcean token', /\bdo[opr]_v1_[a-f0-9]{64}\b/],
  ['Shopify token', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/],
  ['PyPI token', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/],
  ['Docker Hub token', /\bdckr_pat_[A-Za-z0-9_-]{27,}/],
  ['Linear key', /\blin_api_[A-Za-z0-9]{40}\b/],
  ['Notion token', /\b(?:secret|ntn)_[A-Za-z0-9]{43,}\b/],
  ['age secret key', /\bAGE-SECRET-KEY-1[0-9A-Z]{58}\b/],
  ['Groq key', /\bgsk_[A-Za-z0-9]{48,}\b/],
  ['xAI key', /\bxai-[A-Za-z0-9]{70,}\b/],
  ['Mailgun key', /\bkey-[0-9a-f]{32}\b/],
  ['HashiCorp Vault token', /\bhv[sbr]\.[A-Za-z0-9_-]{24,}/],
  ['Doppler token', /\bdp\.(?:st|ct|sa|scim|audit)\.[A-Za-z0-9_-]{40,}/],
  ['Postman key', /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/],
  ['Terraform Cloud token', /\b[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}/],
  ['Supabase token', /\bsbp_[a-f0-9]{40}\b/],
  ['Figma token', /\bfigd_[A-Za-z0-9_-]{40,}/],
  ['Databricks token', /\bdapi[a-f0-9]{32}(?:-\d)?\b/],
  ['Google OAuth token', /\bya29\.[0-9A-Za-z_-]{20,}/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}\b/],
  ['Heroku key', /\bHRKU-[A-Za-z0-9_-]{60}\b/],
  ['Sentry token', /\bsntry[su]_[A-Za-z0-9+/=_]{40,}/],
  ['Grafana token', /\bglsa_[A-Za-z0-9]{32}_[a-f0-9]{8}\b|\bglc_[A-Za-z0-9+/=]{32,}/],
  ['New Relic key', /\bNRAK-[A-Z0-9]{27}\b/],
  ['Atlassian token', /\bATATT3[A-Za-z0-9_=-]{150,}/],
  ['Discord bot token', /\b[MN][A-Za-z0-9]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/],
  ['Azure storage key', /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/],
];

const CREDENTIAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [...SECRET_PATTERNS, ...EXTRA_CREDENTIAL_PATTERNS]
  .filter(([label]) => label !== 'private key')
  .map(([label, re]) => [label, new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')] as const);

/** A private key block, BEGIN to END; a block cut off by a size limit is masked to the end of its base64. */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]{0,40})PRIVATE KEY-----(?:[A-Za-z0-9+/=\s:,-]{0,16384}?-----END \1PRIVATE KEY-----|[A-Za-z0-9+/=\s:,-]{0,16384})/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g;
/** The value of an Authorization header, in HTTP, curl or JSON form. */
const AUTH_HEADER = /\b(?:Proxy-)?Authorization["']?\s{0,4}[:=]\s{0,4}["']?(?:Bearer|Basic|Token|Bot|Digest|ApiKey)\s{1,4}([A-Za-z0-9._~+/=-]{8,4096})/gi;
const BEARER = /\bBearer\s{1,4}([A-Za-z0-9._~+/=-]{16,4096})/g;
/** `scheme://user:password@host`: the password. */
const URL_PASSWORD = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@?#"'<>]{1,256}:([^\s@/?#"'<>]{1,512})@/gi;
/** Query parameters that carry a credential, and signed-URL signatures. */
const URL_CREDENTIAL_PARAM = /[?&;](access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|secret|client_secret|password|passwd|pwd|auth|sig|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Goog-Signature|X-Goog-Credential)=([^&#\s"'<>]{1,4096})/gi;

/** A field or variable name that holds a credential. Word parts, so `token_count` and `max_tokens` do not count. */
const CREDENTIAL_WORD = '(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|secret[_-]?key|client[_-]?secret|credentials?|bearer|cookie|session[_-]?(?:id|key|token)|dsn|conn(?:ection)?[_-]?str(?:ing)?|auth(?:orization)?|pin|otp)';
const CREDENTIAL_NAME = new RegExp(`(?:^|[_.\\-\\s])${CREDENTIAL_WORD}(?:$|[_.\\-\\s])`, 'i');
const NUMERIC_NAME = /pass|pwd|pin|otp|secret/i;
/** `NAME=value`, `NAME: value`, `"name": "value"`; the value runs to whitespace, a quote or a separator. */
// The value never takes a backslash: inside JSON-in-a-string (`\"api_key\": \"…\"`) that would eat the escape of the
// closing quote and break the JSON around it.
const ASSIGNMENT = /(?<![A-Za-z0-9_])(\\?["']?)([A-Za-z_][A-Za-z0-9_.-]{0,63})\1[ \t]{0,4}(?::=|=>|:|=)[ \t]{0,4}(\\?["'`]?)([^\s"'`,;{}()[\]<>\\]{1,512})\3/g;
const NOT_A_VALUE = /^(?:true|false|null|none|nil|undefined|yes|no|on|off|required|optional|string|number|integer|boolean|object|array|bearer|basic|token|password|secret|redacted|masked|hidden|example|changeme|placeholder|your[_-].*|<.*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_]+%|\*+|x+|\.+|-+|•+)$/i;

/** camelCase → snake_case, so `apiKey` and `clientSecret` read as credential names. */
function words(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
}

/** Would a value assigned to a credential-named field be the credential itself? */
export function credentialValue(name: string, value: string): boolean {
  const n = words(name);
  if (!CREDENTIAL_NAME.test(n)) return false;
  const v = value.trim();
  if (v.length < 6 || v.length > 4096 || NOT_A_VALUE.test(v) || ALREADY_REDACTED.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return false; // a URL: its password and token parameters are found on their own
  if (/^\d+$/.test(v)) return NUMERIC_NAME.test(n);
  if (placeholderSpans(v).length) return false;
  // Two kinds of character (letters and digits, cases, or symbols), or long enough to be a passphrase.
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(v)).length;
  return classes >= 2 || v.length >= 16;
}

function push(spans: Span[], start: number, end: number, kind: string, cls: MaskClass, label: string): void {
  if (end > start) spans.push({ start, end, kind, cls, label });
}

/** A value another tool already redacted (`ghp_ab...9f3e`, `sk-***`, `[REDACTED]`) holds no secret any more. */
const ALREADY_REDACTED = /\.\.\.|…|\*{3}|\[?REDACTED|<redacted>/i;

function plain(v: string): boolean {
  return !NOT_A_VALUE.test(v) && !ALREADY_REDACTED.test(v) && placeholderSpans(v).length === 0;
}

/**
 * Credential spans in one string. `knownValues`: exact values to mask wherever they occur. `fieldName`: the JSON key
 * the string is the value of, so `{"password": "hunter22"}` is masked whole.
 */
export function credentialSpans(text: string, knownValues: readonly string[] = [], fieldName?: string): Span[] {
  const spans: Span[] = [];
  if (fieldName !== undefined && credentialValue(fieldName, text)) push(spans, 0, text.length, 'SECRET', 'credential', 'credential field');
  for (const value of knownValues) {
    for (let i = text.indexOf(value); i >= 0; i = text.indexOf(value, i + value.length)) push(spans, i, i + value.length, 'SECRET', 'credential', 'known value');
  }
  for (const m of text.matchAll(PEM_BLOCK)) push(spans, m.index!, m.index! + m[0].length, 'SECRET', 'credential', 'private key');
  for (const [label, re] of CREDENTIAL_PATTERNS) for (const m of text.matchAll(re)) push(spans, m.index!, m.index! + m[0].length, 'SECRET', 'credential', label);
  for (const m of text.matchAll(JWT)) push(spans, m.index!, m.index! + m[0].length, 'SECRET', 'credential', 'JWT');
  for (const re of [AUTH_HEADER, BEARER]) for (const m of text.matchAll(re)) {
    const v = m[1]!, at = m.index! + m[0].length - v.length;
    if (plain(v)) push(spans, at, at + v.length, 'SECRET', 'credential', 'authorization header');
  }
  for (const m of text.matchAll(URL_PASSWORD)) {
    const v = m[1]!, at = m.index! + m[0].length - 1 - v.length;
    if (plain(v)) push(spans, at, at + v.length, 'SECRET', 'credential', 'URL password');
  }
  for (const m of text.matchAll(URL_CREDENTIAL_PARAM)) {
    const name = m[1]!.toLowerCase(), v = m[2]!, at = m.index! + m[0].length - v.length;
    if (!plain(v)) continue;
    // `?key=name` is a lookup key, not a credential: generic names need a value that looks random.
    const signature = /sig|signature|credential|security-token/.test(name);
    const random = v.length >= 12 && /\d/.test(v) && /[A-Za-z]/.test(v);
    if (signature ? v.length >= 16 : name === 'key' || name === 'auth' ? random : v.length >= 8) push(spans, at, at + v.length, 'SECRET', 'credential', 'URL parameter');
  }
  for (const m of text.matchAll(ASSIGNMENT)) {
    const name = m[2]!, v = m[4]!;
    if (!credentialValue(name, v)) continue;
    const at = m.index! + m[0].length - v.length - m[3]!.length;
    push(spans, at, at + v.length, 'SECRET', 'credential', 'credential field');
  }
  return spans;
}

// --- personal data --------------------------------------------------------------------------------------------------

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
/** RFC 2606 / RFC 6761 names: example addresses and test domains are not anyone's address. */
const RESERVED_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost|local)$/i;
const PHONE_INTL = /(?<![\w+])(?:\+|00)[1-9](?:[ .\-()]{0,2}\d){6,16}(?!\d)/g;
const PHONE_US = /(?<![\w+])(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?[2-9]\d{2}[ .-]\d{4}(?!\d)/g;
const PHONE_RU = /(?<![\w+])8[ (-]{0,2}9\d{2}[ )-]{0,2}\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g;
const CARD = /(?<![\d-])\d(?:[ -]?\d){11,18}(?![\d-])/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.]*\d)/g;
const VERSION_BEFORE = /(?:\bv|\bversion[ :]{0,2}|\bver\.?[ ]?|\brelease[ ]?)$/i;
const IPV6_CANDIDATE = /(?<![0-9A-Fa-f:.])[0-9A-Fa-f:]{2,39}(?:\.\d{1,3}){0,3}(?![0-9A-Fa-f:])/g;
const SSN = /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g;
const SNILS = /(?<![\d-])\d{3}-\d{3}-\d{3}[ -]\d{2}(?![\d-])/g;
const INN12 = /(?<!\d)\d{12}(?!\d)/g;

const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Issuer prefixes (ISO/IEC 7812 IIN ranges of the networks in use) and their lengths. */
export function cardNetwork(d: string): boolean {
  const n = d.length, p2 = +d.slice(0, 2), p3 = +d.slice(0, 3), p4 = +d.slice(0, 4), p6 = +d.slice(0, 6);
  if (d[0] === '4') return n === 13 || n === 16 || n === 19; // Visa
  if ((p2 >= 51 && p2 <= 55) || (p6 >= 222100 && p6 <= 272099)) return n === 16; // Mastercard
  if (p2 === 34 || p2 === 37) return n === 15; // American Express
  if (p4 >= 2200 && p4 <= 2204) return n >= 16 && n <= 19; // Mir
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return n >= 16 && n <= 19; // Discover
  if (p4 >= 3528 && p4 <= 3589) return n >= 16 && n <= 19; // JCB
  if ((p3 >= 300 && p3 <= 305) || p2 === 36 || p2 === 38) return n >= 14 && n <= 19; // Diners Club
  if (p2 === 62) return n >= 16 && n <= 19; // UnionPay
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return n >= 12 && n <= 19; // Maestro
  return false;
}

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/ /g, '').toUpperCase();
  if (IBAN_LENGTH[s.slice(0, 2)] !== s.length) return false;
  let rem = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Addresses that identify no one outside the machine or network: loopback, private, link-local, documentation. */
export function publicIp(ip: string, includePrivate: boolean): boolean {
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number];
    if (a === 0 || a === 127 || a >= 224) return false;
    if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
    if (a === 169 && b === 254) return false;
    const priv = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    return includePrivate || !priv;
  }
  if (isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1' || /^fe[89ab]/.test(l) || /^2001:0?db8:/.test(l) || /^ff/.test(l)) return false;
    if (/^::ffff:\d/.test(l)) return publicIp(l.slice(7), includePrivate);
    return includePrivate || !/^f[cd]/.test(l);
  }
  return false;
}

export function snilsValid(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11) return false;
  const body = d.slice(0, 9), check = +d.slice(9);
  if (+body <= 1001998) return false; // checksums are defined from 001-001-999 on
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (body.charCodeAt(i) - 48) * (9 - i);
  const c = sum % 101;
  return (c === 100 ? 0 : c) === check;
}

export function inn12Valid(d: string): boolean {
  if (!/^\d{12}$/.test(d)) return false;
  const n = [...d].map(Number);
  const k = (w: number[]) => (w.reduce((s, x, i) => s + x * n[i]!, 0) % 11) % 10;
  return k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[10] && k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[11];
}

export interface PersonalOptions {
  kinds: readonly string[];
  phoneNational: ReadonlyArray<'us' | 'ru'>;
  /** Mask private and CGNAT addresses too (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7). */
  privateIps: boolean;
  /** Operator's terms (names, customer ids) and patterns, each with its kind. */
  terms: ReadonlyArray<{ kind: string; re: RegExp }>;
  /** Values never masked: exact values, or `@domain` for every address at that domain. Lower case. */
  keep: readonly string[];
}

function kept(value: string, keep: readonly string[]): boolean {
  const v = value.toLowerCase();
  return keep.some(k => k.startsWith('@') ? v.endsWith(k) : v === k);
}

export function personalSpans(text: string, o: PersonalOptions): Span[] {
  const spans: Span[] = [];
  const on = new Set(o.kinds);
  const add = (start: number, end: number, kind: string, label: string) => {
    if (!kept(text.slice(start, end), o.keep)) push(spans, start, end, kind, 'personal', label);
  };
  if (on.has('EMAIL')) for (const m of text.matchAll(EMAIL)) {
    if (!RESERVED_EMAIL_DOMAIN.test(m[0].slice(m[0].lastIndexOf('@') + 1))) add(m.index!, m.index! + m[0].length, 'EMAIL', 'e-mail address');
  }
  if (on.has('PHONE')) {
    const res: RegExp[] = [PHONE_INTL];
    if (o.phoneNational.includes('us')) res.push(PHONE_US);
    if (o.phoneNational.includes('ru')) res.push(PHONE_RU);
    for (const re of res) for (const m of text.matchAll(re)) {
      const digits = m[0].replace(/\D/g, '').replace(/^00/, '');
      // E.164: at most 15 digits; fewer than 8 is an extension, a code or a count.
      if (digits.length >= 8 && digits.length <= 15) add(m.index!, m.index! + m[0].length, 'PHONE', 'phone number');
    }
  }
  if (on.has('CARD')) for (const m of text.matchAll(CARD)) {
    const d = m[0].replace(/\D/g, '');
    if (cardNetwork(d) && luhn(d)) add(m.index!, m.index! + m[0].length, 'CARD', 'payment card');
  }
  if (on.has('IBAN')) for (const m of text.matchAll(IBAN)) if (ibanValid(m[0])) add(m.index!, m.index! + m[0].length, 'IBAN', 'IBAN');
  if (on.has('IP')) {
    // `v1.2.3.4` and `version 1.2.3.4` are versions, not addresses.
    for (const m of text.matchAll(IPV4)) if (publicIp(m[0], o.privateIps) && !VERSION_BEFORE.test(text.slice(Math.max(0, m.index! - 12), m.index!))) add(m.index!, m.index! + m[0].length, 'IP', 'IP address');
    for (const m of text.matchAll(IPV6_CANDIDATE)) if ((m[0].match(/:/g) ?? []).length >= 2 && publicIp(m[0], o.privateIps)) add(m.index!, m.index! + m[0].length, 'IP', 'IP address');
  }
  if (on.has('SSN')) for (const m of text.matchAll(SSN)) add(m.index!, m.index! + m[0].length, 'SSN', 'US SSN');
  if (on.has('SNILS')) for (const m of text.matchAll(SNILS)) if (snilsValid(m[0])) add(m.index!, m.index! + m[0].length, 'SNILS', 'SNILS');
  if (on.has('INN')) for (const m of text.matchAll(INN12)) if (inn12Valid(m[0])) add(m.index!, m.index! + m[0].length, 'INN', 'personal INN');
  for (const t of o.terms) for (const m of text.matchAll(t.re)) if (m[0]) add(m.index!, m.index! + m[0].length, t.kind, 'operator list');
  return spans;
}

/**
 * Non-overlapping spans: a credential wins over personal data where they overlap (the password in
 * `smtp://ann%40example.org:pw@host` is masked as a credential), then the earlier and longer span. Spans that touch an
 * existing placeholder are dropped, so masking twice changes nothing.
 */
export function resolveSpans(text: string, spans: Span[]): Span[] {
  const blocked = placeholderSpans(text);
  const sorted = spans
    .filter(s => !blocked.some(b => s.start < b.end && b.start < s.end))
    .sort((a, b) => (a.cls === b.cls ? 0 : a.cls === 'credential' ? -1 : 1) || a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out: Span[] = [];
  for (const s of sorted) if (!out.some(o => s.start < o.end && o.start < s.end)) out.push(s);
  return out.sort((a, b) => a.start - b.start);
}
