/**
 * `warden-mcp agent-guard`: WARDEN for agents that run their tools in-process (Hermes, OpenClaw, any agent with a
 * plugin or hook API), as one long-lived child process the agent's plugin talks to over stdin/stdout.
 *
 * One JSON object per line in each direction, `{"id", "method", "params"}` → `{"id", "result"}` or `{"id", "error"}`:
 *
 * - `mask`    {session, origin, tool?, value, history?}  → {value, total, counts, note?}: placeholders for credentials
 *             (and personal data, when on) in any JSON value, before the model reads it.
 * - `restore` {session, server, tool?, value}            → {value, restored} or error -32001 with the refusal: real
 *             values back in a tool call's arguments, for destinations the policy allows.
 * - `reveal`  {session, text}                            → {text}: the answer for the person (personal data back).
 * - `pre`     {session, tool_name, tool_input, cwd?}     → {decision: allow|ask|deny, reason?}: the flow guard, the
 *             same checks as the Claude Code plugin, on Claude-style tool names (`Bash`, `Read`, `WebFetch`,
 *             `mcp__server__tool`); the plugin maps its agent's names.
 * - `post`    {session, tool_name, tool_input, tool_response, tool_error?} → {note?}: records what a result brought into
 *             the session (outside text, private data) before the model reads it.
 * - `config`  {}                                          → what is on, for the plugin's start-up line.
 *
 * The placeholder table lives in this process only. When the agent stops, the child's stdin closes and it exits, and
 * the table is gone, as the EDPB's pseudonymisation guidance asks of the additional information.
 */
import { createInterface } from 'node:readline';
import { flowPost, flowPre } from './flow-guard.js';
import { Masker, MaskRefusal, USER_ORIGIN, loadMaskConfig, type MaskConfig, type MaskOverrides } from './mask.js';

interface Request { id?: unknown; method?: unknown; params?: unknown }

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function str(v: unknown, what: string, required = true): string {
  if (typeof v === 'string' && (v || !required)) return v;
  if (!required && v === undefined) return '';
  throw new Error(`${what} must be a string`);
}

/** Answers one request. Exported for tests; `runAgentGuard` wraps it in the stdio loop. */
export function agentGuard(config: MaskConfig, env: NodeJS.ProcessEnv = process.env) {
  const masker = new Masker(config, env);
  // Agents name their sessions; WARDEN keeps each agent's apart from Claude Code's own flow-guard state.
  const flowSession = (s: string) => `agent:${s}`;
  return (method: string, params: Record<string, unknown>): unknown => {
    switch (method) {
      case 'mask': {
        const session = masker.session(str(params.session, 'session'));
        const origin = params.origin === 'user' ? USER_ORIGIN : str(params.origin, 'origin');
        const r = session.mask(params.value, { server: origin, tool: typeof params.tool === 'string' ? params.tool : undefined }, { keepOrigins: params.history === true });
        return { value: r.value, total: r.total, counts: r.counts, ...(params.note === false ? {} : { note: session.note(r) }) };
      }
      case 'restore': {
        const session = masker.session(str(params.session, 'session'));
        const r = session.restore(params.value, { server: str(params.server, 'server'), tool: typeof params.tool === 'string' ? params.tool : undefined });
        return { value: r.value, restored: r.restored, kinds: r.kinds };
      }
      case 'reveal': return { text: masker.session(str(params.session, 'session')).reveal(str(params.text, 'text', false)) };
      case 'pre': {
        const d = flowPre({ session_id: flowSession(str(params.session, 'session')), tool_name: str(params.tool_name, 'tool_name'), tool_input: obj(params.tool_input), cwd: typeof params.cwd === 'string' ? params.cwd : process.cwd() }, env);
        return d ? { decision: d.permissionDecision, reason: d.permissionDecisionReason } : { decision: 'allow' };
      }
      case 'post': {
        const out = flowPost({ session_id: flowSession(str(params.session, 'session')), tool_name: str(params.tool_name, 'tool_name'), tool_input: obj(params.tool_input), tool_response: params.tool_response, ...(params.tool_error ? { tool_error: true } : {}), cwd: typeof params.cwd === 'string' ? params.cwd : process.cwd() }, env);
        return out?.additionalContext ? { note: out.additionalContext } : {};
      }
      case 'config': return {
        credentials: { enabled: config.credentials.enabled, restore: config.credentials.restore },
        personal: { enabled: config.personal.enabled, profile: config.personal.profile, kinds: config.personal.kinds, restore: config.personal.restore },
        display: config.display,
      };
      case 'ping': return {};
    }
    throw Object.assign(new Error(`unknown method ${method}`), { code: -32601 });
  };
}

export async function runAgentGuard(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const o: MaskOverrides = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!, value = argv[i + 1];
    if (flag === '--help' || flag === '-h') {
      process.stdout.write('Usage: warden-mcp agent-guard [--mask FILE] [--mask-credentials on|off] [--mask-personal PROFILE|off]\n' +
        'Reads one JSON request per line on stdin (mask, restore, reveal, pre, post, config) and answers on stdout.\n');
      return 0;
    }
    if (!['--mask', '--mask-credentials', '--mask-personal'].includes(flag) || value === undefined) throw new Error(`Unknown flag or missing value: ${flag}`);
    if (flag === '--mask') o.file = value;
    if (flag === '--mask-credentials') { if (value !== 'on' && value !== 'off') throw new Error('--mask-credentials must be on or off'); o.credentials = value === 'on'; }
    if (flag === '--mask-personal') o.personal = value === 'off' ? false : value;
    i++;
  }
  const handle = agentGuard(loadMaskConfig(o, env), env);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: Request;
    try { req = JSON.parse(line) as Request; } catch { process.stdout.write(JSON.stringify({ id: null, error: { code: -32700, message: 'not JSON' } }) + '\n'); continue; }
    const id = req.id ?? null;
    try {
      const result = handle(str(req.method, 'method'), obj(req.params));
      process.stdout.write(JSON.stringify({ id, result }) + '\n');
    } catch (e) {
      const refusal = e instanceof MaskRefusal;
      process.stdout.write(JSON.stringify({ id, error: { code: refusal ? -32001 : (e as { code?: number }).code ?? -32602, message: e instanceof Error ? e.message : String(e) } }) + '\n');
    }
  }
  return 0;
}
