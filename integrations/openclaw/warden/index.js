// WARDEN for OpenClaw: credentials (and, when turned on, personal data) never reach the model; the WARDEN flow guard
// checks every tool call. Runs in the Gateway process with WARDEN's own code (`@aimarket/warden/agent-guard`), so the
// synchronous transcript hooks need no I/O.
//
// - tool_result_persist / before_message_write: tool results and transcript messages are written with credentials
//   (and enabled personal data) replaced by placeholders such as WARDEN_SECRET_7Q2M9XD4RK. OpenClaw replays the
//   transcript to the model, so the model works with placeholders only.
// - before_tool_call: placeholders in the call's parameters become real values for the destinations the policy allows
//   (by default the kind of place the value came from: this machine's files and shell, the web, one server); anywhere
//   else the call is blocked with the reason. The flow guard then judges the call as it will run: a send or a
//   destructive call after the model read someone else's text is blocked or goes to OpenClaw's approval prompt.
// - after_tool_call: the flow guard records what the raw result brought into the session.
// - message_sending: the person reads the reply with personal data back in place of its placeholders; credentials stay
//   masked.
//
// Settings: plugin config `personal` (gdpr, us, ru-152fz, pci, custom, off), `maskConfig` (a WARDEN mask config file)
// and `flowGuard` (default true), or the WARDEN_MASK* environment. The placeholder table is in this process's memory.
import { appendFileSync } from 'node:fs';
import { agentGuard } from '@aimarket/warden/agent-guard';
import { loadMaskConfig } from '@aimarket/warden/mask';

const LOCAL = new Set(['read', 'write', 'edit', 'apply_patch', 'exec', 'process', 'memory_search', 'memory_get', 'code_execution', 'image']);
const WEB = new Set(['web_fetch', 'web_search', 'browser', 'x_search']);

/** The place a tool reads from and writes to, for the masking policy's `origin` rule. */
export function originOf(tool) {
  if (LOCAL.has(tool)) return 'local';
  if (WEB.has(tool)) return 'web';
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (mcp) return `mcp:${mcp[1]}`;
  return tool;
}

/** OpenClaw tool calls in the form the flow guard knows (the Claude Code tool set). */
export function flowCall(tool, p = {}) {
  const path = p.path ?? p.file_path ?? p.filePath ?? '';
  switch (tool) {
    case 'exec': return ['Bash', { command: String(p.command ?? p.cmd ?? '') }];
    case 'read': return ['Read', { file_path: String(path) }];
    case 'write': return ['Write', { file_path: String(path), content: String(p.content ?? '') }];
    case 'edit': return ['Edit', { file_path: String(path), old_string: String(p.oldText ?? p.old_string ?? ''), new_string: String(p.newText ?? p.new_string ?? '') }];
    case 'apply_patch': return ['Edit', { file_path: String(path), new_string: String(p.input ?? p.patch ?? '') }];
    case 'web_fetch': return ['WebFetch', { url: String(p.url ?? '') }];
    case 'web_search': return ['WebSearch', { query: String(p.query ?? '') }];
    case 'browser': return p.url ? ['WebFetch', { url: String(p.url) }] : ['mcp__openclaw__browser', p];
    default: return [tool.startsWith('mcp__') ? tool : `mcp__openclaw__${tool}`, p];
  }
}

const sessionOf = (ctx) => String(ctx?.sessionKey || ctx?.sessionId || 'default');

