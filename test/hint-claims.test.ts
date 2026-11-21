import { describe, expect, it } from "vitest";
import { hintContradictions, hintContradictionFindings } from "../src/hint-claims.js";
import type { ToolDef } from "../src/types.js";

const tool = (name: string, description: string, annotations?: Record<string, unknown>): ToolDef =>
  ({ name, description, inputSchema: { type: "object" }, ...(annotations ? { annotations } : {}) });

describe("hint contradicted by the tool's own description", () => {
  it("GitHub update_issue_labels: destructiveHint false, description replaces the current labels", () => {
    // github/github-mcp-server pkg/github/__toolsnaps__/update_issue_labels.snap, read 2026-11-20.
    const t = tool("update_issue_labels",
      "Update the labels of an existing issue. This replaces the current labels with the provided list. When setting values, include a confidence level (LOW, MEDIUM, or HIGH) reflecting how certain you are about the choice.",
      { title: "Update Issue Labels", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(hintContradictions(t)).toEqual([{ tool: "update_issue_labels", claim: "destructiveHint=false",
      says: "replaces the current …", quote: "This replaces the current labels with the provided list.",
      phrase: "replaces the current", sentence: "This replaces the current labels with the provided list." }]);
  });

  it("does not see what only the code says (Kubernetes pods_run force-applies a Service)", () => {
    const t = tool("pods_run", "Run a Kubernetes Pod in the current or provided namespace with the provided container image and optional name",
      { title: "Pods: Run", destructiveHint: false, openWorldHint: true });
    expect(hintContradictions(t)).toEqual([]);
  });

  it("reads a write verb the tool is the subject of, under readOnlyHint true", () => {
    for (const d of ["Deletes the given file.", "Send a message to a channel.", "This tool creates a new issue.",
      "Will permanently delete the record.", "Lists rows. Sets the default workspace for later calls."]) {
      expect(hintContradictions(tool("t", d, { readOnlyHint: true })), d).toHaveLength(1);
    }
  });

  it("does not read nouns, negations or objects as actions", () => {
    for (const d of ["List deleted files in the trash.", "Does not delete anything.", "Set of helpers for dates.",
      "Order by date, newest first.", "Post details for a blog slug.", "Get updates since a timestamp.",
      "Close prices for a ticker.", "Returns the store locations.", "Update:", "Delete", "Lists files. Delete one with delete_file.", "Create text embeddings.", "Creates an in-memory preview without touching the filesystem.", "It writes no memory."]) {
      expect(hintContradictions(tool("t", d, { readOnlyHint: true })), d).toEqual([]);
    }
  });

  it("asks nothing of a tool that makes no claim, or whose claim is the default", () => {
    expect(hintContradictions(tool("t", "Deletes the file."))).toEqual([]);
    expect(hintContradictions(tool("t", "Deletes the file.", { readOnlyHint: false }))).toEqual([]);
    expect(hintContradictions(tool("t", "Deletes the file.", { destructiveHint: true }))).toEqual([]);
  });

  it("destructiveHint false reads only destructive verbs; it is ignored under readOnlyHint true", () => {
    expect(hintContradictions(tool("t", "Creates a draft.", { destructiveHint: false }))).toEqual([]);
    expect(hintContradictions(tool("t", "Removes the user from the team.", { destructiveHint: false }))[0]?.says).toBe("removes");
    expect(hintContradictions(tool("t", "Creates a draft. This action cannot be undone.", { destructiveHint: false }))[0]?.says).toBe("cannot be undone");
    expect(hintContradictions(tool("t", "Creates a new issue.", { readOnlyHint: true, destructiveHint: false }))[0]?.claim).toBe("readOnlyHint=true");
  });

  it("findings are advisory and name the claim and the sentence", () => {
    const [f] = hintContradictionFindings([tool("drop_table", "Deletes the table and its data.", { readOnlyHint: true })]);
    expect(f).toMatchObject({ gate: "annotations", code: "TOOL_HINT_CONTRADICTS_DESCRIPTION", advisory: true, severity: "medium", tool: "drop_table" });
    expect(f!.message).toContain('readOnlyHint=true');
    expect(f!.message).toContain('"Deletes the table and its data."');
    expect(f!.message).toContain('"Deletes the table and its data." A host');
  });

  it("findings carry the claim, the matched phrase and the whole sentence as fields (asked on DEV, 2026-11-21)", () => {
    const [f] = hintContradictionFindings([tool("drop_table", "Deletes the table and its data.", { readOnlyHint: true })]);
    expect(f!.evidence).toEqual({ claim: "readOnlyHint=true", matchedPhrase: "deletes", quotedSentence: "Deletes the table and its data." });
    const [g] = hintContradictionFindings([tool("update_issue_labels", "Update the labels. This replaces the current labels with the provided list.",
      { destructiveHint: false })]);
    expect(g!.evidence).toEqual({ claim: "destructiveHint=false", matchedPhrase: "replaces the current",
      quotedSentence: "This replaces the current labels with the provided list." });
    const [h] = hintContradictionFindings([tool("t", "Creates a draft. This action cannot be undone.", { destructiveHint: false })]);
    expect(h!.evidence?.matchedPhrase).toBe("cannot be undone");
  });

  it("the message quotes 160 characters; quotedSentence keeps the whole sentence, with control characters escaped", () => {
    const long = `Deletes the table and its data, ${"including every index and view that depends on it, ".repeat(4)}in one\u0007 call.`;
    const [f] = hintContradictionFindings([tool("drop_table", long, { readOnlyHint: true })]);
    expect(long.length).toBeGreaterThan(160);
    expect(f!.message).toContain("…");
    expect(f!.message).not.toContain("in one");
    expect(f!.evidence!.quotedSentence).toBe(long.replace("\u0007", "\\u0007"));
  });
});
