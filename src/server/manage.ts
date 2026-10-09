import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { adminConfigPath, serverConfigPath } from './paths.js';
import { initializeAdmin, loadAdmin, randomCredentials, setAdmin, writeJson } from './admin.js';

async function serverConfig(): Promise<{ host: string; port: number; cookieSecure?: boolean }> {
  return JSON.parse(await readFile(serverConfigPath, 'utf8'));
}

function parsePort(value: string | undefined): number {
  if (!value || !/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('端口须为 1-65535 的整数');
  }
  return Number(value);
}

async function checkPort(port: number): Promise<void> {
  const config = await serverConfig();
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`端口 ${port} 不可用（已占用或监听地址无效）`)));
    probe.listen({ port, host: config.host, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const [command, value] = process.argv.slice(2);
  switch (command) {
    case 'init': {
      const credentials = await initializeAdmin(adminConfigPath);
      if (credentials) {
        console.log(`初始管理员账号：${credentials.username}\n初始管理员密码：${credentials.password}\n请立即记录上述凭据，密码不会再次显示。`);
      }
      break;
    }
    case 'port': console.log((await serverConfig()).port); break;
    case 'check-port': await checkPort(parsePort(value)); break;
    case 'set-port': {
      const port = parsePort(value);
      const config = await serverConfig();
      await writeJson(serverConfigPath, { ...config, port });
      break;
    }
    case 'address': {
      const config = await serverConfig();
      const host = ['0.0.0.0', '::'].includes(config.host) ? (value || '服务器IP') : config.host;
      console.log(`http://${host.includes(':') ? `[${host}]` : host}:${config.port}/admin`);
      break;
    }
    case 'admin-name': console.log((await loadAdmin(adminConfigPath)).username); break;
    case 'admin-set': {
      let input = '';
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > 2048) throw new Error('输入过长');
      }
      const lines = input.split('\n');
      if (lines.length !== 3 || lines[2] !== '') throw new Error('须通过标准输入提供账号和密码');
      await setAdmin(adminConfigPath, lines[0].trim(), lines[1]);
      console.log('管理员账号和密码已更新，旧登录会话已失效。');
      break;
    }
    case 'admin-random': {
      const credentials = randomCredentials();
      await setAdmin(adminConfigPath, credentials.username, credentials.password);
      console.log(`新管理员账号：${credentials.username}\n新管理员密码：${credentials.password}\n请立即记录上述凭据，旧登录会话已失效。`);
      break;
    }
    default: throw new Error('未知管理操作');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '管理操作失败');
  process.exitCode = 1;
});
