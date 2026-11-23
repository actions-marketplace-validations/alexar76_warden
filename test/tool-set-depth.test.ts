import { describe, expect, it } from 'vitest';
import { canonicalize, CanonicalizationError } from '../src/jcs.js';
import { mtlToolSetDigest, MtlError } from '../src/mtl.js';
import { contractDigest, definitionText, extrasDigest, perToolContract, ToolSetDigestError } from '../src/tool-set-digest.js';

// mcp-tool-set-digest/1 section 12 (MTL/1 section 5.4): every level up to 512 is digested, counting
// the tools array as 1; past it the digest that covers the value has none (TSD-DEPTH / MTL-SUBJ-005).
// The edges are CrawlCheck's (alexar76/mcp-tool-set-digest#1); the digests are the ones the three
// reference implementations of the specification give for the same text.
const nest = (n: number): string => '['.repeat(n) + '0' + ']'.repeat(n);
const schema = (n: number): unknown[] => JSON.parse(`[{"name":"t","inputSchema":{"x":${nest(n)}}}]`);
const extra = (n: number): unknown[] => JSON.parse(`[{"name":"t","x":${nest(n)}}]`);
const BARE_TOOL = 'sha256-88Wu+RBqslXnbKusDxk1TtLT0D2iT/d07h7ia5bzX2U=';

const code = (f: () => unknown): string | undefined => {
  try { f(); return undefined; } catch (err) { return (err as { code?: string }).code; }
};

describe('tool-set digests at depth', () => {
  it('digest 512 levels on the contract side and refuse 513', () => {
    expect(contractDigest(schema(509))).toBe('sha256-U2SmamxwXvZ4K/aIwTKEH/uhwN0VOxAwt0IhxlX+UmQ=');
    expect(mtlToolSetDigest(schema(509) as never)).toBe('sha256-U2SmamxwXvZ4K/aIwTKEH/uhwN0VOxAwt0IhxlX+UmQ=');
    expect(code(() => contractDigest(schema(510)))).toBe('TSD-DEPTH');
    expect(code(() => mtlToolSetDigest(schema(510) as never))).toBe('MTL-SUBJ-005');
  });

  it('digest 512 levels on the extras side and refuse 513, keeping the contract digest', () => {
    expect(extrasDigest(extra(510))).toBe('sha256-u9+5RoEzzedMMN38Hb1j9DSpbEqiP9z7EorWMvb4glk=');
    expect(code(() => extrasDigest(extra(511)))).toBe('TSD-DEPTH');
    expect(contractDigest(extra(511))).toBe(BARE_TOOL);
  });

  it('answers at 100,000 levels without a crash', () => {
    expect(code(() => contractDigest(schema(100_000)))).toBe('TSD-DEPTH');
    expect(code(() => extrasDigest(extra(100_000)))).toBe('TSD-DEPTH');
    expect(code(() => perToolContract(schema(100_000)))).toBe('TSD-DEPTH');
    expect(definitionText(schema(100_000)[0])).toEqual({ code: 'TSD-DEPTH' });
  });

  it('a deep value the contract entry does not carry does not count', () => {
    const tools = JSON.parse(`[{"name":"t","description":${nest(100_000)}}]`);
    expect(contractDigest(tools)).toBe(BARE_TOOL);
  });

  it('errors are typed: TSD-DEPTH is a ToolSetDigestError, MTL-SUBJ-005 an MtlError', () => {
    expect(() => contractDigest(schema(600))).toThrow(ToolSetDigestError);
    expect(() => mtlToolSetDigest(schema(600) as never)).toThrow(MtlError);
  });

  it('AWR documents keep the canonicaliser bound of 64', () => {
    const deep = JSON.parse(nest(70));
    expect(() => canonicalize(deep)).toThrow(CanonicalizationError);
  });
});
