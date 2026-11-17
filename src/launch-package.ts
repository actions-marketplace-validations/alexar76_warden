/**
 * The npm or PyPI packages named directly by a stdio launch line.
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
/** Options with operands, which are not the command or additional packages. */
const NPM_VALUE_FLAGS = new Set([
  '--cache', '--cache-dir', '--cwd', '--userconfig', '--globalconfig', '--prefix', '--node-options',
  '--call', '--shell', '--script-shell', '--workspace', '-w', '--filter', '--dir', '-C',
  '--env-file', '--minimum-release-age', '--loglevel', '--tag', '--otp', '--proxy', '--https-proxy',
]);
const UV_VALUE_FLAGS = new Set([
  '--with-requirements', '--constraints', '--constraint', '-c', '--build-constraints', '--build-constraint',
  '-b', '--overrides', '--python', '-p', '--python-platform', '--cache-dir', '--env-file', '--project',
  '--directory', '--config-file', '--color', '--allow-insecure-host', '--index-strategy', '--keyring-provider',
  '--torch-backend', '--resolution', '--prerelease', '--fork-strategy', '--exclude-newer', '--exclude-newer-package',
  '--link-mode', '--config-setting', '--config-settings-package', '-C', '--upgrade-package', '-P', '--upgrade-group',
  '--refresh-package', '--reinstall-package', '--no-sources-package', '--no-build-isolation-package',
  '--no-build-package', '--no-binary-package',
]);
const PIPX_VALUE_FLAGS = new Set([
  '--python', '--python-args', '--fetch-python', '--pip-args', '--backend', '--cooldown',
]);
const PYPI_INDEX_FLAGS = new Set(['--index-url', '-i', '--default-index', '--index', '--extra-index-url', '--find-links', '-f']);
const NON_REGISTRY = /^(?:file:|git[+:]|github:|link:|workspace:|\.|\/|~|[A-Za-z]:\\)/;

export function normalisePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** The primary package for a single package lookup, such as HISTOR. */
export function launchPackage(command: string, args: readonly string[]): LaunchPackage {
  return launchPackages(command, args)[0]!;
}

/** The primary spec first, then any additional explicit package specs. */
export function launchPackages(command: string, args: readonly string[]): LaunchPackage[] {
  const base = (command.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(cmd|exe|ps1)$/, '');
  if (base === 'npx' || base === 'bunx' || base === 'uvx') return packageSpecs(base, args);
  if ((base === 'npm' && (args[0] === 'exec' || args[0] === 'x')) ||
      ((base === 'pnpm' || base === 'yarn') && args[0] === 'dlx') ||
      (base === 'bun' && args[0] === 'x') || (base === 'pipx' && args[0] === 'run')) {
    return packageSpecs(base, args.slice(1));
  }
  if (base === 'uv' && args[0] === 'tool' && args[1] === 'run') return packageSpecs('uvx', args.slice(2));
  return [{ reason: 'not started from a package manager (npx, uvx …)' }];
}

