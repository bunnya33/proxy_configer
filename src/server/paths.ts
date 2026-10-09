import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleParentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const isSourceRuntime = basename(moduleParentDir) === 'src';
export const rootDir = process.env.APP_ROOT
  ? resolve(process.env.APP_ROOT)
  : isSourceRuntime ? resolve(moduleParentDir, '..') : moduleParentDir;
export const stateDir = process.env.APP_DATA_DIR ? resolve(process.env.APP_DATA_DIR) : rootDir;
export const adminConfigPath = resolve(stateDir, 'config/admin.json');
export const serverConfigPath = resolve(stateDir, 'config/server.json');
