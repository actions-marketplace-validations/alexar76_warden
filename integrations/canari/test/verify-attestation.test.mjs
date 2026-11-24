// Run: node --test integrations/canari/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCanariAttestation } from '../verify-attestation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, '..', 'fixtures', p), 'utf8'));

const key = read('canari-public-key.json');
const bundle = read('bundle-current.json');
const expired = read('bundle-expired.json');

const NOW = Date.parse('2026-11-24T12:00:00Z');

test('a current attestation with verdict pass is allowed', () => {
  const r = verifyCanariAttestation(bundle, key, { now: NOW });
  assert.equal(r.decision, 'allow', r.reasons.join('; '));
  assert.equal(r.verdict, 'pass');
  assert.match(r.artifactSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.subject.registry, 'pypi');
});

test('an expired attestation is blocked even though the signature is valid', () => {
  const r = verifyCanariAttestation(expired, key, { now: NOW });
  assert.equal(r.decision, 'block');
  assert.match(r.reasons.join(' '), /expired/);
});

test('editing the unsigned mirror is caught', () => {
  const tampered = structuredClone(bundle);
  tampered.payload.verdict = 'fail';
  const r = verifyCanariAttestation(tampered, key, { now: NOW });
  assert.equal(r.decision, 'block');
  assert.match(r.reasons.join(' '), /does not match the signed predicate/);
});

test('editing the signed body breaks the signature', () => {
  const tampered = structuredClone(bundle);
  const body = JSON.parse(Buffer.from(tampered.envelope.payload, 'base64').toString('utf8'));
  body.predicate.verdict = 'pass';
  tampered.envelope.payload = Buffer.from(JSON.stringify(body)).toString('base64');
  const r = verifyCanariAttestation(tampered, key, { now: NOW });
  assert.equal(r.decision, 'block');
  assert.match(r.reasons.join(' '), /signature/);
});

test('a different key cannot verify the bundle', () => {
  const other = { keytype: 'ed25519', scheme: 'ed25519',
                  keyval: { public: '11'.repeat(32) } };
  const r = verifyCanariAttestation(bundle, other, { now: NOW });
  assert.equal(r.decision, 'block');
});

test('a malformed key is refused with a reason, not a throw', () => {
  const r = verifyCanariAttestation(bundle, { keyval: {} }, { now: NOW });
  assert.equal(r.decision, 'block');
  assert.match(r.reasons.join(' '), /public key/);
});

test('a non-envelope is refused', () => {
  const r = verifyCanariAttestation({ payload: {} }, key, { now: NOW });
  assert.equal(r.decision, 'block');
  assert.match(r.reasons.join(' '), /DSSE envelope/);
});
