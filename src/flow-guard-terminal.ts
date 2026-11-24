/** The integrated Open Terminal's tool names, response envelope and routing identifiers. */
import { createHash } from 'node:crypto';
import { INJECTION_HINTS } from './flow-guard-instructions.js';

const PROCESS_ID = /^\d{8}-\d{6}-[a-f0-9]{6}$/;
const PROCESS_TOOLS = new Set(['run_command', 'get_process_status']);
const PATH_TOOLS = new Set(['read_file', 'write_file', 'replace_file_content', 'display_file']);
const PROCESS_FIELDS = new Set(['id', 'command', 'status', 'exit_code', 'output', 'truncated', 'next_offset', 'log_path']);

export function terminalOperation(name: string): string | undefined {
  return /^mcp__owui__terminal:[a-f0-9]{24}:([a-z_]+)$/.exec(name)?.[1];
}

function terminalHome(user: string): string | undefined {
  if (!user) return undefined;
  const cleaned = user.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = cleaned.length >= 4 ? cleaned.slice(0, 8) : createHash('sha256').update(user).digest('hex').slice(0, 8);
  return `/home/${/^\d/.test(name) ? 'u' : ''}${name}`;
}

/** The default home is a shorthand for the same destination on a structured file write. */
export function terminalFileDestination(operation: string | undefined, path: unknown, user: string) {
  if (operation !== 'write_file' && operation !== 'replace_file_content') return undefined;
  const home = terminalHome(user);
  if (!home || typeof path !== 'string' || !path.startsWith(home + '/') || !isLiteralPath(path)) return undefined;
  const relative = path.slice(home.length + 1);
  return { absolute: path, relative };
}

function isLiteralPath(path: string): boolean {
  return path.length <= 4096 && path.replace(/^(?:~?\/)/, '').split('/').every(part =>
    part !== '.' && part !== '..' && /^[\p{L}\p{M}\p{N}._-]+$/u.test(part));
}

export function terminalPathDigest(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

/** Keep exact spelling for path tokens without saving a second copy of the user's prompt. */
export function terminalPromptPaths(text: string): string[] {
  const paths = new Set<string>();
  const looksLikePath = (token: string) => token.includes('/') || (token.includes('.') && !token.endsWith('.'));
  for (const match of text.matchAll(/[^\s"'«»()\x60]+/gu)) {
    const [token] = match;
    const next = text[match.index + token.length];
    const previous = text[match.index - 1];
    const quoted = previous === '«' ? next === '»' : !!previous && /["'\x60]/.test(previous) && previous === next;
    if ((looksLikePath(token) || quoted) && isLiteralPath(token)) paths.add(terminalPathDigest(token));
    if (/[.,]$/.test(token) && (!next || /\s/u.test(next))) {
      const path = token.slice(0, -1);
      if (looksLikePath(path) && isLiteralPath(path)) paths.add(terminalPathDigest(path));
    }
  }
  return [...paths];
}

function withoutHome(value: unknown, home: string | undefined): unknown {
  if (typeof value !== 'string' || !home) return value;
  if (value === home) return '';
  return value.startsWith(home + '/') ? value.slice(home.length) : value;
}

/** Omit only routing identifiers in the relevant tool fields from the private/PII comparison. */
export function terminalDataArguments(operation: string | undefined, args: Record<string, unknown>, user: string): Record<string, unknown> {
  if ((operation === 'get_process_status' || operation === 'kill_process') &&
      typeof args.process_id === 'string' && PROCESS_ID.test(args.process_id)) {
    const { process_id: _id, ...other } = args;
    return other;
  }
  const field = operation === 'list_files' ? 'directory' : operation && PATH_TOOLS.has(operation) ? 'path' : undefined;
  if (!field) return args;
  const value = withoutHome(args[field], terminalHome(user));
  return value === args[field] ? args : { ...args, [field]: value };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function processResult(operation: string, args: Record<string, unknown>, value: unknown) {
  const r = record(value);
  if (!r || typeof r.id !== 'string' || !PROCESS_ID.test(r.id) || typeof r.command !== 'string' ||
      (operation === 'run_command' ? args.command !== r.command : args.process_id !== r.id)) return undefined;
  return r;
}

/** Keep document text and command output in the fingerprint scan. Strip only validated API fields. */
export function terminalDataResult(operation: string, args: Record<string, unknown>, value: unknown, user: string): unknown {
  if (PROCESS_TOOLS.has(operation)) {
    const r = processResult(operation, args, value);
    if (!r) return value;
    const { id, log_path, ...other } = r;
    return typeof log_path === 'string' && log_path.endsWith(`/processes/${id}.jsonl`) &&
      /^[\w./-]+$/.test(log_path) ? other : { ...other, log_path };
  }
  const r = record(value);
  const field = operation === 'list_files' ? 'dir' : PATH_TOOLS.has(operation) ? 'path' : undefined;
  if (!r || !field) return value;
  const adjusted = withoutHome(r[field], terminalHome(user));
  return adjusted === r[field] ? value : { ...r, [field]: adjusted };
}

/** This only classifies the result. It grants no permission to run the command. */
export function terminalProcessTaints(
  operation: string, args: Record<string, unknown>, value: unknown, user: string,
): boolean | undefined {
  if (!PROCESS_TOOLS.has(operation)) return undefined;
  if (!user) return true;
  const r = processResult(operation, args, value);
  if (!r || Object.keys(r).some(key => !PROCESS_FIELDS.has(key)) ||
      typeof r.status !== 'string' || !['running', 'done', 'killed'].includes(r.status) || r.truncated !== false ||
      !(r.exit_code === null || Number.isSafeInteger(r.exit_code)) || !Number.isSafeInteger(r.next_offset) ||
      typeof r.log_path !== 'string' || !/^[\w./-]{1,512}$/.test(r.log_path) ||
      !r.log_path.endsWith(`/processes/${r.id}.jsonl`) || !Array.isArray(r.output)) return true;

  const command = (r.command as string).trim();
  const pwd = command === 'pwd';
  const uname = command === 'uname' || command === 'uname -s';
  // A literal echo returns text the caller already supplied. Shell expansion and arbitrary commands stay outside text.
  const echo = /^(?:sleep [0-9]{1,2} *; *)?echo ([\p{L}\p{M}0-9][\p{L}\p{M}0-9 _.-]{0,79})$/u.exec(command);
  // An acknowledgement of a command supplied by the caller, or an empty poll of a diagnostic, brings no output.
  if (r.output.length === 0) return operation !== 'run_command' && !pwd && !uname && !echo;
  if (r.output.length > 16 || r.exit_code !== 0 || r.status !== 'done') return true;
  let output = '';
  for (const item of r.output) {
    const entry = record(item);
    if (!entry || Object.keys(entry).length !== 2 || (entry.type !== 'stdout' && entry.type !== 'output') ||
        typeof entry.data !== 'string' || entry.data.length + output.length > 512) return true;
    output += entry.data;
  }
  if (INJECTION_HINTS.test(output)) return true;
  const line = output.replace(/\r?\n$/, '');
  if (pwd) return line !== '/home/user' && line !== terminalHome(user);
  if (uname) return !['Linux', 'Darwin', 'FreeBSD'].includes(line);
  return !echo || line !== echo[1];
}
