import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialSpans, personalSpans, resolveSpans, luhn, ibanValid, snilsValid, inn12Valid, publicIp, cardNetwork, credentialValue,
  placeholderSpans, PROFILES,
} from '../src/mask-detect.js';
import { Masker, MaskRefusal, parseMaskConfig, maskConfigFromEnv, credentialEnvValues, USER_ORIGIN } from '../src/mask.js';

// Test credentials are assembled at run time: no literal in this file looks like a live key to a secret scanner.
const GH = 'ghp_' + 'x1Y2'.repeat(9);
const AWS = 'AKIA' + 'Q3VZ'.repeat(4);
const SK = 'sk-' + 'proj' + 'Ab3dE5fG7hJ9kL1mN2pQ';
const STRIPE = 'sk_' + 'live_' + '4eC39HqLyjWDarjtT1zdp7dc';
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.');
const PEM = ['-----BEGIN ' + 'RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM2JY', '-----END ' + 'RSA PRIVATE KEY-----'].join('\n');

const gdpr = { kinds: PROFILES.gdpr!.kinds, phoneNational: [], privateIps: false, terms: [], keep: [] } as const;
const masked = (text: string, spans: Array<{ start: number; end: number }>) => spans.map(s => text.slice(s.start, s.end));

describe('mask-detect: credentials', () => {
  it('finds provider formats, PEM blocks and JWTs', () => {
    const text = `token ${GH} aws ${AWS} openai ${SK} stripe ${STRIPE}\njwt ${JWT}\n${PEM}\nend`;
    const found = masked(text, resolveSpans(text, credentialSpans(text)));
    expect(found).toEqual(expect.arrayContaining([GH, AWS, SK, STRIPE, JWT, PEM]));
  });

  it('finds Authorization values, URL passwords and credential query parameters', () => {
    const text = 'curl -H "Authorization: Bearer abcDEF123456ghiJKL789" https://bob:s3cr3t-Pw@db.internal:5432/x ' +
      'https://api.example.org/v1?api_key=Zq81kLmN0pQr2StU&page=2 https://h/x?key=name';
    const found = masked(text, resolveSpans(text, credentialSpans(text)));
    expect(found).toEqual(expect.arrayContaining(['abcDEF123456ghiJKL789', 's3cr3t-Pw', 'Zq81kLmN0pQr2StU']));
    expect(found).not.toContain('name');
    expect(found).not.toContain('2');
  });

  it('masks values assigned to credential names, not counters or words', () => {
    const text = 'DB_PASSWORD=hunter22\napiKey: "Xy7_long-enough"\ntoken_count=123456\nmax_tokens: 4096\nauth_method=password\nSECRET=${VAULT_SECRET}';
    const found = masked(text, resolveSpans(text, credentialSpans(text)));
    expect(found).toEqual(['hunter22', 'Xy7_long-enough']);
    expect(credentialValue('session_id', 'a1b2c3d4e5')).toBe(true);
    expect(credentialValue('pin', '4821')).toBe(false); // shorter than 6
    expect(credentialValue('otp_code', '482113')).toBe(true);
    expect(credentialValue('description', 'hunter22')).toBe(false);
  });

  it('masks a JSON field named like a credential whole, and known values anywhere', () => {
    expect(masked('Tr0ub4dor&3', credentialSpans('Tr0ub4dor&3', [], 'password'))).toEqual(['Tr0ub4dor&3']);
    const t = 'the deploy key is qwertyQWERTY12 again qwertyQWERTY12';
    expect(masked(t, resolveSpans(t, credentialSpans(t, ['qwertyQWERTY12'])))).toEqual(['qwertyQWERTY12', 'qwertyQWERTY12']);
  });
});

