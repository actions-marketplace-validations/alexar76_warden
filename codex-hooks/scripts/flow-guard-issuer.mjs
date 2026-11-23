// GENERATED from src/flow-guard-issuer.ts by scripts/sync-flow-guard.mjs. Do not edit; run npm run build.
import { SECRET_PATTERNS } from './flow-guard-fingerprints.mjs';
/**
 * A token sent back to the service that issued it.
 *
 * The flow guard denies every call that carries a recognised secret format, whatever the destination. That
 * also refused `curl -H "Authorization: Bearer ghp_…" https://api.github.com/user`, the ordinary use of a
 * GitHub token, so people turned the guard off to get their work done. This module recognises the one
 * shape in which a token goes only where it came from: a single, simple HTTP command whose every
 * destination is an HTTPS host of the token's issuer and whose every copy of the token sits in an
 * authorisation header. The guard then asks instead of denying. Anything else (a pipe, an expansion, a
 * file, a body, a second host, a proxy or resolver override, a look-alike host) is not recognised and the
 * call stays denied.
 *
 * Only formats whose prefix names one issuer are bound. `sk-…` keys (OpenAI, Anthropic, DeepSeek,
 * OpenRouter and others) and Google API keys (many hosts) are not.
 */
export const ISSUER_HOSTS = {
    'GitHub token': ['api.github.com', 'uploads.github.com'],
    'GitLab token': ['gitlab.com'],
    'Slack token': ['slack.com'],
    'npm token': ['registry.npmjs.org'],
};
/** Shell words of a simple command: no expansion, substitution, pipe, list, redirection or escape. */
function words(command) {
    if (/[\n\r\\`$]/.test(command))
        return undefined; // escapes and expansions, even in quotes
    const out = [];
    let cur = '', quote, started = false;
    for (const ch of command) {
        if (quote) {
            if (ch === quote)
                quote = undefined;
            else
                cur += ch;
        }
        else if (/[;&|<>(){}*?[\]!#~]/.test(ch))
            return undefined; // lists, pipes, redirections, globs
        else if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
        }
        else if (ch === ' ' || ch === '\t') {
            if (started) {
                out.push(cur);
                cur = '';
                started = false;
            }
        }
        else {
            cur += ch;
            started = true;
        }
    }
    if (quote)
        return undefined;
    if (started)
        out.push(cur);
    return out;
}
const AUTH_HEADER = /^(?:authorization:\s*(?:bearer|token)\s+|private-token:\s*)(\S+)$/i;
/** An HTTPS URL on one of `hosts`: no credentials in it, the default port. */
function issuerUrl(value, hosts) {
    if (!/^https:\/\//i.test(value))
        return false;
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return false;
    }
    return url.protocol === 'https:' && !url.username && !url.password && (url.port === '' || url.port === '443') &&
        hosts.includes(url.hostname.toLowerCase());
}
// curl options that take a value and change nothing about where the request goes or what file it reads.
const CURL_VALUE = new Set(['-X', '--request', '-H', '--header', '-A', '--user-agent', '-o', '--output', '-d', '--data',
    '--data-raw', '--json', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--url']);
const CURL_FLAG = /^-(?:[sSfiLvq]+|-silent|-show-error|-fail|-fail-with-body|-include|-location|-compressed|-verbose)$/;
function curl(args) {
    const urls = [], slots = [];
    for (let i = 0; i < args.length; i++) {
        let a = args[i], value;
        const eq = a.startsWith('--') ? a.indexOf('=') : -1;
        if (eq > 0) {
            value = a.slice(eq + 1);
            a = a.slice(0, eq);
        }
        else if (/^-[HXAodmw]./.test(a)) {
            value = a.slice(2);
            a = a.slice(0, 2);
        }
        if (CURL_VALUE.has(a)) {
            value ??= args[++i];
            if (value === undefined)
                return undefined;
            if ((a === '-d' || a.startsWith('--data') || a === '--json') && value.startsWith('@'))
                return undefined;
            if (a === '-H' || a === '--header')
                slots.push(value);
            else if (a === '--url')
                urls.push(value);
            continue;
        }
        if (value !== undefined || a.startsWith('-')) {
            if (value === undefined && CURL_FLAG.test(a))
                continue;
            return undefined;
        }
        urls.push(a);
    }
    return { urls, slots };
}
function wget(args) {
    const urls = [], slots = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-q' || a === '--quiet' || a === '-S' || a === '--server-response')
            continue;
        if (a === '-O' || a === '--output-document') {
            if (args[++i] === undefined)
                return undefined;
            continue;
        }
        if (a.startsWith('-O') && a.length > 2)
            continue;
        if (a.startsWith('--output-document='))
            continue;
        if (a.startsWith('--header=')) {
            slots.push(a.slice('--header='.length));
            continue;
        }
        if (a === '--header') {
            const v = args[++i];
            if (v === undefined)
                return undefined;
            slots.push(v);
            continue;
        }
        if (a.startsWith('-'))
            return undefined;
        urls.push(a);
    }
    return { urls, slots };
}
function httpie(args) {
    const urls = [], slots = [];
    let i = 0;
    if (/^(?:GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(args[0] ?? ''))
        i = 1;
    for (; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('-'))
            return undefined;
        if (/^https:\/\//i.test(a)) {
            urls.push(a);
            continue;
        }
        if (a.includes('@'))
            return undefined; // file and raw-file items read files
        const header = /^([A-Za-z0-9-]+):(?!=)(.*)$/.exec(a);
        if (header) {
            slots.push(`${header[1]}: ${header[2]}`);
            continue;
        }
        if (/^[A-Za-z0-9_.[\]-]+:?=/.test(a))
            continue; // data fields: checked like any argument
        return undefined;
    }
    return urls.length ? { urls, slots } : undefined;
}
function gh(args, env) {
    if (args[0] !== 'api' || !args[1] || args[1].startsWith('-'))
        return undefined;
    for (let i = 2; i < args.length; i++) {
        const a = args[i];
        if (a === '-X' || a === '--method') {
            if (args[++i] === undefined)
                return undefined;
            continue;
        }
        if ((a === '-f' || a === '--raw-field' || a === '-F' || a === '--field') && args[i + 1] !== undefined && !args[i + 1].includes('@')) {
            i++;
            continue;
        }
        return undefined; // --hostname, --input and the rest
    }
    const slots = Object.entries(env).filter(([k]) => k === 'GH_TOKEN' || k === 'GITHUB_TOKEN').map(([, v]) => `Authorization: token ${v}`);
    return { urls: ['https://api.github.com/'], slots };
}
/**
 * The binding when `toolInput.command` sends recognised tokens of one issuer only to that issuer, each in an
 * authorisation header; undefined for every other call.
 */
export function issuerBinding(toolInput) {
    const command = toolInput.command;
    if (typeof command !== 'string' || command.length > 4000)
        return undefined;
    const all = words(command);
    if (!all?.length)
        return undefined;
    const env = {};
    let at = 0;
    for (; at < all.length; at++) {
        const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(all[at]);
        if (!m)
            break;
        env[m[1]] = m[2];
    }
    const program = all[at];
    const args = all.slice(at + 1);
    const parsed = program === 'curl' ? curl(args) : program === 'wget' ? wget(args)
        : program === 'http' || program === 'https' ? httpie(args) : program === 'gh' ? gh(args, env) : undefined;
    if (!parsed || !parsed.urls.length)
        return undefined;
    if (program !== 'gh' && Object.keys(env).length)
        return undefined;
    // Every recognised secret in the command, by format.
    const found = new Map();
    for (const [name, re] of SECRET_PATTERNS) {
        for (const m of command.matchAll(new RegExp(re.source, 'g')))
            found.set(name, [...(found.get(name) ?? []), m[0]]);
    }
    if (found.size !== 1)
        return undefined;
    const [secret, values] = [...found][0];
    const hosts = ISSUER_HOSTS[secret];
    if (!hosts || !parsed.urls.every(u => issuerUrl(u, hosts)))
        return undefined;
    // Each copy of the token must be a whole authorisation header value, and nothing else may hold one.
    const inSlots = parsed.slots.map(s => AUTH_HEADER.exec(s.trim())?.[1]).filter((v) => !!v);
    for (const v of values) {
        if (!inSlots.includes(v))
            return undefined;
    }
    const occurrences = values.length;
    const slotCopies = inSlots.filter(v => values.includes(v)).length;
    if (slotCopies !== occurrences)
        return undefined;
    return { secret, hosts: [...hosts] };
}
/** The input with every copy of the bound token replaced, for checking what else the call carries. */
export function withoutBoundToken(toolInput, binding) {
    const command = String(toolInput.command);
    const re = SECRET_PATTERNS.find(([name]) => name === binding.secret)[1];
    return { ...toolInput, command: command.replace(new RegExp(re.source, 'g'), 'WARDEN_ISSUER_TOKEN') };
}
