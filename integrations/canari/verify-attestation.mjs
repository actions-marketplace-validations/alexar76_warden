// WARDEN reads the declaration; Canari signs a verdict about the *artifact*.
// This adapter answers the question WARDEN leaves open on purpose: "Verdicts are
// unsigned diagnostic records, not compliance attestations." Given a signed
// Canari attestation, the key it should verify against, and the digest of the
// artifact about to be installed, it returns a decision in WARDEN's vocabulary.
//
// Fail-closed by construction. Every check below refuses rather than degrades:
// a missing field, a malformed digest, a digest that does not agree with the
// signed one, an expiry that has passed (or is exactly now), an unknown type, a
// verdict inherited from Object.prototype - each is a block with a reason, never
// a throw and never an allow.
//
//   import { verifyCanariAttestation } from './verify-attestation.mjs';
//   const r = verifyCanariAttestation(bundle, publicKey, {
//     expectedArtifactSha256: 'e3b0c442...',   // the artifact you are about to run
//     now: Date.now(),                          // optional, for tests
//   });
//   if (r.decision === 'block') throw new Error(r.reasons.join('; '));
//
// Zero dependencies: node:crypto has Ed25519, and the envelope is DSSE, which is
// a length-prefixed concatenation, not a library.

import { createHash, createPublicKey, verify } from 'node:crypto';

// DER prefix for a raw 32-byte Ed25519 public key (RFC 8410 SubjectPublicKeyInfo).
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// The only envelope type this adapter understands. Anything else is refused
// before any signature work: verifying a signature over a payload we then
// misread is worse than not verifying at all.
const ALLOWED_PAYLOAD_TYPES = new Set(['application/vnd.in-toto+json']);
const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
const PREDICATE_TYPE = 'https://agentcheck.dev/attestation/v0.1';

const SHA256_HEX = /^[0-9a-f]{64}$/;

const VERDICT_TO_DECISION = new Map([
  ['pass', 'allow'],
  ['pass-with-findings', 'review'],
  ['fail', 'block'],
  ['error', 'block'],
  ['unsupported', 'block'], // absence of evidence is not evidence of safety
]);

