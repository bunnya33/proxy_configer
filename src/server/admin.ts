import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AdminConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionHours: number;
  [key: string]: unknown;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!validHash(hash)) return false;
  const [, salt, digest] = hash.split('$');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
}

export async function loadAdmin(path: string): Promise<AdminConfig> {
  const config = JSON.parse(await readFile(path, 'utf8')) as AdminConfig;
  if (!validHash(config.passwordHash) || typeof config.username !== 'string' || !config.username.trim() ||
      typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32 ||
      !Number.isFinite(config.sessionHours) || config.sessionHours <= 0) {
    throw new Error('管理员配置无效，请运行管理命令初始化或重置账号');
  }
  return config;
}

export async function initializeAdmin(path: string): Promise<{ username: string; password: string } | undefined> {
  const config = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const original = JSON.stringify(config);
  const legacyPassword = typeof config.password === 'string' && config.password.length > 0 ? config.password : undefined;
  let credentials: { username: string; password: string } | undefined;
  if (!validHash(config.passwordHash)) {
    if (config.passwordHash !== undefined) throw new Error('密码哈希无效，拒绝覆盖现有管理员配置');
    if (legacyPassword) {
      config.passwordHash = hashPassword(legacyPassword);
    } else {
      credentials = randomCredentials();
      config.username = credentials.username;
      config.passwordHash = hashPassword(credentials.password);
    }
    config.sessionSecret = randomBytes(32).toString('hex');
  }
  delete config.password;
  if (typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32) {
    config.sessionSecret = randomBytes(32).toString('hex');
  }
  if (config.sessionHours === undefined) config.sessionHours = 12;
  // Write only when migration or initialization is needed, preserving established accounts.
  if (JSON.stringify(config) !== original) {
    await writeJson(path, config);
  }
  await chmod(path, 0o600);
  await loadAdmin(path);
  return credentials;
}

export function randomCredentials(): { username: string; password: string } {
  return { username: `admin_${randomBytes(5).toString('hex')}`, password: `Aa9!${randomBytes(24).toString('base64url')}` };
}

export async function setAdmin(path: string, username: string, password: string): Promise<void> {
  if (!/^[\p{L}\p{N}_.@-]{3,64}$/u.test(username)) {
    throw new Error('账号须为 3-64 位字母、数字或 _ . @ -');
  }
  if (password.length < 12 || password.length > 256 || /[\r\n\0]/.test(password)) {
    throw new Error('密码须为 12-256 位，不能包含换行或空字符');
  }
  const config = await loadAdmin(path);
  await writeJson(path, {
    ...config,
    username,
    passwordHash: hashPassword(password),
    sessionSecret: randomBytes(32).toString('hex')
  });
}
