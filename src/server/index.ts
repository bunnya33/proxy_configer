import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { parseDocument, type Document } from 'yaml';

import { initializeAdmin, loadAdmin, verifyPassword, type AdminConfig } from './admin.js';
import { adminConfigPath, isSourceRuntime, rootDir, serverConfigPath, stateDir } from './paths.js';

interface ServerConfig {
  host: string;
  port: number;
  cookieSecure?: boolean;
}

interface ConfigRecord {
  id: string;
  name: string;
  description: string;
  file: string;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ClashConfig {
  proxies?: Record<string, unknown>[];
  'proxy-groups'?: Record<string, unknown>[];
  rules?: string[];
  [key: string]: unknown;
}

interface RuleInput {
  type?: unknown;
  payload?: unknown;
  policy?: unknown;
  options?: unknown;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const webDir = resolve(rootDir, isSourceRuntime ? 'dist/web' : 'web');
const registryPath = resolve(stateDir, 'data/configs.json');
const templatePath = resolve(stateDir, 'bunnya.yaml');
const idPattern = /^[a-z0-9][a-z0-9-]{1,47}$/;
const writeQueues = new Map<string, Promise<void>>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const serverConfig = await readJson<ServerConfig>(serverConfigPath);
const port = Number(process.env.PORT ?? serverConfig.port);
const host = process.env.HOST ?? serverConfig.host;
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : Boolean(serverConfig.cookieSecure);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`config/server.json 中的端口无效: ${serverConfig.port}`);
}
if (typeof host !== 'string' || !host.trim()) {
  throw new Error('config/server.json 中的 host 不能为空');
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
}

async function queueWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((done) => {
    release = done;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  writeQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  }
}

function resolveConfigPath(file: string): string {
  const path = resolve(stateDir, file);
  if (path !== stateDir && !path.startsWith(`${stateDir}${sep}`)) {
    throw new HttpError(400, '配置文件路径无效');
  }
  return path;
}

async function loadRegistry(): Promise<ConfigRecord[]> {
  return readJson<ConfigRecord[]>(registryPath);
}

async function saveRegistry(records: ConfigRecord[]): Promise<void> {
  await queueWrite(registryPath, () => atomicWrite(registryPath, `${JSON.stringify(records, null, 2)}\n`));
}

async function findConfig(id: string): Promise<ConfigRecord> {
  const record = (await loadRegistry()).find((item) => item.id === id);
  if (!record) throw new HttpError(404, '配置不存在');
  return record;
}

async function touchConfig(id: string): Promise<void> {
  const records = await loadRegistry();
  const record = records.find((item) => item.id === id);
  if (record) {
    record.updatedAt = new Date().toISOString();
    await saveRegistry(records);
  }
}

async function ensureBootstrapFiles(): Promise<void> {
  const records = await loadRegistry();
  await Promise.all(
    records.map(async (record) => {
      const path = resolveConfigPath(record.file);
      try {
        await access(path);
      } catch {
        if (record.isTemplate) throw new Error(`默认模板不存在: ${path}`);
        await mkdir(dirname(path), { recursive: true });
        await copyFile(templatePath, path);
      }
    })
  );
}

async function loadDocument(record: ConfigRecord): Promise<{ doc: Document; data: ClashConfig }> {
  const source = await readFile(resolveConfigPath(record.file), 'utf8');
  const doc = parseDocument(source);
  if (doc.errors.length) throw new HttpError(422, `YAML 解析失败：${doc.errors[0].message}`);
  const data = doc.toJS() as ClashConfig;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(422, 'YAML 顶层必须是对象');
  }
  return { doc, data };
}

async function editDocument(
  id: string,
  mutator: (doc: Document, data: ClashConfig) => void
): Promise<ClashConfig> {
  const record = await findConfig(id);
  const path = resolveConfigPath(record.file);
  const result = await queueWrite(path, async () => {
    const { doc, data } = await loadDocument(record);
    mutator(doc, data);
    await atomicWrite(path, doc.toString({ lineWidth: 0 }));
    return doc.toJS() as ClashConfig;
  });
  await touchConfig(id);
  return result;
}

function requireArray<T>(value: T[] | undefined, field: string): T[] {
  if (!Array.isArray(value)) throw new HttpError(422, `${field} 必须是数组`);
  return value;
}

function requireIndex(raw: string, length: number): number {
  const index = Number.parseInt(raw, 10);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new HttpError(404, '项目不存在');
  }
  return index;
}

