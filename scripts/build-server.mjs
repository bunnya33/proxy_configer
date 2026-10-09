import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(projectRoot, 'src/server/index.ts'), resolve(projectRoot, 'src/server/manage.ts')],
  outdir: resolve(projectRoot, 'dist/server'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  }
});
