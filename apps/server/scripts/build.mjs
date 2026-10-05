// Bundles the server into a single ESM file with no runtime node_modules.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  entryPoints: [`${root}src/index.ts`],
  outfile: `${root}dist/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
  // Some CommonJS dependencies call require(); give them one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
