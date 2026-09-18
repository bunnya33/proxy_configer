import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(projectRoot, 'dist');
const sourceManifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));

await mkdir(resolve(distDir, 'config'), { recursive: true });
await mkdir(resolve(distDir, 'data'), { recursive: true });
await cp(resolve(projectRoot, 'config'), resolve(distDir, 'config'), { recursive: true, force: true });
await cp(resolve(projectRoot, 'data'), resolve(distDir, 'data'), { recursive: true, force: true });
await copyFile(resolve(projectRoot, 'bunnya.yaml'), resolve(distDir, 'bunnya.yaml'));
await copyFile(resolve(projectRoot, 'DEPLOY.md'), resolve(distDir, 'DEPLOY.md'));

const runtimeManifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  private: true,
  type: 'module',
  engines: { node: '>=20' },
  scripts: { start: 'node server/index.js' }
};

await writeFile(resolve(distDir, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');

console.log(`Deployable package created: ${distDir}`);
