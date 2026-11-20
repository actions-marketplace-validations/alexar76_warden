/**
 * A behaviour hint that its own tool's description contradicts.
 *
 * A pin, a lock or a fingerprint answers "did the server change its story since it was approved?". None of them can
 * answer "was the story true on the day it was approved?". Code and calls answer that; one part of it is visible in
 * the definition itself: a tool that says `readOnlyHint: true` while its description says it deletes, or
 * `destructiveHint: false` while its description says it replaces the current set. A reader on dev.to pointed at two
 * real cases (2026-11-20): GitHub's MCP server `update_issue_labels` (destructiveHint false; description: "This
 * replaces the current labels with the provided list") and the Kubernetes server's `pods_run` (destructiveHint false;
 * the code force-applies a Service). This module catches the first kind only: when the code, not the text, is what
 * contradicts the hint, nothing here sees it.
 *
 * It reads English descriptions, sentence by sentence, and only where the tool is the subject of the verb: a sentence
 * that starts with the verb ("Deletes the file.", "Delete a file") or says "this tool deletes …". "List deleted
 * files" or "Does not delete" do not match. It marks; it never approves, refuses or rewrites a hint: the finding is
 * advisory, and an operator's own label (flow policy `labels`) is the way to act on it.
 *
 * On HISTOR's 2026-11-16 snapshot (468,359 tools with an explicit claim on 26,808 servers) it marks 307 tools that say
 * readOnlyHint true (204 servers) and 960 that say destructiveHint false (593 servers); in a hand-labelled sample of 50
 * each, 40 and 45 were real contradictions. Recall was not measured.
 */
import type { ToolDef, WardenFinding } from "./types.js";
import { displaySafe } from "./sanitize.js";

export type HintClaim = "readOnlyHint=true" | "destructiveHint=false";

export interface HintContradiction {
  tool: string;
  claim: HintClaim;
  /** What the description says the tool does, as matched: "deletes", "replaces the current …", "cannot be undone". */
  says: string;
  /** The sentence it was read in, shortened. */
  quote: string;
}

// Verbs that change something. Imperative forms ("Delete a file") count only in a description's first sentence: later
// imperatives usually instruct the caller ("Edit one first with update_reply_draft", "Remove names before pasting",
// "Send the file as base64"). Third-person forms ("Deletes …", "Writes the YAML to disk") count in any sentence.
// Calibrated on HISTOR's 2026-11-16 snapshot (artifacts/hint-description-contradictions-2026-11-20): "execute",
// "submit", "run", "follow", "like/unlike", "order", "block", "sign", "star", "subscribe", "assign", "drop",
// "truncate" and a leading "replace" read far more often as queries, filters, classifications, prepositions or caller
// instructions than as writes, so they are left out (under destructiveHint false, "drop" and "truncate" still count).
const WRITE = [
  "create", "update", "delete", "overwrite", "modify", "insert", "upload", "publish", "cancel", "rename",
  "archive", "deploy", "install", "uninstall", "purge", "wipe", "erase", "destroy", "revoke", "transfer", "pay",
  "charge", "refund", "withdraw", "deposit", "burn", "approve", "merge", "commit", "push", "kill", "terminate",
  "restart", "edit", "save", "append", "enable", "disable", "grant", "invite", "patch", "unlock", "ban",
  "mute", "unmute", "unfollow", "book", "set", "store", "move", "close", "lock", "send", "post", "write", "reset",
  "purchase",
];
// Verbs that lose or overwrite data: the destructive subset.
const DESTROY = [
  "delete", "remove", "overwrite", "purge", "drop", "truncate", "wipe", "erase", "destroy", "revoke", "terminate",
  "kill", "uninstall", "burn",
];

function forms(verbs: string[]): Map<string, string> {
  // form → base verb
  const out = new Map<string, string>();
  for (const v of verbs) {
    out.set(v, v);
    if (/(s|sh|ch|x|z)$/.test(v)) out.set(`${v}es`, v);
    else if (/[^aeiou]y$/.test(v)) out.set(`${v.slice(0, -1)}ies`, v);
    else out.set(`${v}s`, v);
  }
  return out;
}

const WRITE_FORMS = forms(WRITE);
const DESTROY_FORMS = forms(DESTROY);
// Some verbs are also nouns or adjectives ("Set of …", "Close prices", "Lock status", "Store locations", "Charge
// points", "Drops below …", "Move history") or name an act that changes nothing outside the call ("Create text
// embeddings", "Create voiceovers"). They count only with an article, a possessive or a quantifier after them.
const NEEDS_DETERMINER = new Set(["set", "store", "close", "lock", "charge", "book", "move", "drop", "push", "patch", "commit",
  "transfer", "deposit", "update", "reset", "burn", "archive", "edit", "save", "pay", "merge", "create", "truncate", "drop",
  "enable", "disable", "purchase", "approve", "install", "cancel", "refund", "grant", "invite"]);
