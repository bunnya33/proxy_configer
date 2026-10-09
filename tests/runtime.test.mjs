import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const dist = resolve('dist');

async function fixture(t, legacy = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'proxy-configer-runtime-'));
  await cp(dist, directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (legacy) {
    await writeFile(resolve(directory, 'config/admin.json'), JSON.stringify({
      username: 'legacy_admin', password: 'legacy password 123', sessionSecret: 'old-secret'.repeat(8), sessionHours: 12
    }));
  }
  const cli = (command, value, input) => {
    const args = [resolve(dist, 'server/manage.js'), command];
    if (value !== undefined) args.push(String(value));
    return spawnSync(process.execPath, args, { encoding: 'utf8', input, env: { ...process.env, APP_DATA_DIR: directory } });
  };
  const admin = async () => JSON.parse(await readFile(resolve(directory, 'config/admin.json'), 'utf8'));
  return { directory, cli, admin };
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function launch(t, directory) {
  const port = await freePort();
  const child = spawn(process.execPath, [resolve(dist, 'server/index.js')], {
    env: { ...process.env, APP_DATA_DIR: directory, HOST: '127.0.0.1', PORT: String(port), COOKIE_SECURE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      if ((await fetch(`${base}/api/auth/session`)).status === 401) return base;
    } catch { /* Wait for the server to listen. */ }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Server failed to start: ${output}`);
}

function credentials(output, prefix = '初始') {
  return {
    username: output.match(new RegExp(`${prefix}管理员账号：([^\\n]+)`))[1],
    password: output.match(new RegExp(`${prefix}管理员密码：([^\\n]+)`))[1]
  };
}

async function login(base, account) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account)
  });
}

test('fresh installs hash random credentials and initialization preserves established data', async (t) => {
  const { directory, cli, admin } = await fixture(t);
  const initialized = cli('init');
  assert.equal(initialized.status, 0, initialized.stderr);
  const account = credentials(initialized.stdout);
  const saved = await admin();
  assert.match(saved.passwordHash, /^scrypt\$/);
  assert.equal(saved.password, undefined);
  assert.equal(JSON.stringify(saved).includes(account.password), false);
  const original = await readFile(resolve(directory, 'config/admin.json'), 'utf8');
  const registry = await readFile(resolve(directory, 'data/configs.json'), 'utf8');
  assert.equal(cli('init').stdout, '');
  assert.equal(await readFile(resolve(directory, 'config/admin.json'), 'utf8'), original);
  assert.equal(await readFile(resolve(directory, 'data/configs.json'), 'utf8'), registry);
  const base = await launch(t, directory);
  assert.equal((await login(base, account)).status, 200);
  assert.equal((await login(base, { username: 'admin', password: 'admin123' })).status, 401);
  assert.equal((await fetch(`${base}/admin`)).status, 200);
  assert.equal((await fetch(`${base}/subscribe/singapore`)).status, 200);
});

test('legacy migration, manual and random resets update real login and invalidate sessions without altering subscriptions', async (t) => {
  const { directory, cli, admin } = await fixture(t, true);
  const before = await readFile(resolve(directory, 'data/configs/singapore.yaml'), 'utf8');
  const base = await launch(t, directory);
  const old = await login(base, { username: 'legacy_admin', password: 'legacy password 123' });
  assert.equal(old.status, 200);
  assert.equal((await admin()).password, undefined);
  const cookie = old.headers.get('set-cookie').split(';')[0];
  const password = 'new $password `value` 123';
  const changed = cli('admin-set', undefined, `new_admin\n${password}\n`);
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { cookie } })).status, 401);
  assert.equal((await login(base, { username: 'legacy_admin', password: 'legacy password 123' })).status, 401);
  const newLogin = await login(base, { username: 'new_admin', password });
  assert.equal(newLogin.status, 200);
  const randomized = cli('admin-random');
  assert.equal(randomized.status, 0, randomized.stderr);
  const randomAccount = credentials(randomized.stdout, '新');
  assert.equal((await login(base, randomAccount)).status, 200);
  assert.equal((await login(base, { username: 'new_admin', password })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/session`, {
    headers: { cookie: newLogin.headers.get('set-cookie').split(';')[0] }
  })).status, 401);
  assert.equal(await readFile(resolve(directory, 'data/configs/singapore.yaml'), 'utf8'), before);
  assert.equal((await admin()).password, undefined);
  const state = JSON.stringify(await admin());
  assert.notEqual(cli('admin-set', undefined, 'bad\nshort\n').status, 0);
  assert.equal(JSON.stringify(await admin()), state);
});

test('port validation rejects malformed values and occupied ports, preserving other listener settings', async (t) => {
  const { directory, cli } = await fixture(t);
  const file = resolve(directory, 'config/server.json');
  const original = await readFile(file, 'utf8');
  for (const value of ['0', '65536', '12abc', '-1', '3.5', '']) {
    assert.notEqual(cli('set-port', value).status, 0);
    assert.equal(await readFile(file, 'utf8'), original);
  }
  const listener = createServer();
  await new Promise((done) => listener.listen(0, '0.0.0.0', done));
  const occupied = listener.address().port;
  t.after(() => new Promise((done) => listener.close(done)));
  assert.notEqual(cli('check-port', occupied).status, 0);
  const port = await freePort();
  assert.equal(cli('check-port', port).status, 0);
  assert.equal(cli('set-port', port).status, 0);
  const updated = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(updated.port, port);
  assert.equal(updated.host, '0.0.0.0');
  assert.equal(updated.cookieSecure, false);
});

test('subscription responses use editable Unicode names without a YAML suffix and preserve downloaded content', async (t) => {
  const { directory, cli } = await fixture(t);
  const initialized = cli('init');
  assert.equal(initialized.status, 0, initialized.stderr);
  const base = await launch(t, directory);
  const signedIn = await login(base, credentials(initialized.stdout));
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  const source = await readFile(resolve(directory, 'data/configs/singapore.yaml'), 'utf8');
  for (const [name, filename] of [
    ['轻云', '轻云'],
    ['Light Cloud', 'Light Cloud'],
    ["轻云 ☁️ (香港)'", "轻云 ☁️ (香港)'"],
    ['轻云 / "香港"\r\n', '轻云 _ _香港_']
  ]) {
    const saved = await fetch(`${base}/api/configs/singapore`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name, description: '订阅显示名称测试' })
    });
    assert.equal(saved.status, 200);
    const response = await fetch(`${base}/subscribe/singapore`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), source);
    const disposition = response.headers.get('content-disposition');
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/)[1];
    assert.equal(decodeURIComponent(encodedFilename), filename);
    assert.equal(decodeURIComponent(disposition.match(/filename="([^"]+)"/)[1]), filename);
    assert.equal(disposition.endsWith('.yaml'), false);
    const title = response.headers.get('profile-title');
    assert.equal(title.startsWith('base64:'), true);
    assert.equal(Buffer.from(title.slice(7), 'base64').toString('utf8'), name.trim());
    const head = await fetch(`${base}/subscribe/singapore`, { method: 'HEAD' });
    assert.equal(head.headers.get('content-disposition'), disposition);
  }
  assert.equal(await readFile(resolve(directory, 'data/configs/singapore.yaml'), 'utf8'), source);
  assert.equal((await fetch(`${base}/subscribe/default`)).status, 404);
});
