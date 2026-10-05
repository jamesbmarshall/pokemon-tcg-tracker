#!/usr/bin/env node
// One-off: creates the Ed25519 key pair that signs release bundles.
//
//   node scripts/gen-update-key.mjs [private-key-output-path]
//
// Writes the public key to deploy/update-public-key.pem (commit it: it's baked into the image)
// and the private key to the given path (default: ./update-signing-key.pem, which is git-ignored).
// Paste the private key into the repository's UPDATE_SIGNING_KEY Actions secret, then delete the file.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pubFile = join(root, 'deploy/update-public-key.pem');
const privFile = resolve(process.argv[2] ?? join(root, 'update-signing-key.pem'));
// Never overwrite an existing private key: once it is lost, no release can be signed that
// existing installs will accept until they pull an image with the new public key.
if (existsSync(privFile)) {
  console.error(`${privFile} already exists; refusing to overwrite it.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// 0600: owner-only, as this key can publish code that every install will run.
writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Public key:  ${pubFile} (commit this)`);
console.log(`Private key: ${privFile} (add it as the UPDATE_SIGNING_KEY Actions secret, then delete this file)`);
console.log('Images built before this change trust the old key, so existing installs need to pull a new image once.');