const DETERMINER = /^(?:a|an|the|this|these|those|one|all|any|each|every|multiple|several|some|new|your|their|its|his|her|my|our|existing|current|specified|given|selected|provided)\b/i;
// Verbs that only count with what they act on, within the next six words: "Send a message", "Posts a comment",
// "Writes the YAML to disk", "Create a new player account"; not "Send the audio as base64", "Posts in a group's feed",
// "Write a whole number out in English words", "Create a chart from CSV text" (a create that only makes output).
// Things whose creation, change or removal changes something outside the call. Under readOnlyHint true, "create",
// "update", "upload" and "remove" count only with one of these in the next six words: "Removes duplicate lines",
// "Update a prior probability", "Upload a portrait photo for analysis" are transformations or analyses.
const RESOURCE = /\b(?:accounts?|users?|issues?|tickets?|repo(?:sitor(?:y|ies))?s?|branch(?:es)?|pull requests?|webhooks?|hooks?|integrations?|records?|entr(?:y|ies)|files?|folders?|director(?:y|ies)|databases?|tables?|buckets?|projects?|orders?|invoices?|payments?|posts?|comments?|messages?|events?|channels?|api keys?|ssh keys?|tokens?|subscriptions?|instances?|servers?|clusters?|deployments?|releases?|tags?|labels?|groups?|teams?|contacts?|tasks?|campaigns?|wallets?|transactions?|domains?|dns records?|routes?|rules?|polic(?:y|ies)|secrets?|volumes?|snapshots?|backups?|jobs?|profiles?|settings|status|preferences|config(?:uration)?s?|members?|memberships?|admins?|roles?|permissions?|favou?rites?|liquidity|positions?|votes?|monitors?|schedules?|alerts?|notes?|documents?|pages?|items?|products?|listings?|bookings?|reservations?|appointments?|meetings?|emails?)\b/i;
const NEEDS_OBJECT: Record<string, RegExp> = {
  create: RESOURCE, update: RESOURCE, upload: RESOURCE, save: RESOURCE, merge: RESOURCE, move: RESOURCE, close: RESOURCE,
  send: /\b(?:messages?|e-?mails?|mail|sms|texts?|notifications?|repl(?:y|ies)|invit(?:e|ations?)|dms?|tweets?|transactions?|payments?|funds|tokens|money|webhooks?)\b/i,
  post: /\b(?:messages?|comments?|repl(?:y|ies)|tweets?|status|updates?|reviews?|articles?|to (?:the |a )?(?:channel|thread|feed|timeline|slack|discord|x|twitter))\b/i,
  write: /\b(?:to|into) (?:the |a |an )?(?:disk|file|files|folder|directory|database|db|table|storage|bucket|repo|repository|chain|ledger|output|path)\b|\bfiles?\b|\bon-?chain\b|\battestation\b|res:\/\//i,
};
// A sentence that describes what the tool does NOT do, or only previews.
const NOT_DONE = /\b(?:preview|dry[- ]?run|in-memory|simulat(?:e|es|ion)|without (?:touching|modifying|changing|writing|saving|deleting|sending|creating|affecting|overwriting|replacing|removing)|does ?n[o']t|do ?n[o']t|never|no side[- ]effects?|zero[- ]side[- ]effect|read-only|in the response only|nothing is (?:stored|saved|written|edited|changed)|refuses? to|not (?:yet )?(?:implemented|supported))\b/i;

// The tool as subject: "This tool deletes", "This endpoint will overwrite", "Will permanently delete", "It removes".
const SUBJECT = /^(?:(?:this|the)\s+(?:tool|function|endpoint|action|operation|command|method|call)\s+|it\s+)?(?:will\s+)?(?:also\s+|permanently\s+|irreversibly\s+|immediately\s+)?/i;

const PERMANENT = /\b(?:cannot be undone|can ?not be reversed|is irreversible|are irreversible|irreversibly|permanently (?:deletes?|removes?|erases?|destroys?)|this action is permanent)\b/i;
const REPLACES_ALL = /\breplac(?:es|e|ing) (?:the |all (?:the |of the )?|any )?(?:current|existing|entire|whole|full|previous|old)\b|\boverwrit(?:es|e|ing) (?:the |any |all )?(?:existing|current|previous)\b/i;
// "replaces the whole label set" is destructive; "Replaces 8–15 sequential lookups" or "replaces placeholders in the
// template you pass" is not: REPLACES_ALL needs one of the words above right after the article.

