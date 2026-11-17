import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// The OpenWebUI adapter is Python (integrations/openwebui); its unit tests use the standard library only.
const python = ['python3', 'python'].find(p => spawnSync(p, ['--version']).status === 0);

describe('OpenWebUI adapter (Python)', () => {
  it.skipIf(!python)('passes its unit tests', () => {
    const r = spawnSync(python!, ['-m', 'unittest', 'discover', '-s', 'tests'], { cwd: join(__dirname, '..', 'integrations', 'openwebui'), encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).toMatch(/\nOK\s*$/);
    expect(r.status).toBe(0);
  }, 130_000);
});
