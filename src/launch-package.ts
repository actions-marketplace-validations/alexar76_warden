/**
 * The npm or PyPI package a stdio launch line runs.
 *
 * `npx -y some-mcp@1.2.3`, `uvx --from 'pkg==1.0' pkg`, `pnpm dlx @a/b` and the like name a
 * package from the public registry. A local path, a git or tarball URL, or a private registry
 * (`--registry`, `--index-url`) names nothing a public list could know, so it is reported with
 * the reason and no name. Used by HISTOR lookups and by the known-malicious package list.
 */

export type LaunchEcosystem = 'npm' | 'pypi';

export interface LaunchPackage {
  ecosystem?: LaunchEcosystem;
  /** npm: as written; PyPI: lower case with runs of `-_.` folded to `-` (PEP 503). */
  name?: string;
  /** Set only when the launch pins one exact version; a tag or range leaves it unset. */
  version?: string;
  /** Why no registry package was read from the launch line. */
  reason?: string;
}

const NPM_PACKAGE = /^(@[a-z0-9][a-z0-9._~-]{0,100}\/)?[a-z0-9][a-z0-9._~-]{0,100}$/;
const PYPI_PACKAGE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const NPM_EXACT = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/;
const PYPI_EXACT = /^v?([0-9][0-9A-Za-z.!+_-]{0,63})$/;
/** Launcher flags that take a value, so the value is not mistaken for the package. */
const VALUE_FLAGS = new Set(['--python', '-p', '--with', '-w', '--with-requirements', '--cache', '--node-options', '--call', '-c', '--spec', '--pip-args']);

export function normalisePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export function launchPackage(command: string, args: readonly string[]): LaunchPackage {
  const base = (command.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(cmd|exe|ps1)$/, '');
  let rest = [...args];
  let kind: LaunchEcosystem;
  if (base === 'npx' || base === 'bunx') kind = 'npm';
  else if ((base === 'npm' && rest[0] === 'exec') || ((base === 'pnpm' || base === 'yarn') && rest[0] === 'dlx') || (base === 'bun' && rest[0] === 'x')) { kind = 'npm'; rest = rest.slice(1); }
  else if (base === 'uvx') kind = 'pypi';
  else if (base === 'uv' && rest[0] === 'tool' && rest[1] === 'run') { kind = 'pypi'; rest = rest.slice(2); }
  else if (base === 'pipx' && rest[0] === 'run') { kind = 'pypi'; rest = rest.slice(1); }
  else return { reason: 'not started from a package manager (npx, uvx …)' };
  let spec: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (/^--(registry|index-url|index|extra-index-url|find-links)(=|$)|^-i$|^-f$/.test(a)) return { reason: 'a private registry' };
    if (a === '--') { spec = rest[i + 1]; break; }
    if (a === '--package' || a === '--from' || (kind === 'npm' && a === '-p')) { spec = rest[i + 1]; break; }
    if (a.startsWith('--package=') || a.startsWith('--from=')) { spec = a.slice(a.indexOf('=') + 1); break; }
    if (a.startsWith('-')) { if (VALUE_FLAGS.has(a)) i++; continue; }
    spec = a; break;
  }
  if (!spec) return { reason: 'no package in the launch line' };
  if (spec.includes('://') || /^(file:|git[+:]|github:|link:|workspace:|\.|\/|~|[A-Za-z]:\\)/.test(spec)) return { reason: 'not a registry package' };
  if (kind === 'npm') {
    const at = spec.indexOf('@', 1);
    const name = at > 0 ? spec.slice(0, at) : spec;
    if (!NPM_PACKAGE.test(name)) return { reason: 'not a registry package' };
    const exact = at > 0 ? NPM_EXACT.exec(spec.slice(at + 1).replace(/^=/, '')) : null;
    return exact ? { ecosystem: 'npm', name, version: exact[1] } : { ecosystem: 'npm', name };
  }
  const name = spec.split(/[[=<>!~@; ]/)[0]!;
  if (!PYPI_PACKAGE.test(name)) return { reason: 'not a registry package' };
  // After the name and any [extras]: `==1.2`, `===1.2` or uv's `@1.2` pin one version; anything else does not.
  const after = spec.slice(name.length).replace(/^\[[^\]]*\]/, '').trim();
  const pin = /^(?:===?|@)\s*(.+)$/.exec(after);
  const exact = pin && !/[,;*\s]/.test(pin[1]!) ? PYPI_EXACT.exec(pin[1]!) : null;
  const version = exact && exact[1]!.toLowerCase() !== 'latest' ? exact[1]!.toLowerCase() : undefined;
  return version ? { ecosystem: 'pypi', name: normalisePypiName(name), version } : { ecosystem: 'pypi', name: normalisePypiName(name) };
}