function sentences(text: string): string[] {
  // Markdown headings, bullets and line breaks start a new sentence; so does ". " / "! " / "? " / ": ".
  return text.replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+|(?<=:)\s+(?=[A-Z])/)
    .map(s => s.replace(/^[\s#>*\-•\d.)(]+/, "").replace(/^\*\*|\*\*$/g, "").trim())
    .filter(Boolean);
}

function leadingVerb(sentence: string, verbs: Map<string, string>, first: boolean, readOnly: boolean): string | undefined {
  const rest = sentence.replace(SUBJECT, "");
  const m = /^([A-Za-z]+)\b(?![-'])\s*(.*)$/.exec(rest);
  if (!m) return undefined;
  const form = m[1]!.toLowerCase();
  const base = verbs.get(form);
  if (!base) return undefined;
  const after = m[2] ?? "";
  // A verb before a colon or nothing is a heading or a label ("Update:", "Delete"), not a statement.
  if (!after || /^[:(]/.test(after)) return undefined;
  // "Removes are idempotent", "Creates nothing", "It writes no memory": a noun, or a statement of what it does not do.
  if (/^(?:[,;]|(?:are|is|was|were|and|or|of|no|nothing|none|not)\b)/i.test(after)) return undefined;
  // A sentence that starts in lower case is the tail of one the splitter cut ("e.g. …", "… updates these numbers").
  if (rest === sentence && !/^[A-Z]/.test(m[1]!)) return undefined;
  // The imperative is the base form; past the first sentence it usually tells the caller what to do.
  if (form === base && !first && rest === sentence) return undefined;
  if (NEEDS_DETERMINER.has(base) && !DETERMINER.test(after)) return undefined;
  // "Posts with applicant counts", "Bans grouped by reason", "Wipes detected across…", "Publishes about every 5
  // minutes": a third-person form is also a plural noun. It counts only with an article or a thing right after it
  // ("Deletes one or more rows", "Writes definition files to …").
  if (form !== base && !DETERMINER.test(after) && !RESOURCE.test(after.split(/\s+/).slice(0, 3).join(" "))) return undefined;
  const object = readOnly || !["remove", "update"].includes(base) ? NEEDS_OBJECT[base] : undefined;
  if (readOnly && base === "create" && /\b(?:url|link|qr|from (?:structured |the |your )?(?:data|input|text))\b/i.test(after)) return undefined;
  // "Removes the background", "Remove EXIF … from a photo": an edit of the input, not a loss of stored data.
  if (base === "remove" && /^(?:the |all |any )?(?:image |photo )?(?:background|whitespace|noise|exif|metadata|watermarks?|duplicates?|formatting|blank)/i.test(after)) return undefined;
  if (object && !object.test(after.split(/\s+/).slice(0, 6).join(" "))) return undefined;
  return form;
}

function quote(sentence: string): string {
  return displaySafe(sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence, 170);
}

/** Every contradiction between a tool's hints and its own description. Empty when the tool makes no such claim. */
export function hintContradictions(tool: Pick<ToolDef, "name" | "description" | "annotations">): HintContradiction[] {
  const a = tool.annotations;
  if (!a || typeof a !== "object" || Array.isArray(a)) return [];
  const readOnly = a.readOnlyHint === true;
  // destructiveHint only means something when readOnlyHint is not true (MCP specification).
  const notDestructive = !readOnly && a.destructiveHint === false;
  if (!readOnly && !notDestructive) return [];
  const text = typeof tool.description === "string" ? tool.description : "";
  if (!text) return [];
  const claim: HintClaim = readOnly ? "readOnlyHint=true" : "destructiveHint=false";
  // "Read this before editing: update_modifier replaces the whole list" describes another tool. A snake_case or
  // backticked name other than this tool's, before the match, means the sentence is about that one.
  const aboutOther = (sentence: string, at: number) => [...sentence.slice(0, at).matchAll(/`([^`]+)`|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/gi)]
    .some(m => (m[1] ?? m[2]) !== tool.name);
  for (const [i, s] of sentences(text).entries()) {
    if (NOT_DONE.test(s)) continue;
    const verb = leadingVerb(s, readOnly ? WRITE_FORMS : DESTROY_FORMS, i === 0, readOnly);
    if (verb) return [{ tool: tool.name, claim, says: verb, quote: quote(s) }];
    if (readOnly) continue;
    const permanent = PERMANENT.exec(s);
    if (permanent && !aboutOther(s, permanent.index)) return [{ tool: tool.name, claim, says: permanent[0].toLowerCase(), quote: quote(s) }];
    const all = REPLACES_ALL.exec(s);
    if (all && !aboutOther(s, all.index)) return [{ tool: tool.name, claim, says: `${all[0].toLowerCase()} …`, quote: quote(s) }];
  }
  return [];
}

/** Scan findings: advisory, so they never block and never cost a tool at any `blockAtSeverity`. */
export function hintContradictionFindings(tools: readonly ToolDef[]): WardenFinding[] {
  return tools.flatMap(hintContradictions).map(c => ({
    gate: "annotations", severity: c.claim === "readOnlyHint=true" ? "medium" : "low", code: "TOOL_HINT_CONTRADICTS_DESCRIPTION",
    advisory: true, tool: c.tool,
    // The quote is a sentence and usually ends with its own full stop: no second one after the closing quote.
    message: `The server marks this tool ${c.claim}, but its own description says it ${c.says}: "${c.quote}"${/[.!?…]$/.test(c.quote) ? "" : "."} ` +
      (c.claim === "readOnlyHint=true"
        ? "A host that skips approval for read-only tools would not ask before this call. "
        : "A host that asks only before destructive tools would not ask before this call. ") +
      "Hints are the server's word; a fingerprint or lock keeps a wrong hint as stable as a right one. Label the tool yourself (flow policy labels).",
  }));
}
