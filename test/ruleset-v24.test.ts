import { describe, it, expect } from "vitest";
import { StaticScanGate } from "../src/index.js";
import type { McpServerRef, ToolDef, WardenPolicy } from "../src/types.js";

// Ruleset v24: TOOL_DEF_SHORT_LINK, advisory. A link through a URL shortener hides where it leads, so it is the
// address to read first (HISTOR lists the same hosts apart as `newShortLinks`). It never blocks.
const server: McpServerRef = { id: "v24@0", name: "v24", transport: "stdio", command: "node" };
const policy: WardenPolicy = { blockAtSeverity: "high", sensitiveToolPatterns: [], allowUnknownServers: true, pinToolDefs: false };

async function scan(tool: Partial<ToolDef>) {
  const t: ToolDef = { name: "t", description: "", inputSchema: { type: "object", properties: {} }, ...tool };
  return new StaticScanGate().evaluate({ server, tools: [t], prior: [], policy });
}

const shortLinks = async (tool: Partial<ToolDef>) =>
  (await scan(tool)).findings.filter((f) => f.code === "TOOL_DEF_SHORT_LINK");

describe("v24: a link through a URL shortener is reported, never blocked", () => {
  it.each([
    "Before use, read https://bit.ly/3xYzAb for the terms.",
    "Docs: http://tinyurl.com/mcp-docs",
    "See t.co/AbCdEf",
    "Setup guide at www.cutt.ly/setup-2",
    "(details: https://rb.gy/q1w2e3)",
    "Install from HTTPS://BIT.LY/Install",
  ])("reports %j as advisory, not blocking", async (description) => {
    const r = await scan({ description });
    const hits = r.findings.filter((f) => f.code === "TOOL_DEF_SHORT_LINK");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("low");
    expect(hits[0].advisory).toBe(true);
    expect(r.findings.filter((f) => !f.advisory)).toEqual([]);
  });

  it("finds one in a parameter description too", async () => {
    const hits = await shortLinks({
      description: "Fetch a page.",
      inputSchema: { type: "object", properties: { url: { type: "string", description: "e.g. https://bit.ly/abc12" } } },
    });
    expect(hits).toHaveLength(1);
  });

  it.each([
    "Shortens a link with bit.ly or tinyurl.com.", // the service named, no link
    "Docs: https://microsoft.com/learn and https://docs.github.com/en", // t.co inside microsoft.com, github.com
    "Mail support@bit.ly or visit https://example.org/bit.ly/x", // an e-mail address, a path that only spells the name
    "Read https://subdomain.bit.ly.example.org/x", // another host that only contains the name
    "Visit https://cutt.ly/ for the service", // the service's own page, no short code
  ])("does not report %j", async (description) => {
    expect(await shortLinks({ description })).toEqual([]);
  });
});
