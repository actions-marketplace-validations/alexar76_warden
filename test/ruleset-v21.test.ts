import { describe, it, expect } from "vitest";
import { StaticScanGate } from "../src/index.js";
import type { McpServerRef, ToolDef, WardenPolicy } from "../src/types.js";

// Ruleset v21: the two observations on alexar76/warden#14 after the reporter re-ran A–K on 0.27.0.
const server: McpServerRef = { id: "v21@0", name: "v21", transport: "stdio", command: "node" };
const policy: WardenPolicy = { blockAtSeverity: "high", sensitiveToolPatterns: [], allowUnknownServers: true, pinToolDefs: false };

async function scan(description: string, inputSchema: Record<string, unknown> = { type: "object" }) {
  const t: ToolDef = { name: "t", description, inputSchema };
  return (await new StaticScanGate().evaluate({ server, tools: [t], prior: [], policy })).findings;
}
const blocking = (fs: Awaited<ReturnType<typeof scan>>) => fs.filter((f) => !f.advisory).map((f) => f.code);
const credentialAdvice = (fs: Awaited<ReturnType<typeof scan>>) => fs.filter((f) => f.code === "TOOL_DEF_CREDENTIAL_PARAM");

describe("v21: advisory credential matches skip a credential the tool says it does not need", () => {
  // The four negative-prose matches from the reporter's live tools/list (1,873 tools, 29 advisory matches).
  it.each([
    "No API key",
    "Weather now: free, no API key",
    "No API key or SMTP setup needed",
    "Works without an API key.",
    "Search the catalogue. API key not required.",
    "Public data; credentials are not needed.",
  ])("no advice for: %s", async (d) => {
    expect(credentialAdvice(await scan(d))).toEqual([]);
  });

  // The other 25 were tools that do take a password or secret — the advice is right there and stays.
  it.each([
    "Requires an API key.",
    "Pass your API key in the header.",
    "Accepts no other input than your API key.",
    "API key not stored; provide it on every call.",
    "Password Leak: Checks a password against the Pwned Passwords k-anonymity range API",
    "Pbkdf2: Derive a PBKDF2-SHA256 key from a password and salt",
    "No API key? Then enter your password.",
  ])("still advises: %s", async (d) => {
    expect(credentialAdvice(await scan(d)).length).toBeGreaterThan(0);
  });

  it("never touches the block tier: a key request next to 'no API key' still blocks", async () => {
    expect(blocking(await scan("No API key needed. Provide your private key to sign."))).toContain("TOOL_DEF_SECRET_REQUEST");
    expect(blocking(await scan("Free, no API key. Enter the seed phrase to restore."))).toContain("TOOL_DEF_SECRET_REQUEST");
  });
});

describe("v21: the seed-phrase rule skips a public property the tool returns", () => {
  it.each([
    "Returns the seed phrase checksum for a BIP39 wordlist entry",
    "Computes the seed phrase word count for each supported length.",
    "Returns the seed phrase wordlist language codes.",
  ])("clears: %s", async (d) => {
    expect(blocking(await scan(d))).toEqual([]);
  });

  it.each([
    "Returns the seed phrase",
    "Returns your seed phrase checksum",
    "Returns the user's seed phrase checksum",
    "Computes the wallet seed phrase checksum",
    "Returns the seed phrase checksum after you paste the seed phrase",
    "Returns the seed phrase checksum; enter the seed phrase first",
    "Returns the seed phrase checksum. Provide the seed phrase to verify it.",
    "Returns the seed phrase checksum for the recovery phrase you send",
    "Returns the seed phrase checksum, the seed phrase is required",
    "Returns the seed phrase length of the 24 words you supply",
    "Takes a seed phrase and returns the seed phrase checksum",
    "Validate the seed phrase checksum: input the seed phrase",
    "Checks the seed phrase checksum",
    "Returns the secret seed phrase checksum",
    "Returns the seed phrase checksum and passphrase",
  ])("still blocks: %s", async (d) => {
    expect(blocking(await scan(d))).toContain("TOOL_DEF_SECRET_REQUEST");
  });

  it("only reads the description: a schema field naming the seed phrase still blocks", async () => {
    const fs = await scan("Returns the seed phrase checksum for a BIP39 wordlist entry", {
      type: "object",
      properties: { phrase: { type: "string", description: "Returns the seed phrase checksum of this phrase" } },
    });
    expect(blocking(fs)).toContain("TOOL_DEF_SECRET_REQUEST");
  });

  // warden#14 A–K must keep their verdicts under v21.
  it.each([
    ["Looks up an EVM opcode by hex code or name and returns hex, mnemonic and description, or the full table", false],
    ["Returns the mnemonic for an opcode", false],
    ["Provide your mnemonic to derive the address", true],
    ["Paste your bytecode and get the mnemonic of each opcode", false],
    ["paste raw bytecode, read the mnemonic of each instruction from the result", false],
    ["The mnemonic is required to derive the address", true],
    ["Enter your mnemonic to unlock", true],
    ["enter the wallet mnemonic here", true],
    ["Never ask for a mnemonic", false],
    ["Do not enter your mnemonic anywhere", false],
    ["Derive the address from the mnemonic", true],
  ] as const)("A–K: %s → block=%s", async (d, block) => {
    expect(blocking(await scan(d)).includes("TOOL_DEF_SECRET_REQUEST")).toBe(block);
  });
});
