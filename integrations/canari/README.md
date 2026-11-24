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

const r = verifyCanariAttestation(bundleJson, publicKeyJson);
// { ok, decision: 'allow' | 'review' | 'block', reasons, verdict,
//   subject, scannedAt, expiresAt, artifactSha256, evidenceDigest }
```

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

1. DSSE signature over the length-prefixed payload (`node:crypto`, Ed25519),
   against a raw 32-byte key in Canari's published `{keyval:{public}}` shape.
2. The signed payload parses and carries a `predicate`.
3. The unsigned top-level mirror equals the signed body. The inline `signature`
   block is excluded from that comparison: signing runs twice, so the two copies
   carry different pass numbers there by construction (the same rule Canari's
   own `check_payload_integrity` applies). Everything else must match byte for
   byte — that comparison is what catches an edit to the copy the signature does
   not cover.
4. The verdict is one it knows, and `expires_at` has not passed.

Nothing here reads the network, and there are no dependencies.

## Why not just trust the field?

Because the unsigned copy is the one a careless reader would print. Test
`editing the unsigned mirror is caught` flips `payload.verdict` without touching
the envelope: the signature still verifies, and the adapter still refuses.

## Tests

```bash
node --test integrations/canari/test/verify-attestation.test.mjs
```

Fixtures are a real published bundle (current), an older one whose TTL has
passed, and the public key under which both were signed.