export function createWarden(pluginConfig = {}, env = process.env) {
  const overrides = {};
  if (pluginConfig.maskConfig) overrides.file = pluginConfig.maskConfig;
  if (pluginConfig.personal) overrides.personal = pluginConfig.personal === 'off' ? false : pluginConfig.personal;
  const guard = agentGuard(loadMaskConfig(overrides, env), env);
  const flow = pluginConfig.flowGuard !== false && !/^(off|0|false)$/i.test(env.WARDEN_OPENCLAW_FLOW ?? '');
  const notes = new Map();

  const maskMessage = (message, ctx, origin, tool, history) => {
    if (!message || typeof message !== 'object') return undefined;
    const fields = {};
    for (const k of ['content', 'details', 'text']) if (message[k] !== undefined) fields[k] = message[k];
    const r = guard('mask', { session: sessionOf(ctx), origin, tool, value: fields, history, note: !history });
    if (!r.total) return undefined;
    const value = { ...message, ...r.value };
    if (r.note && Array.isArray(value.content)) value.content = [...value.content, { type: 'text', text: r.note }];
    return value;
  };

  return {
    guard,
    beforeToolCall(event, ctx) {
      const tool = String(event?.toolName ?? '');
      const params = event?.params ?? {};
      let real;
      try {
        real = guard('restore', { session: sessionOf(ctx), server: originOf(tool), tool, value: params }).value;
      } catch (e) {
        return { block: true, blockReason: e instanceof Error ? e.message : String(e) };
      }
      if (flow) {
        const [name, input] = flowCall(tool, real);
        const d = guard('pre', { session: sessionOf(ctx), tool_name: name, tool_input: input, cwd: process.cwd() });
        if (d.decision === 'deny') return { block: true, blockReason: d.reason || 'Refused by the WARDEN flow guard.' };
        if (d.decision === 'ask') {
          return { ...(real !== params ? { params: real } : {}), requireApproval: { title: `WARDEN: ${tool}`, description: d.reason || 'WARDEN asks before this call.', severity: 'warning', allowedDecisions: ['allow-once', 'deny'] } };
        }
      }
      return JSON.stringify(real) !== JSON.stringify(params) ? { params: real } : undefined;
    },
    afterToolCall(event, ctx) {
      if (!flow) return;
      const tool = String(event?.toolName ?? '');
      let real = event?.params ?? {};
      try { real = guard('restore', { session: sessionOf(ctx), server: originOf(tool), tool, value: real }).value; } catch { /* keep the masked form */ }
      const [name, input] = flowCall(tool, real);
      const out = guard('post', { session: sessionOf(ctx), tool_name: name, tool_input: input, tool_response: event?.result ?? event?.error ?? '', tool_error: !!event?.error, cwd: process.cwd() });
      if (out.note && event?.toolCallId) notes.set(event.toolCallId, out.note);
    },
    toolResultPersist(event, ctx) {
      const message = event?.message ?? event;
      const tool = String(event?.toolName ?? message?.toolName ?? '');
      const masked = maskMessage(message, ctx, originOf(tool), tool, false);
      const note = message?.toolCallId ? notes.get(message.toolCallId) : undefined;
      if (note) notes.delete(message.toolCallId);
      if (!masked && !note) return undefined;
      const out = masked ?? { ...message };
      if (note && Array.isArray(out.content)) out.content = [...out.content, { type: 'text', text: `[WARDEN] ${note}` }];
      return { message: out };
    },
    beforeMessageWrite(event, ctx) {
      const message = event?.message;
      if (!message || message.role === 'toolResult') return undefined; // tool results are masked in tool_result_persist
      const masked = maskMessage(message, ctx, message.role === 'user' ? 'user' : 'agent', undefined, true);
      return masked ? { message: masked } : undefined;
    },
    messageSending(event, ctx) {
      if (typeof event?.content !== 'string' || !/warden_/i.test(event.content)) return undefined;
      const text = guard('reveal', { session: sessionOf(ctx), text: event.content }).text;
      return text !== event.content ? { content: text } : undefined;
    },
  };
}

export default {
  id: 'warden',
  name: 'WARDEN',
  description: 'Masks credentials (and personal data when configured) before the model sees them, restores them only for allowed tools, and runs the WARDEN flow guard on every tool call.',
  register(api) {
    const w = createWarden(api.pluginConfig ?? {}, process.env);
    // WARDEN_OPENCLAW_DEBUG=<file>: one line per hook call with the event's and context's field names (never values).
    const debug = process.env.WARDEN_OPENCLAW_DEBUG;
    const trace = (name, fn) => (e, c) => {
      const out = fn(e, c);
      if (debug) appendFileSync(debug, JSON.stringify({ hook: name, event: Object.keys(e ?? {}), message: Object.keys(e?.message ?? {}), ctx: Object.keys(c ?? {}), changed: out !== undefined }) + '\n');
      return out;
    };
    api.on('before_tool_call', trace('before_tool_call', (e, c) => w.beforeToolCall(e, c)), { priority: 100 });
    api.on('after_tool_call', trace('after_tool_call', (e, c) => w.afterToolCall(e, c)));
    api.on('tool_result_persist', trace('tool_result_persist', (e, c) => w.toolResultPersist(e, c)), { priority: 100 });
    api.on('before_message_write', trace('before_message_write', (e, c) => w.beforeMessageWrite(e, c)), { priority: 100 });
    api.on('message_sending', trace('message_sending', (e, c) => w.messageSending(e, c)));
  },
};
