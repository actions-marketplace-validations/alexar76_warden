import type { Buffer } from "node:buffer";
import type { KeyObject } from "node:crypto";

export interface CanariVerificationOptions {
  expectedArtifactSha256: string;
  now?: number;
}

export interface CanariVerificationResult {
  ok: boolean;
  decision: "allow" | "review" | "block";
  reasons: string[];
  verdict?: string;
  subject?: Record<string, unknown>;
  scannedAt?: string;
  expiresAt?: string;
  artifactSha256?: string;
  evidenceDigest?: string;
}

export function verifyCanariAttestation(
  bundle: unknown,
  canariKey: unknown,
  options: CanariVerificationOptions,
): CanariVerificationResult;

export function publicKeyObject(canariKey: unknown): KeyObject;
export function pae(payloadType: string, body: Uint8Array): Buffer;
