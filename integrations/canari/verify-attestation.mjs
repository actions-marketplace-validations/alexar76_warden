// WARDEN reads the declaration; Canari signs a verdict about the *artifact*.
// This adapter answers the question WARDEN leaves open on purpose: "Verdicts are
// unsigned diagnostic records, not compliance attestations." Given a signed
// Canari attestation and its public key, it returns a decision in WARDEN's
// vocabulary, or refuses.
//
// Zero dependencies: node:crypto has Ed25519, and the envelope is DSSE, which is
// a length-prefixed concatenation, not a library.
//
//   import { verifyCanariAttestation } from './verify-attestation.mjs';
//   const r = verifyCanariAttestation(bundle, publicKey, { now: Date.now() });
//   if (r.decision === 'block') throw new Error(r.reasons.join('; '));

import { createHash, createPublicKey, verify } from 'node:crypto';

// DER prefix for a raw 32-byte Ed25519 public key (RFC 8410 SubjectPublicKeyInfo).
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Canari publishes {keytype, keyval:{public: <64 hex>}, scheme}. */
export function publicKeyObject(canariKey) {
  const hex = canariKey?.keyval?.public;
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('not a Canari public key: keyval.public must be 32 bytes of hex');
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

/** DSSE PAE: "DSSEv1" SP LEN(type) SP type SP LEN(body) SP body. */
export function pae(payloadType, body) {
  const t = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${t.length} `, 'utf8'), t,
    Buffer.from(` ${body.length} `, 'utf8'), body,
  ]);
}

/** Stable JSON so the unsigned mirror can be compared with the signed predicate. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const VERDICT_TO_DECISION = {
  pass: 'allow',
  'pass-with-findings': 'review',
  fail: 'block',
  error: 'block',
  unsupported: 'block', // absence of evidence is not evidence of safety
};

function digestOf(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A bare attestation body, from either a body or an in-toto Statement. */
function unwrapBody(value) {
  if (value && typeof value === 'object' && value.predicate && typeof value.predicate === 'object') {
    return value.predicate;
  }
  return value;
}

/**
 * @param {object} bundle    { envelope, payload } as published by Canari
 * @param {object} canariKey public key JSON
 * @param {{now?: number}} [opts] now in ms, for tests
 * @returns {{ok:boolean, decision:'allow'|'review'|'block', reasons:string[],
 *            verdict?:string, subject?:object, scannedAt?:string, expiresAt?:string,
 *            artifactSha256?:string}}
 */
export function verifyCanariAttestation(bundle, canariKey, opts = {}) {
  const now = opts.now ?? Date.now();
  const reasons = [];
  const fail = (why) => ({ ok: false, decision: 'block', reasons: [...reasons, why] });

  const env = bundle?.envelope;
  if (!env || typeof env.payload !== 'string' || !Array.isArray(env.signatures) || !env.signatures.length) {
    return fail('not a DSSE envelope');
  }
  let key;
  try {
    key = publicKeyObject(canariKey);
  } catch (err) {
    return fail(err.message);
  }

  const body = Buffer.from(env.payload, 'base64');
  const preAuth = pae(env.payloadType, body);

  let signatureOk = false;
  for (const s of env.signatures) {
    if (typeof s?.sig !== 'string') continue;
    const sig = Buffer.from(s.sig, 'base64');
    if (sig.length !== 64) continue;
    try {
      if (verify(null, preAuth, key, sig)) { signatureOk = true; break; }
    } catch { /* try the next signature */ }
  }
  if (!signatureOk) return fail('signature verification failed');

  let statement;
  try {
    statement = JSON.parse(body.toString('utf8'));
  } catch {
    return fail('signed payload is not JSON');
  }
  const predicate = statement?.predicate;
  if (!predicate || typeof predicate !== 'object') return fail('signed payload has no predicate');

  // The unsigned top-level mirror is what a naive reader would trust. Compare it
  // with the signed body, excluding the inline `signature` block: signing runs
  // twice (sign, inject the inline block, sign again) so the two copies hold
  // different pass numbers there by design. Everything else must match exactly.
  if (bundle.payload !== undefined) {
    const strip = (o) => {
      const body = unwrapBody(o);
      const { signature, ...rest } = body || {};
      return rest;
    };
    if (canonical(strip(bundle.payload)) !== canonical(strip(predicate))) {
      return fail('top-level payload does not match the signed predicate');
    }
  }

  const verdict = String(predicate.verdict || '');
  const decision = VERDICT_TO_DECISION[verdict];
  if (!decision) return fail(`unknown verdict ${JSON.stringify(verdict)}`);

  const subject = predicate.subject || {};
  const expiresAt = predicate.expires_at || '';
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t) && t < now) {
      reasons.push(`attestation expired at ${expiresAt}`);
      return { ok: false, decision: 'block', reasons, verdict,
               subject, scannedAt: predicate.generated_at || '', expiresAt };
    }
  }

  if (decision !== 'allow') reasons.push(`verdict is ${verdict}`);
  return {
    ok: decision === 'allow',
    decision,
    reasons,
    verdict,
    subject,
    scannedAt: predicate.generated_at || '',
    expiresAt,
    artifactSha256: subject.artifact_sha256 || '',
    evidenceDigest: digestOf(canonical(predicate)),
  };
}