function validateProxy(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, '代理配置必须是对象');
  }
  const proxy = jsonClone(input as Record<string, unknown>);
  if (typeof proxy.name !== 'string' || !proxy.name.trim()) throw new HttpError(400, '代理名称不能为空');
  if (typeof proxy.type !== 'string' || !proxy.type.trim()) throw new HttpError(400, '代理类型不能为空');
  proxy.name = proxy.name.trim();
  proxy.type = proxy.type.trim();
  if ('port' in proxy) {
    const numericPort = Number(proxy.port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      throw new HttpError(400, '端口必须在 1 到 65535 之间');
    }
    proxy.port = numericPort;
  }
  return proxy;
}

function normalizeRule(input: RuleInput): string {
  const type = String(input.type ?? '').trim().toUpperCase();
  const payload = String(input.payload ?? '').trim();
  const policy = String(input.policy ?? '').trim();
  const options = Array.isArray(input.options)
    ? input.options.map((item) => String(item).trim()).filter(Boolean)
    : String(input.options ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  if (!type) throw new HttpError(400, '规则类型不能为空');
  if (!policy) throw new HttpError(400, '规则策略不能为空');
  if (type === 'MATCH' || type === 'FINAL') return [type, policy, ...options].join(',');
  if (!payload) throw new HttpError(400, '规则内容不能为空');
  return [type, payload, policy, ...options].join(',');
}

function splitRule(raw: string) {
  const parts = raw.split(',').map((part) => part.trim());
  const type = parts.shift() ?? '';
  if (type === 'MATCH' || type === 'FINAL') {
    return { raw, type, payload: '', policy: parts.shift() ?? '', options: parts };
  }
  return { raw, type, payload: parts.shift() ?? '', policy: parts.shift() ?? '', options: parts };
}

function policyOptions(data: ClashConfig): string[] {
  const groups = Array.isArray(data['proxy-groups']) ? data['proxy-groups'] : [];
  const names = groups
    .map((group) => group.name)
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
  return [...new Set(['DIRECT', ...names, 'REJECT', 'REJECT-DROP', 'PASS'])];
}

function parseCookies(req: Request): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((item) => item.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [decodeURIComponent(key), decodeURIComponent(value)])
  );
}

function signToken(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function createToken(config: AdminConfig): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: config.username, exp: Date.now() + config.sessionHours * 60 * 60 * 1000 })
  ).toString('base64url');
  return `${payload}.${signToken(payload, config.sessionSecret)}`;
}

function verifyToken(token: string, config: AdminConfig): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, signToken(payload, config.sessionSecret))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    return parsed.sub === config.username && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const config = await loadAdmin(adminConfigPath);
  const token = parseCookies(req).clash_admin_session ?? '';
  if (!verifyToken(token, config)) throw new HttpError(401, '登录已失效，请重新登录');
  next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  );
  next();
});

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.resetAt > now && attempt.count >= 8) {
    throw new HttpError(429, '尝试次数过多，请稍后再试');
  }
  const config = await loadAdmin(adminConfigPath);
  const username = String(req.body?.username ?? '');
  const password = String(req.body?.password ?? '');
  if (!safeEqual(username, config.username) || !verifyPassword(password, config.passwordHash)) {
    const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60 * 1000 };
    current.count += 1;
    loginAttempts.set(ip, current);
    throw new HttpError(401, '账号或密码错误');
  }
  loginAttempts.delete(ip);
  res.cookie('clash_admin_session', createToken(config), {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure,
    maxAge: config.sessionHours * 60 * 60 * 1000,
    path: '/'
  });
  res.json({ username: config.username });
});

app.get('/api/auth/session', async (req, res) => {
  const config = await loadAdmin(adminConfigPath);
  const valid = verifyToken(parseCookies(req).clash_admin_session ?? '', config);
  if (!valid) throw new HttpError(401, '未登录');
  res.json({ username: config.username });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('clash_admin_session', { path: '/' });
  res.status(204).end();
});