/** Canari publishes {keytype, keyval:{public: <64 hex>}, scheme}. */
export function publicKeyObject(canariKey) {
  const hex = canariKey?.keyval?.public;
  if (typeof hex !== 'string' || !SHA256_HEX.test(hex)) {
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

/** A bare attestation body, from either a body or an in-toto Statement. */
function unwrapBody(value) {
  if (value && typeof value === 'object' && value.predicate && typeof value.predicate === 'object') {
    return value.predicate;
  }
  return value;
}

/** `sha256:<hex>` or `<hex>` -> lowercase hex, or null when it is neither. */
function normaliseDigest(value) {
  if (typeof value !== 'string') return null;
  const hex = value.toLowerCase().startsWith('sha256:') ? value.slice(7) : value;
  return SHA256_HEX.test(hex.toLowerCase()) ? hex.toLowerCase() : null;
}

/**
 * @param {object} bundle    { envelope, payload } as published by Canari
 * @param {object} canariKey public key JSON
 * @param {{now?: number, expectedArtifactSha256?: string}} [opts]
 *   expectedArtifactSha256 is REQUIRED: a verdict that is not bound to the bytes
 *   you are about to install says nothing about those bytes.
 * @returns {{ok:boolean, decision:'allow'|'review'|'block', reasons:string[],
 *            verdict?:string, subject?:object, scannedAt?:string, expiresAt?:string,
 *            artifactSha256?:string, evidenceDigest?:string}}
 */
export function verifyCanariAttestation(bundle, canariKey, opts = {}) {
  const now = opts.now ?? Date.now();
  const reasons = [];
  const block = (why) => ({ ok: false, decision: 'block', reasons: [...reasons, why] });

  // 0. envelope shape
  const env = bundle?.envelope;
  if (!env || typeof env !== 'object'
      || typeof env.payload !== 'string'
      || !Array.isArray(env.signatures) || env.signatures.length === 0) {
    return block('not a DSSE envelope');
  }

  // 1. payload type, before any signature work
  const payloadType = env.payloadType;
  if (typeof payloadType !== 'string' || !payloadType) {
    return block('envelope has no payloadType');
  }
  if (!ALLOWED_PAYLOAD_TYPES.has(payloadType)) {
    return block(`unsupported payloadType ${JSON.stringify(payloadType)}`);
  }

  // 2. key
  let key;
  try {
    key = publicKeyObject(canariKey);
  } catch (err) {
    return block(err.message);
  }

  // 3. signature
  const body = Buffer.from(env.payload, 'base64');
  const preAuth = pae(payloadType, body);
  let signatureOk = false;
  for (const s of env.signatures) {
    if (typeof s?.sig !== 'string') continue;
    const sig = Buffer.from(s.sig, 'base64');
    if (sig.length !== 64) continue;
    try {
      if (verify(null, preAuth, key, sig)) { signatureOk = true; break; }
    } catch { /* try the next signature */ }
  }
  if (!signatureOk) return block('signature verification failed');

  // 4. statement shape
  let statement;
  try {
    statement = JSON.parse(body.toString('utf8'));
  } catch {
    return block('signed payload is not JSON');
  }
  if (!statement || typeof statement !== 'object') return block('signed payload is not an object');
  if (statement._type !== STATEMENT_TYPE) {
    return block(`unsupported statement type ${JSON.stringify(statement._type)}`);
  }
  if (statement.predicateType !== PREDICATE_TYPE) {
    return block(`unsupported predicate type ${JSON.stringify(statement.predicateType)}`);
  }
  const predicate = statement.predicate;
  if (!predicate || typeof predicate !== 'object') return block('signed payload has no predicate');

  // 5. verdict: own property, string, known. `constructor` must not resolve
  //    through the prototype chain to a function and then to a decision.
  if (!Object.hasOwn(predicate, 'verdict')) return block('signed payload has no verdict');
  const verdict = predicate.verdict;
  if (typeof verdict !== 'string') return block('verdict is not a string');
  if (!VERDICT_TO_DECISION.has(verdict)) return block(`unknown verdict ${JSON.stringify(verdict)}`);

  // 6. artifact binding, inside the signature: the in-toto subject digest and
  //    Canari's own subject digest must both exist and agree.
  const statementDigest = normaliseDigest(statement.subject?.[0]?.digest?.sha256);
  if (!statementDigest) return block('signed statement has no sha256 subject digest');
  const predicateDigest = normaliseDigest(predicate.subject?.artifact_sha256);
  if (!predicateDigest) return block('signed predicate has no artifact_sha256');
  if (statementDigest !== predicateDigest) {
    return block('in-toto subject digest disagrees with the Canari artifact digest');
  }

  // 7. artifact binding, outside the signature: the caller must say which bytes
  //    it is about to install, and they must be the ones that were signed.
  const expected = normaliseDigest(opts.expectedArtifactSha256);
  if (!opts.expectedArtifactSha256) return block('no expected artifact digest was supplied');
  if (!expected) return block('expected artifact digest is not a sha256');
  if (expected !== predicateDigest) {
    return block('attestation is about a different artifact than the one being installed');
  }

  // 8. freshness: an expiry that is missing, unparseable or exactly now is not
  //    evidence about today.
  const expiresAt = predicate.expires_at;
  if (typeof expiresAt !== 'string' || !expiresAt) return block('signed payload has no expires_at');
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return block('expires_at is not a timestamp');
  if (expiry <= now) return block(`attestation expired at ${expiresAt}`);

  // 9. the unsigned mirror is what a naive reader would print. The inline
  //    `signature` block differs by construction (signing runs twice), so it is
  //    excluded; everything else must match exactly.
  if (bundle.payload !== undefined) {
    const strip = (o) => {
      const body = unwrapBody(o);
      if (!body || typeof body !== 'object') return body;
      const { signature, ...rest } = body;
      return rest;
    };
    if (canonical(strip(bundle.payload)) !== canonical(strip(predicate))) {
      return block('top-level payload does not match the signed predicate');
    }
  }

  const decision = VERDICT_TO_DECISION.get(verdict);
  if (decision !== 'allow') reasons.push(`verdict is ${verdict}`);
  return {
    ok: decision === 'allow',
    decision,
    reasons,
    verdict,
    subject: predicate.subject || {},
    scannedAt: typeof predicate.generated_at === 'string' ? predicate.generated_at : '',
    expiresAt,
    artifactSha256: predicateDigest,
    evidenceDigest: 'sha256:' + createHash('sha256').update(canonical(predicate), 'utf8').digest('hex'),
  };
}
