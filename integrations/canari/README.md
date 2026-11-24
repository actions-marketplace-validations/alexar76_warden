# Canari attestations for WARDEN

WARDEN's own framing: *"Verdicts are unsigned diagnostic records, not compliance
attestations."* That is the right call for a local firewall — it should not
pretend to issue a credential — but it leaves one question open: when a host has
a signed record about the artefact it is about to pin, how does it check it?

This adapter answers that, and nothing else. It is deliberately not a scanner and
not a policy engine: give it a DSSE envelope and a public key, get a decision in
WARDEN's vocabulary.

```js
import { verifyCanariAttestation } from './integrations/canari/verify-attestation.mjs';

const r = verifyCanariAttestation(bundleJson, publicKeyJson, {
  expectedArtifactSha256: 'e3b0c442...',  // REQUIRED: the bytes you are about to install
  now: Date.now(),                        // optional, for tests
});
// { ok, decision: 'allow' | 'review' | 'block', reasons, verdict,
//   subject, scannedAt, expiresAt, artifactSha256, evidenceDigest }
```

`expectedArtifactSha256` is not optional. A verdict that is not bound to the
bytes you are about to install says nothing about those bytes, so a call without
it blocks.

Mapping, chosen so that absence of evidence never reads as safety:

| attestation verdict | decision |
|---|---|
| `pass` | `allow` |
| `pass-with-findings` | `review` |
| `fail`, `error` | `block` |
| `unsupported` | `block` — nothing was verified |

An expired attestation blocks even when the signature is valid: a correct
signature over a stale statement is not evidence about today.

## What it actually verifies

Every check refuses rather than degrades; nothing here throws.

1. The envelope is a DSSE envelope with a `payloadType` this adapter knows. An
   unknown type is blocked **before** any signature work — verifying a signature
   over a payload we then misread is worse than not verifying.
2. The signature is Ed25519 over the length-prefixed payload (`node:crypto`),
   against a raw 32-byte key in Canari's published `{keyval:{public}}` shape.
3. The signed body is an in-toto Statement v1 carrying Canari's predicate type.
4. The verdict is an own property, a string, and one it knows — so `constructor`
   cannot resolve through `Object.prototype` into a decision.
5. **Artifact binding, inside the signature**: the in-toto subject digest and
   Canari's `subject.artifact_sha256` must both be 64 hex and must agree.
6. **Artifact binding, outside the signature**: the caller's
   `expectedArtifactSha256` must be present, well-formed, and equal. This is the
   step that ties the verdict to the bytes actually being installed.
7. `expires_at` must exist, parse, and be strictly in the future — an expiry
   exactly now is not evidence about today.
8. The unsigned top-level mirror equals the signed body. The inline `signature`
   block is excluded from that comparison: signing runs twice, so the two copies
   carry different pass numbers there by construction (the same rule Canari's
   own `check_payload_integrity` applies). Everything else must match byte for
   byte — that comparison is what catches an edit to the copy the signature does
   not cover.

Nothing here reads the network, and there are no dependencies.

## Why not just trust the field?

Because the unsigned copy is the one a careless reader would print. Test
`editing the unsigned mirror is caught` flips `payload.verdict` without touching
the envelope: the signature still verifies, and the adapter still refuses.

## Tests

```bash
node --test integrations/canari/test/verify-attestation.test.mjs   # 31 tests
```

Fixtures are a real published bundle (current), an older one whose TTL has
passed, and the public key under which both were signed.
