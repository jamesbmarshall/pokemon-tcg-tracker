#!/usr/bin/env node
/**
 * Keeps package-lock.json installable from any npm registry.
 *
 * npm records the URL each tarball was downloaded from. On a machine whose npm is pointed at a
 * managed feed or corporate mirror, that URL names the mirror, and the lockfile then fails to
 * install anywhere the mirror is unreachable. Registry packages need no URL at all: npm looks
 * the tarball up in whichever registry is configured and still verifies it against the
 * recorded `integrity` hash. `.npmrc` sets omit-lockfile-registry-resolved so npm stops writing
 * the URLs; this script enforces it, because an npm run with that setting overridden, or a tool
 * that ignores `.npmrc`, would quietly put them back.
 *
 *   node scripts/lockfile-registry.mjs          check; exits 1 and lists offenders
 *   node scripts/lockfile-registry.mjs --fix    rewrite package-lock.json in place
 *
 * No dependencies, so CI can run it before `npm ci`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package-lock.json');
const fix = process.argv.includes('--fix');

/**
 * A registry tarball URL always ends `/<name>/-/<file>.tgz`, whatever the host or path prefix.
 * Anything else (git, a direct tarball URL, a local file) is the dependency's real source and
 * must be kept.
 */
function isRegistryTarball(path, resolved) {
  // "node_modules/a/node_modules/@scope/b" -> "@scope/b"
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  let url;
  try { url = new URL(resolved); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return decodeURIComponent(url.pathname).includes(`/${name}/-/`) && url.pathname.endsWith('.tgz');
}

const text = readFileSync(file, 'utf8');
const lock = JSON.parse(text);
const offenders = [];
const missingIntegrity = [];

for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  // Workspace links and the root project have no tarball.
  if (!path.includes('node_modules/') || entry.link) continue;
  if (typeof entry.resolved === 'string' && isRegistryTarball(path, entry.resolved)) {
    offenders.push({ path, host: new URL(entry.resolved).host });
    if (fix) delete entry.resolved;
  }
  // Without a URL the hash is the only thing pinning the bytes, so it has to be there.
  if (!entry.resolved && !entry.integrity && !entry.inBundle) missingIntegrity.push(path);
}

if (missingIntegrity.length) {
  console.error(`package-lock.json: ${missingIntegrity.length} package(s) have neither a source URL nor an integrity hash:`);
  for (const path of missingIntegrity.slice(0, 20)) console.error(`  ${path}`);
  console.error('Run `npm install` to regenerate them. Nothing was changed.');
  process.exit(1);
}

if (!offenders.length) {
  console.log('package-lock.json is registry-neutral.');
  process.exit(0);
}

const hosts = new Map();
for (const { host } of offenders) hosts.set(host, (hosts.get(host) ?? 0) + 1);
const summary = [...hosts].map(([host, n]) => `${n} from ${host}`).join(', ');

if (fix) {
  // Match npm's own formatting (two spaces, trailing newline) so the next npm run is a no-op.
  writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`package-lock.json: removed ${offenders.length} registry URL(s) (${summary}).`);
  process.exit(0);
}

console.error(`package-lock.json records ${offenders.length} registry URL(s) (${summary}).`);
console.error('These make installs depend on one particular registry. Run: npm run lockfile:fix');
process.exit(1);
