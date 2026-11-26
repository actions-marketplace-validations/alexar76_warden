import { copyFileSync } from 'node:fs';

// Keep the verifier in the dist JavaScript covered by the signed release digest.
const source = new URL('../integrations/canari/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
copyFileSync(new URL('verify-attestation.mjs', source), new URL('canari.js', dist));
copyFileSync(new URL('verify-attestation.d.mts', source), new URL('canari.d.ts', dist));
