#!/usr/bin/env node
// Packages a built PokéTracker into the self-update bundle the launcher runs.
//
//   npm run build && npm run bundle                # release/bundle/ + release/poketracker-<v>.tar.gz(.sha256,.sig)
//   node scripts/make-bundle.mjs --stage-only      # just release/bundle/ (used by the Dockerfile)
//   node scripts/make-bundle.mjs --version 2.1.0   # override the version (defaults to package.json)
//
// Signing: set UPDATE_SIGNING_KEY to the Ed25519 private key PEM (an Actions secret in CI).
// Pass --require-signature to fail instead of producing an unsigned bundle.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as tar from 'tar';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(`make-bundle: ${msg}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = (opt('--version') || process.env.RELEASE_VERSION || pkg.version).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail(`"${version}" is not a semver version`);
const minLauncher = pkg.poketracker?.minLauncher ?? '1.0.0';

const serverDist = join(root, 'apps/server/dist');
const webDist = join(root, 'apps/web/dist');
if (!existsSync(join(serverDist, 'server.mjs'))) fail('apps/server/dist/server.mjs is missing. Run `npm run build` first.');
if (!existsSync(join(webDist, 'index.html'))) fail('apps/web/dist is missing. Run `npm run build` first.');

let commit = process.env.GITHUB_SHA ?? '';
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* not a git checkout */
  }
}

const out = join(root, 'release');
const stage = join(out, 'bundle');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(serverDist, 'server.mjs'), join(stage, 'server.mjs'));
if (existsSync(join(serverDist, 'server.mjs.map'))) cpSync(join(serverDist, 'server.mjs.map'), join(stage, 'server.mjs.map'));
cpSync(webDist, join(stage, 'web'), { recursive: true });
const manifest = { version, minLauncher, ...(commit && { commit }), builtAt: new Date().toISOString() };
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`make-bundle: staged ${version} in ${stage}`);
if (flag('--stage-only')) process.exit(0);

const name = `poketracker-${version}.tar.gz`;
const file = join(out, name);
const entries = ['manifest.json', 'server.mjs', ...(existsSync(join(stage, 'server.mjs.map')) ? ['server.mjs.map'] : []), 'web'];
await tar.c({ gzip: { level: 9 }, file, cwd: stage, portable: true, noMtime: true }, entries);
const bundle = readFileSync(file);
const digest = createHash('sha256').update(bundle).digest('hex');
writeFileSync(`${file}.sha256`, `${digest}  ${name}\n`);
console.log(`make-bundle: wrote ${name} (${(bundle.length / 1024 / 1024).toFixed(1)} MB, sha256 ${digest})`);

const pem = process.env.UPDATE_SIGNING_KEY?.trim();
if (!pem) {
  if (flag('--require-signature')) fail('UPDATE_SIGNING_KEY is not set, so the bundle cannot be signed');
  rmSync(`${file}.sig`, { force: true });
  console.warn('make-bundle: UPDATE_SIGNING_KEY not set; bundle is unsigned and in-app updates will refuse it');
  process.exit(0);
}
const key = createPrivateKey(pem);
if (key.asymmetricKeyType !== 'ed25519') fail('UPDATE_SIGNING_KEY must be an Ed25519 private key');
const signature = sign(null, bundle, key);
// Catch a secret that doesn't match the public key baked into the image before anything is published.
const pubFile = join(root, 'deploy/update-public-key.pem');
if (existsSync(pubFile) && readFileSync(pubFile, 'utf8').includes('BEGIN PUBLIC KEY')) {
  if (!verify(null, bundle, createPublicKey(readFileSync(pubFile, 'utf8')), signature)) fail('UPDATE_SIGNING_KEY does not match deploy/update-public-key.pem');
}
writeFileSync(`${file}.sig`, `${signature.toString('base64')}\n`);
console.log(`make-bundle: signed ${name}`);