describe('mask-detect: personal data', () => {
  it('validates cards (Luhn, issuer), IBAN (mod-97), SNILS, INN', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(cardNetwork('4111111111111111')).toBe(true);
    expect(cardNetwork('9111111111111111')).toBe(false);
    expect(ibanValid('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(ibanValid('DE89 3704 0044 0532 0130 01')).toBe(false);
    expect(snilsValid('112-233-445 95')).toBe(true);
    expect(snilsValid('112-233-445 96')).toBe(false);
    expect(inn12Valid('500100732259')).toBe(true);
    expect(inn12Valid('500100732258')).toBe(false);
  });

  it('keeps private, loopback and documentation addresses out of IP masking', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '192.0.2.7', '::1', 'fe80::1', '2001:db8::5']) expect(publicIp(ip, false)).toBe(false);
    for (const ip of ['8.8.8.8', '2a00:1450:4001:82a::200e']) expect(publicIp(ip, false)).toBe(true);
    expect(publicIp('10.1.2.3', true)).toBe(true);
  });

  it('finds the gdpr kinds and leaves look-alikes alone', () => {
    const text = 'Ann <ann.smith@acme.org>, +44 20 7946 0958, card 4111 1111 1111 1111, IBAN DE89 3704 0044 0532 0130 00, ' +
      'from 8.8.8.8. Not: demo@example.com, version 1.2.3.4, order 2026-11-22, id 4111111111111112, 10.0.0.1';
    const found = masked(text, resolveSpans(text, personalSpans(text, gdpr)));
    expect(found).toEqual(['ann.smith@acme.org', '+44 20 7946 0958', '4111 1111 1111 1111', 'DE89 3704 0044 0532 0130 00', '8.8.8.8']);
  });

  it('national phone forms and ids only in their profile', () => {
    const text = 'call (415) 555-2671 or 8 (916) 123-45-67, SSN 123-45-6789, SNILS 112-233-445 95, INN 500100732259';
    const us = { ...gdpr, kinds: PROFILES.us!.kinds, phoneNational: PROFILES.us!.phoneNational };
    const ru = { ...gdpr, kinds: PROFILES['ru-152fz']!.kinds, phoneNational: PROFILES['ru-152fz']!.phoneNational };
    expect(masked(text, resolveSpans(text, personalSpans(text, gdpr)))).toEqual([]);
    expect(masked(text, resolveSpans(text, personalSpans(text, us)))).toEqual(['(415) 555-2671', '123-45-6789']);
    expect(masked(text, resolveSpans(text, personalSpans(text, ru)))).toEqual(['8 (916) 123-45-67', '112-233-445 95', '500100732259']);
  });

  it('a credential wins where it overlaps personal data; placeholders are never masked again', () => {
    const text = 'password=ann.smith@acme.org';
    const spans = resolveSpans(text, [...credentialSpans(text), ...personalSpans(text, gdpr)]);
    expect(spans).toMatchObject([{ cls: 'credential', kind: 'SECRET' }]);
    const url = 'smtp://ann.smith%40acme.org:Pa55-word!@mail.acme.org';
    expect(masked(url, resolveSpans(url, credentialSpans(url)))).toEqual(['Pa55-word!']);
    expect(placeholderSpans('x WARDEN_SECRET_7Q2M9XD4RK y warden_email_7q2m9xd4rk@mask.invalid')).toHaveLength(2);
  });

  it('detectors stay fast on hostile input', () => {
    const hostile = ['a'.repeat(200_000), '1 '.repeat(100_000), 'x=' + 'y'.repeat(200_000), '-----BEGIN ' + 'PRIVATE KEY-----' + 'A'.repeat(200_000), ('ab.' + 'c'.repeat(60) + '@').repeat(3000), ':'.repeat(200_000)].join('\n');
    const t0 = Date.now();
    credentialSpans(hostile); personalSpans(hostile, { ...gdpr, kinds: ['EMAIL', 'PHONE', 'CARD', 'IBAN', 'IP', 'SSN', 'SNILS', 'INN'] });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('mask config', () => {
  it('defaults: credentials on (restore to origin), personal off', () => {
    const c = parseMaskConfig(undefined);
    expect(c.credentials).toMatchObject({ enabled: true, restore: 'origin', autoEnv: true });
    expect(c.personal.enabled).toBe(false);
    expect(c.display).toEqual({ credentials: false, personal: true });
  });

  it('shorthands, profiles, terms and strict fields', () => {
    const c = parseMaskConfig({ credentials: false, personal: 'ru-152fz' });
    expect(c.credentials.enabled).toBe(false);
    expect(c.personal).toMatchObject({ enabled: true, profile: 'ru-152fz' });
    expect(() => parseMaskConfig({ personal: { profile: 'mars' } })).toThrow(/profile/);
    expect(() => parseMaskConfig({ credentails: true })).toThrow(/Unknown mask field/);
    expect(() => parseMaskConfig({ personal: { patterns: [{ kind: 'ID', pattern: '(a+)+$' }] } })).toThrow(/nested quantifier/);
    const dir = mkdtempSync(join(tmpdir(), 'warden-mask-'));
    writeFileSync(join(dir, 'terms.txt'), '# customers\nAnn Smith\nCUSTOMER: ACME-77\n');
    const t = parseMaskConfig({ personal: { enabled: true, profile: 'custom', termsFile: 'terms.txt' } }, dir);
    expect(t.personal.terms.map(x => x.kind)).toEqual(['NAME', 'CUSTOMER']);
  });

  it('environment switches', () => {
    expect(maskConfigFromEnv({ WARDEN_MASK_PERSONAL: 'gdpr' }).personal).toMatchObject({ enabled: true, profile: 'gdpr' });
    expect(maskConfigFromEnv({ WARDEN_MASK_CREDENTIALS: 'off' }).credentials.enabled).toBe(false);
  });

  it('known credentials from the environment: names that say so, values that look like one', () => {
    const env = { GITHUB_TOKEN: GH, PGPASSWORD: 'Pg-pass-1234', SSH_AUTH_SOCK: '/tmp/agent.sock', API_KEY_FILE: '/etc/k', LANG: 'en_US.UTF-8', MONKEY: 'banana', OTHER: 'Zq81kLmN0pQr2StU' };
    expect(credentialEnvValues(env).sort()).toEqual([GH, 'Pg-pass-1234'].sort());
    expect(credentialEnvValues(env, ['OTHER'])).toContain('Zq81kLmN0pQr2StU');
  });
});

describe('masking session', () => {
  const env = { DEPLOY_TOKEN: 'Dpl0y-T0ken-77aa' };
  const make = (raw?: unknown) => new Masker(parseMaskConfig(raw), env);

  it('masks a tool result, keeps its shape and leaves binary payloads alone', () => {
    const s = make().session();
    const result = { content: [{ type: 'text', text: `key ${GH} and token Dpl0y-T0ken-77aa` }, { type: 'image', data: 'QUtJQQ==', mimeType: 'image/png' }], structuredContent: { password: 'hunter2-xyz', count: 3 } };
    const r = s.mask(result, { server: 'files', tool: 'read' });
    expect(r.total).toBe(3);
    expect(JSON.stringify(r.value)).not.toContain(GH);
    expect(JSON.stringify(r.value)).not.toContain('Dpl0y-T0ken-77aa');
    expect(JSON.stringify(r.value)).not.toContain('hunter2-xyz');
    expect((r.value.content[1] as { data: string }).data).toBe('QUtJQQ==');
    expect(r.value.structuredContent.count).toBe(3);
    expect(s.note(r)).toMatch(/replaced by placeholders/);
    expect(s.note(r)).toMatch(/see the earlier WARDEN note/);
  });

  it('same value, same placeholder; ids are random per session', () => {
    const m = make();
    const a = m.session('a'), b = m.session('b');
    const one = a.mask(`x ${GH}`, { server: 's' }).value, two = a.mask(`y ${GH}`, { server: 's' }).value;
    expect(one.slice(2)).toBe(two.slice(2));
    expect(b.mask(`x ${GH}`, { server: 's' }).value).not.toBe(one);
    expect(a.mask(one, { server: 's' }).total).toBe(0); // idempotent
  });

  it('restores to the origin server, refuses another, passes unknown placeholders on', () => {
    const s = make().session();
    const p = s.mask(GH, { server: 'github', tool: 'get_secret' }).value;
    expect(s.restore({ auth: p }, { server: 'github', tool: 'create_issue' }).value).toEqual({ auth: GH });
    expect(() => s.restore({ body: `leak ${p}` }, { server: 'pastebin', tool: 'paste' })).toThrow(MaskRefusal);
    expect(s.restore({ x: 'WARDEN_SECRET_0000000000' }, { server: 'pastebin' }).value).toEqual({ x: 'WARDEN_SECRET_0000000000' });
  });

  it('restoreTo, anywhere and never', () => {
    const to = make({ credentials: { restoreTo: ['deploy/*'] } }).session();
    const p = to.mask(GH, { server: 'vault' }).value;
    expect(to.restore(p, { server: 'deploy', tool: 'push' }).restored).toBe(1);
    expect(() => to.restore(p, { server: 'mail', tool: 'send' })).toThrow(MaskRefusal);
    const never = make({ credentials: { restore: 'never' } }).session();
    const q = never.mask(GH, { server: 'vault' }).value;
    expect(never.restore(q, { server: 'vault' }).value).toBe(q);
  });

  it('personal data: off by default, on by profile; e-mail placeholders stay e-mail addresses', () => {
    expect(make().session().mask('ann.smith@acme.org', { server: 'crm' }).total).toBe(0);
    const s = make({ personal: 'gdpr' }).session();
    const r = s.mask({ to: 'ann.smith@acme.org' }, { server: 'crm' });
    expect(r.value.to).toMatch(/^warden_email_[0-9a-z]{10}@mask\.invalid$/);
    expect(s.restore({ to: r.value.to.toUpperCase() }, { server: 'crm' }).value).toEqual({ to: 'ann.smith@acme.org' });
    expect(() => s.restore({ to: r.value.to }, { server: 'mail' })).toThrow(/personal value read from crm/);
    expect(s.restore(`?to=${encodeURIComponent(r.value.to)}`, { server: 'crm' }, encodeURIComponent).value).toBe('?to=ann.smith%40acme.org');
  });

  it("the user's own personal data goes anywhere; their typed credential only to restoreTo", () => {
    const s = make({ personal: 'gdpr' }).session();
    const mail = s.mask('write to bob@acme.org', { server: USER_ORIGIN }).value.split(' ').pop()!;
    expect(s.restore(mail, { server: 'mail', tool: 'send' }).value).toBe('bob@acme.org');
    const key = s.mask(`use ${GH}`, { server: USER_ORIGIN }).value.split(' ').pop()!;
    expect(() => s.restore(key, { server: 'github' })).toThrow(MaskRefusal);
  });

  it('reveal: personal data back for the reader, credentials stay masked', () => {
    const s = make({ personal: 'gdpr' }).session();
    const t = s.mask(`mail ann.smith@acme.org key ${GH}`, { server: 'crm' }).value;
    const shown = s.reveal(t);
    expect(shown).toContain('ann.smith@acme.org');
    expect(shown).not.toContain(GH);
    expect(make({ personal: 'gdpr', display: { credentials: true } }).session().reveal(t)).toBe(t); // another session knows nothing
  });

  it('exceptTools leaves a tool\'s results alone; the oldest entries age out at maxEntries', () => {
    const s = make({ credentials: { exceptTools: ['vault/create_key'] } }).session();
    expect(s.mask(GH, { server: 'vault', tool: 'create_key' }).total).toBe(0);
    const small = make({ maxEntries: 16 }).session();
    const first = small.mask('password=First-Value-1', { server: 's' }).value;
    for (let i = 0; i < 20; i++) small.mask(`password=Other-Value-${i}x`, { server: 's' });
    expect(small.size).toBe(16);
    expect(small.restore(first, { server: 's' }).restored).toBe(0);
  });

  it('a session idle past idleMinutes is forgotten', () => {
    let now = 0;
    const m = new Masker(parseMaskConfig({ idleMinutes: 1 }), env, () => now);
    const p = m.session('chat').mask(GH, { server: 's' }).value;
    now = 61_000;
    expect(m.session('chat').restore(p, { server: 's' }).restored).toBe(0);
  });
});

describe('already redacted values', () => {
  it('a value another tool redacted is left as it is', () => {
    for (const t of ['GITHUB_TOKEN=ghp_ng...39e5', 'api_key: sk-***', 'password=[REDACTED]', 'Authorization: Bearer abcd…wxyz12345678']) {
      expect(resolveSpans(t, credentialSpans(t))).toEqual([]);
    }
  });
});
