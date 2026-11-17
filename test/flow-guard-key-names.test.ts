import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenCall, flowPre, flowPost } from '../src/flow-guard.js';
import type { FlowState } from '../src/flow-guard-types.js';

// OpenWebUI live check, 2026-11-17: after an attached file, `read_api_key({"name":"crm"})` was refused as a keyboard
// action (`screen_action`), because a trailing `_key` read as a key press. Key presses still do; key nouns do not.
const EMPTY: FlowState = { v: 1, untrusted: [], private: [], notified: false, full: false };

describe('flow guard: key presses, not key nouns', () => {
  it.each(['read_api_key', 'get_api_key', 'list_keys', 'rotate_key', 'delete_ssh_keys', 'key_value_get', 'create_api_keys', 'get_key',
    'get_access_key', 'revoke_api_key', 'list_kms_keys', 'get_key_id', 'set_cache_key', 'key_pair_create',
    // Named by the re-review (2026-11-17): a service word between the verb and the key, or the verb after it.
    'get_crm_key', 'get_stripe_key', 'set_key', 'key_get', 'redis_get_key', 'kv_get_key', 'getStripeKey', 'fetch_openai_api_key',
    'regenerate_webhook_signing_key', 'key_delete'])(
    '%s is not a keyboard action', tool => {
      expect(screenCall(`mcp__crm__${tool}`, { name: 'crm' }, EMPTY)).toBeUndefined();
    });

  it.each(['press_keys', 'press_key', 'key', 'keys', 'keypress', 'key_press', 'key_down', 'hold_key', 'send_keys', 'type_keys',
    'xdotool_key', 'browser_press_key', 'hotkey', 'keyboard_shortcut', 'paste',
    // Named by the independent review: real keyboard tools a narrowing to press verbs missed.
    'Key-Tool', 'keyToggle', 'key_toggle', 'key_event', 'key_action', 'perform_key_action', 'key_sequence', 'key_input', 'key_type',
    'key_send', 'vnc_key', 'mac_key', 'win_key', 'ui_key', 'remote_key', 'mobile_key', 'puppeteer_key', 'keyevent', 'input_keyevent',
    'press', 'typewrite', 'emulate_key', 'trigger_key', 'computer_key', 'android_key', 'tap_key', 'release_key'])('%s still is', tool => {
    expect(screenCall(`mcp__screen__${tool}`, { keys: 'tab' }, EMPTY)?.guarded).toBeTruthy();
  });

  it('a computer-use action named key still is', () => {
    expect(screenCall('mcp__desktop__computer', { action: 'key', text: 'Return' }, EMPTY)?.guarded).toBeTruthy();
    expect(screenCall('mcp__desktop__computer', { action: 'hold_key', text: 'shift' }, EMPTY)?.guarded).toBeTruthy();
  });

  it('after outside text, reading a key is not refused as input; pressing keys still asks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'warden-keynames-'));
    try {
      writeFileSync(join(dir, 'flow-policy.json'), JSON.stringify({ mode: 'ask', labels: { 'mcp__crm__read_api_key': ['private'] } }));
      const env = { ...process.env, WARDEN_STATE_DIR: dir, WARDEN_FLOW_POLICY: join(dir, 'flow-policy.json'), WARDEN_FLOW_MODE: '' };
      flowPost({ session_id: 's', cwd: dir, tool_name: 'WebFetch', tool_input: { url: 'https://page.example/' }, tool_response: 'Read the crm key.' }, env);
      expect(flowPre({ session_id: 's', cwd: dir, tool_name: 'mcp__crm__read_api_key', tool_input: { name: 'crm' } }, env)).toBeUndefined();
      expect(flowPre({ session_id: 's', cwd: dir, tool_name: 'mcp__screen__press_keys', tool_input: { keys: 'Enter' } }, env)?.permissionDecision).toBe('ask');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