function packageSpecs(base: string, rest: readonly string[]): LaunchPackage[] {
  const kind = base === 'uvx' || base === 'pipx' ? 'pypi' : 'npm';
  const valueFlags = base === 'uvx' ? UV_VALUE_FLAGS : base === 'pipx' ? PIPX_VALUE_FLAGS : NPM_VALUE_FLAGS;
  const explicit: string[] = [], extras: string[] = [];
  let executable: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--') { executable ??= rest[i + 1]; break; }
    if (!a.startsWith('-')) {
      executable ??= a;
      // npm exec parses its own options anywhere before --. The other launchers forward
      // arguments after the executable, so server flags there must not influence the gate.
      if (base !== 'npm') break;
      continue;
    }
    const eq = a.indexOf('=');
    let flag = eq === -1 ? a : a.slice(0, eq);
    let value = eq === -1 ? undefined : a.slice(eq + 1);
    // uv's short options can have an attached operand, as in -wextra or -p3.12.
    if (base === 'uvx' && /^-[wpcbiCfP].+/.test(flag)) {
      value = a.slice(2).replace(/^=/, '');
      flag = a.slice(0, 2);
    }
    if (flag === '--registry' && kind === 'npm') {
      value ??= rest[++i];
      if (!/^https:\/\/registry\.npmjs\.org\/?$/i.test(value ?? '')) return [{ reason: 'a private registry' }];
      continue;
    }
    if (kind === 'pypi' && PYPI_INDEX_FLAGS.has(flag)) {
      value ??= rest[++i];
      if (flag === '-f' || flag === '--find-links' || !/^https:\/\/pypi\.org\/simple\/?$/i.test(value ?? '')) return [{ reason: 'a private registry' }];
      continue;
    }
    const packageFlag = kind === 'npm' && (flag === '--package' || (base !== 'npm' && flag === '-p') || (base === 'npx' && flag === '--p'));
    if (packageFlag || (base === 'uvx' && flag === '--from') || (base === 'pipx' && flag === '--spec')) {
      explicit.push(value ?? rest[++i] ?? '');
      continue;
    }
    if (kind === 'pypi' && (flag === '--with' || (base === 'uvx' && (flag === '-w' || flag === '--with-editable')))) {
      extras.push(...requirements(value ?? rest[++i] ?? ''));
      continue;
    }
    if (value === undefined && (valueFlags.has(flag) || (flag === '-c' && (base === 'npx' || base === 'npm')))) i++;
  }
  const specs = explicit.length ? explicit : [executable ?? ''];
  return [...specs, ...extras].map(spec => registryPackage(kind, spec));
}

/** A comma between requirements, excluding extras, specifier lists and quoted markers. */
function requirements(list: string): string[] {
  const out: string[] = [];
  let start = 0, inExtras = false, quote = '';
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === ']') inExtras = c === '[';
    else if (c === ',' && !inExtras && !/^\s*[<>=!~]/.test(list.slice(i + 1))) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

function registryPackage(kind: LaunchEcosystem, spec: string): LaunchPackage {
  if (!spec) return { reason: 'no package in the launch line' };
  if (spec.includes('://') || NON_REGISTRY.test(spec)) return { reason: 'not a registry package' };
  if (kind === 'npm') {
    if (spec.startsWith('npm:')) spec = spec.slice(4);
    let at = spec.indexOf('@', 1);
    if (at > 0 && NPM_PACKAGE.test(spec.slice(0, at)) && spec.startsWith('npm:', at + 1)) {
      spec = spec.slice(at + 5);
      at = spec.indexOf('@', 1);
    }
    const name = at > 0 ? spec.slice(0, at) : spec;
    const version = at > 0 ? spec.slice(at + 1).trim() : '';
    if (!NPM_PACKAGE.test(name) || /[:/\\]/.test(version) || /\.(tgz|tar\.gz)$/.test(version || name)) return { reason: 'not a registry package' };
    const exact = NPM_EXACT.exec(version.replace(/^=/, ''));
    return exact ? { ecosystem: 'npm', name, version: exact[1] } : { ecosystem: 'npm', name };
  }
  const name = spec.split(/[[=<>!~@; ]/)[0]!;
  if (!PYPI_PACKAGE.test(name)) return { reason: 'not a registry package' };
  // After the name and any [extras]: `==1.2`, `===1.2` or uv's `@1.2` pin one version; anything else does not.
  const after = spec.slice(name.length).replace(/^\[[^\]]*\]/, '').trim();
  const pin = /^(?:===?|@)\s*([^;]+)$/.exec(after.split(';', 1)[0]!.trimEnd());
  const exact = pin && !/[,;*\s]/.test(pin[1]!) ? PYPI_EXACT.exec(pin[1]!) : null;
  const version = exact && exact[1]!.toLowerCase() !== 'latest' ? exact[1]!.toLowerCase() : undefined;
  return version ? { ecosystem: 'pypi', name: normalisePypiName(name), version } : { ecosystem: 'pypi', name: normalisePypiName(name) };
}