app.get('/subscribe/:id', async (req, res) => {
  const record = await findConfig(req.params.id);
  if (record.isTemplate) throw new HttpError(404, '订阅不存在');
  const source = await readFile(resolveConfigPath(record.file));
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="${record.id}.yaml"`);
  res.send(source);
});

app.get('/bunnya.yaml', async (_req, res) => {
  const source = await readFile(templatePath);
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(source);
});

app.use('/api', requireAuth);

app.get('/api/configs', async (_req, res) => {
  const records = await loadRegistry();
  res.json(
    records.map((record) => ({
      ...record,
      subscribeUrl: record.isTemplate ? null : `/subscribe/${record.id}`
    }))
  );
});

app.post('/api/configs', async (req, res) => {
  const id = String(req.body?.id ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  if (!idPattern.test(id)) throw new HttpError(400, '路由标识只能使用 2-48 位小写字母、数字和连字符');
  if (!name) throw new HttpError(400, '配置名称不能为空');
  const records = await loadRegistry();
  if (records.some((record) => record.id === id)) throw new HttpError(409, '该路由标识已存在');
  const now = new Date().toISOString();
  const record: ConfigRecord = {
    id,
    name,
    description,
    file: `data/configs/${id}.yaml`,
    isTemplate: false,
    createdAt: now,
    updatedAt: now
  };
  await copyFile(templatePath, resolveConfigPath(record.file));
  records.push(record);
  try {
    await saveRegistry(records);
  } catch (error) {
    await rm(resolveConfigPath(record.file), { force: true });
    throw error;
  }
  res.status(201).json({ ...record, subscribeUrl: `/subscribe/${record.id}` });
});

app.patch('/api/configs/:id', async (req, res) => {
  const records = await loadRegistry();
  const record = records.find((item) => item.id === req.params.id);
  if (!record) throw new HttpError(404, '配置不存在');
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new HttpError(400, '配置名称不能为空');
  record.name = name;
  record.description = String(req.body?.description ?? '').trim();
  record.updatedAt = new Date().toISOString();
  await saveRegistry(records);
  res.json(record);
});

app.delete('/api/configs/:id', async (req, res) => {
  const records = await loadRegistry();
  const index = records.findIndex((item) => item.id === req.params.id);
  if (index < 0) throw new HttpError(404, '配置不存在');
  if (records[index].isTemplate) throw new HttpError(400, '默认模板不能删除');
  const [record] = records.splice(index, 1);
  await saveRegistry(records);
  await rm(resolveConfigPath(record.file), { force: true });
  res.status(204).end();
});

app.get('/api/configs/:id/content', async (req, res) => {
  const record = await findConfig(req.params.id);
  const { data } = await loadDocument(record);
  const proxies = Array.isArray(data.proxies) ? data.proxies : [];
  const rules = Array.isArray(data.rules) ? data.rules : [];
  res.json({
    proxies,
    rules: rules.map(splitRule),
    proxyGroups: Array.isArray(data['proxy-groups']) ? data['proxy-groups'] : [],
    policyOptions: policyOptions(data)
  });
});

app.put('/api/configs/:id/content', async (req, res) => {
  if (!Array.isArray(req.body?.proxies) || !Array.isArray(req.body?.rules) || !Array.isArray(req.body?.proxyGroups)) {
    throw new HttpError(400, 'proxies、rules 和 proxyGroups 必须是数组');
  }
  const proxies: Record<string, unknown>[] = (req.body.proxies as unknown[]).map(validateProxy);
  const proxyNames = proxies.map((proxy) => proxy.name as string);
  if (new Set(proxyNames).size !== proxyNames.length) throw new HttpError(409, '代理名称不能重复');
  const rules = req.body.rules.map((rule: unknown) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new HttpError(400, '规则格式无效');
    return normalizeRule(rule as RuleInput);
  });
  const proxyGroups = jsonClone(req.body.proxyGroups as Record<string, unknown>[]);
  if (proxyGroups.some((group) => !group || typeof group !== 'object' || Array.isArray(group))) {
    throw new HttpError(400, '代理组格式无效');
  }
  const result = await editDocument(req.params.id, (doc) => {
    doc.set('proxies', proxies);
    doc.set('proxy-groups', proxyGroups);
    doc.set('rules', rules);
  });
  res.json({
    proxies: result.proxies ?? [],
    rules: (result.rules ?? []).map(splitRule),
    proxyGroups: result['proxy-groups'] ?? [],
    policyOptions: policyOptions(result)
  });
});

app.get('/api/configs/:id/raw', async (req, res) => {
  const record = await findConfig(req.params.id);
  res.type('text/yaml').send(await readFile(resolveConfigPath(record.file), 'utf8'));
});

app.put('/api/configs/:id/raw', async (req, res) => {
  const yaml = String(req.body?.yaml ?? '');
  const parsed = parseDocument(yaml);
  if (parsed.errors.length) throw new HttpError(400, `YAML 语法错误：${parsed.errors[0].message}`);
  const data = parsed.toJS() as ClashConfig;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'YAML 顶层必须是对象');
  requireArray(data.proxies, 'proxies');
  requireArray(data.rules, 'rules');
  const record = await findConfig(req.params.id);
  await queueWrite(resolveConfigPath(record.file), () => atomicWrite(resolveConfigPath(record.file), parsed.toString({ lineWidth: 0 })));
  await touchConfig(record.id);
  res.json({ message: 'YAML 已保存' });
});

app.post('/api/configs/:id/proxies', async (req, res) => {
  const proxy = validateProxy(req.body);
  const result = await editDocument(req.params.id, (doc, data) => {
    const proxies = requireArray(data.proxies, 'proxies');
    if (proxies.some((item) => item.name === proxy.name)) throw new HttpError(409, '代理名称已存在');
    proxies.push(proxy);
    doc.set('proxies', proxies);
  });
  res.status(201).json(result.proxies?.at(-1));
});

app.put('/api/configs/:id/proxies/:index', async (req, res) => {
  const proxy = validateProxy(req.body);
  await editDocument(req.params.id, (doc, data) => {
    const proxies = requireArray(data.proxies, 'proxies');
    const index = requireIndex(req.params.index, proxies.length);
    if (proxies.some((item, itemIndex) => itemIndex !== index && item.name === proxy.name)) {
      throw new HttpError(409, '代理名称已存在');
    }
    const oldName = proxies[index].name;
    proxies[index] = proxy;
    doc.set('proxies', proxies);
    if (typeof oldName === 'string' && oldName !== proxy.name && Array.isArray(data['proxy-groups'])) {
      const groups = data['proxy-groups'].map((group) => ({
        ...group,
        proxies: Array.isArray(group.proxies)
          ? group.proxies.map((name) => (name === oldName ? proxy.name : name))
          : group.proxies
      }));
      doc.set('proxy-groups', groups);
    }
  });
  res.json(proxy);
});

app.delete('/api/configs/:id/proxies/:index', async (req, res) => {
  await editDocument(req.params.id, (doc, data) => {
    const proxies = requireArray(data.proxies, 'proxies');
    const index = requireIndex(req.params.index, proxies.length);
    const [removed] = proxies.splice(index, 1);
    doc.set('proxies', proxies);
    if (typeof removed.name === 'string' && Array.isArray(data['proxy-groups'])) {
      const groups = data['proxy-groups'].map((group) => ({
        ...group,
        proxies: Array.isArray(group.proxies) ? group.proxies.filter((name) => name !== removed.name) : group.proxies
      }));
      doc.set('proxy-groups', groups);
    }
  });
  res.status(204).end();
});

app.post('/api/configs/:id/rules', async (req, res) => {
  const rule = normalizeRule(req.body as RuleInput);
  const result = await editDocument(req.params.id, (doc, data) => {
    const rules = requireArray(data.rules, 'rules');
    const requestedIndex = Number(req.body?.index);
    const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 ? Math.min(requestedIndex, rules.length) : rules.length;
    rules.splice(index, 0, rule);
    doc.set('rules', rules);
  });
  res.status(201).json({ rule, count: result.rules?.length ?? 0 });
});

app.put('/api/configs/:id/rules/:index', async (req, res) => {
  const rule = normalizeRule(req.body as RuleInput);
  await editDocument(req.params.id, (doc, data) => {
    const rules = requireArray(data.rules, 'rules');
    rules[requireIndex(req.params.index, rules.length)] = rule;
    doc.set('rules', rules);
  });
  res.json(splitRule(rule));
});

app.delete('/api/configs/:id/rules/:index', async (req, res) => {
  await editDocument(req.params.id, (doc, data) => {
    const rules = requireArray(data.rules, 'rules');
    rules.splice(requireIndex(req.params.index, rules.length), 1);
    doc.set('rules', rules);
  });
  res.status(204).end();
});

app.use('/api', (_req, _res) => {
  throw new HttpError(404, '接口不存在');
});

app.use(express.static(webDir, { index: false }));
app.get('/', (_req, res) => res.sendFile(resolve(webDir, 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(resolve(webDir, 'index.html')));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const reportedStatus =
    error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 500;
  const status = error instanceof HttpError ? error.status : reportedStatus;
  const message = error instanceof Error ? error.message : '服务器内部错误';
  if (status >= 500) console.error(error);
  res.status(status).json({ message: status >= 500 ? '服务器内部错误' : message });
});

const initialCredentials = await initializeAdmin(adminConfigPath);
if (initialCredentials) {
  console.log(`初始管理员账号：${initialCredentials.username}\n初始管理员密码：${initialCredentials.password}\n请立即记录上述凭据。`);
}
await ensureBootstrapFiles();
app.listen(port, host, () => {
  console.log(`Clash config manager: http://${host}:${port}`);
  console.log(`Singapore subscription: http://${host}:${port}/subscribe/singapore`);
  console.log(`Mainland subscription: http://${host}:${port}/subscribe/mainland`);
});
