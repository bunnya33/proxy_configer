#!/usr/bin/env python3
"""Real systemd installation/menu test. Run only on a disposable Linux test host."""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

APP = Path('/opt/proxy-configer')
DATA = Path('/var/lib/proxy-configer')
COMMAND = Path('/usr/local/bin/proxy-configer')
UNIT = Path('/etc/systemd/system/proxy-configer.service')
SOURCE = Path(__file__).resolve().parents[1]
SERVICE = 'proxy-configer.service'


def run(args, input=None, timeout=240):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise AssertionError(f'Command failed: {args}\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}')
    return result.stdout


def install(bootstrap=False):
    if bootstrap:
        if '--bootstrap-api' in sys.argv:
            command = ('curl -fsSL --connect-timeout 15 --max-time 60 '
                       '-H "Accept: application/vnd.github.raw+json" '
                       'https://api.github.com/repos/bunnya33/proxy_configer/contents/bootstrap.sh?ref=main | bash')
        else:
            command = ('curl -fsSL --connect-timeout 15 --max-time 60 '
                       'https://raw.githubusercontent.com/bunnya33/proxy_configer/main/bootstrap.sh | bash')
        return run(['bash', '-o', 'pipefail', '-c',
                    command])
    return run(['bash', str(SOURCE / 'install.sh')])


def menu(input):
    return run(['bash', str(COMMAND)], input=input, timeout=45)


def saved(name):
    return json.loads((DATA / 'config' / name).read_text())


def request(port, path, body=None, cookie=None, method=None):
    headers = {}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if cookie:
        headers['Cookie'] = cookie
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers


def login(port, account):
    status, _, headers = request(port, '/api/auth/login', account)
    assert status == 200, f'Login failed ({status})'
    return headers['Set-Cookie'].split(';')[0]


def account(output, prefix):
    return {
        'username': re.search(prefix + r'管理员账号：([^\n]+)', output)[1],
        'password': re.search(prefix + r'管理员密码：([^\n]+)', output)[1],
    }


def snapshot():
    return {str(file.relative_to(DATA)): file.read_bytes() for file in DATA.rglob('*') if file.is_file()}


def wait_ready(port):
    for _ in range(60):
        try:
            if request(port, '/api/auth/session')[0] == 401:
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(.1)
    raise AssertionError('Server did not become ready')


def absent_program():
    assert not APP.exists() and not COMMAND.exists() and not UNIT.exists()
    assert subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode != 0
    assert subprocess.run(['systemctl', 'is-enabled', '--quiet', SERVICE], capture_output=True).returncode != 0


def main():
    if os.geteuid() != 0 or not Path('/run/systemd/system').is_dir():
        raise SystemExit('Run as root on a disposable Linux host with systemd.')
    if any(path.exists() or path.is_symlink() for path in (APP, DATA, COMMAND, UNIT)):
        raise SystemExit('Existing installation or data found; refusing to touch it.')
    if '--delivery-smoke' in sys.argv:
        delivery_smoke()
        return
    bootstrap = '--bootstrap' in sys.argv
    try:
        initial = install(bootstrap)
        initial_account = account(initial, '初始')
        port = saved('server.json')['port']
        wait_ready(port)
        cookie = login(port, initial_account)
        assert 'password' not in saved('admin.json')
        assert (DATA / 'config/admin.json').stat().st_mode & 0o777 == 0o600
        assert run(['systemctl', 'is-enabled', SERVICE]).strip() == 'enabled'
        status = menu('1\n0\n')
        assert '服务正在运行' in status and initial_account['password'] not in status
        assert request(port, '/admin')[0] == 200
        assert request(port, '/subscribe/singapore')[0] == 200
        menu('3\n0\n')
        assert subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode != 0
        menu('2\n4\n0\n')
        wait_ready(port)
        print('PASS: install, initial login, systemd enable, status/start/stop/restart', flush=True)

        for invalid in ('0', '65536', '12abc', '-1', '1.5'):
            menu(f'5\n{invalid}\n0\n')
            assert saved('server.json')['port'] == port
        with socket.socket() as listener:
            listener.bind(('0.0.0.0', 0))
            listener.listen()
            occupied = listener.getsockname()[1]
            assert '已被占用' in menu(f'5\n{occupied}\n0\n')
            assert saved('server.json')['port'] == port
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            new_port = probe.getsockname()[1]
        changed = menu(f'5\n{new_port}\n0\n')
        assert '端口已修改并生效' in changed and f':{new_port}/admin' in changed
        port = new_port
        wait_ready(port)
        assert saved('server.json')['port'] == port
        print('PASS: invalid/occupied ports rejected, valid port persists and serves HTTP', flush=True)

        admin_before = saved('admin.json')
        menu('6\nnew_admin\nLongPassword123!\nDifferentPassword123!\n0\n')
        assert saved('admin.json') == admin_before
        manual = {'username': 'test_admin', 'password': 'Aa9!' + secrets.token_urlsafe(24)}
        menu(f"6\n{manual['username']}\n{manual['password']}\n{manual['password']}\n0\n")
        cookie2 = login(port, manual)
        assert request(port, '/api/auth/session', cookie=cookie)[0] == 401
        assert request(port, '/api/auth/login', initial_account)[0] == 401
        before_reset = saved('admin.json')
        menu('7\nn\n0\n')
        assert saved('admin.json') == before_reset
        random_account = account(menu('7\ny\n0\n'), '新')
        cookie3 = login(port, random_account)
        assert request(port, '/api/auth/session', cookie=cookie2)[0] == 401
        assert 'password' not in saved('admin.json')
        print('PASS: hidden manual password, random reset confirmation, real login and session revocation', flush=True)

        status, _, _ = request(port, '/api/configs', {'id': 'smoke-case', 'name': '端到端测试'}, cookie3)
        assert status == 201
        status, _, _ = request(port, '/api/configs/smoke-case/raw',
                               {'yaml': 'proxies: []\nproxy-groups: []\nrules: ["MATCH,DIRECT"]\n'}, cookie3, 'PUT')
        assert status == 200
        before_reinstall = snapshot()
        reinstall_output = install(bootstrap)
        assert '初始管理员密码' not in reinstall_output
        assert snapshot() == before_reinstall
        wait_ready(port)
        login(port, random_account)
        assert request(port, '/subscribe/smoke-case')[0] == 200
        print('PASS: reinstall preserves account, port, custom subscriptions and template', flush=True)

        menu('8\nn\n0\n')
        assert APP.exists()
        menu('8\ny\n\n')
        absent_program()
        assert snapshot() == before_reinstall
        reinstall_output = install(bootstrap)
        assert '初始管理员密码' not in reinstall_output
        wait_ready(port)
        login(port, random_account)
        assert snapshot() == before_reinstall
        menu('8\ny\ny\nn\n')
        absent_program()
        assert snapshot() == before_reinstall
        install(bootstrap)
        menu('8\ny\ny\ny\n')
        absent_program()
        assert not DATA.exists()
        assert shutil.which('node') and shutil.which('npm')
        print('PASS: uninstall cancellation, default data retention, reinstall recovery, two confirmations for full deletion', flush=True)
    finally:
        # These fixed paths were verified absent before this test; clean up only our test installation.
        if COMMAND.exists() and APP.exists():
            menu('8\ny\ny\ny\n')
    print('All Linux end-to-end checks passed.', flush=True)


def delivery_smoke():
    """Verify the published Git clone and curl entry points, then remove test data."""
    try:
        with tempfile.TemporaryDirectory(prefix='proxy-configer-clone-') as directory:
            run(['git', 'clone', 'https://github.com/bunnya33/proxy_configer.git', directory])
            output = run(['bash', str(Path(directory) / 'install.sh')])
        initial_account = account(output, '初始')
        port = saved('server.json')['port']
        wait_ready(port)
        login(port, initial_account)
        print('PASS: published Git clone installation and real administrator login', flush=True)

        # Verify a privileged port too; the production service has CAP_NET_BIND_SERVICE.
        low_port = None
        for candidate in range(1023, 1000, -1):
            with socket.socket() as probe:
                try:
                    probe.bind(('0.0.0.0', candidate))
                    low_port = candidate
                    break
                except OSError:
                    pass
        if low_port is None:
            raise AssertionError('No free privileged port for this test')
        assert '端口已修改并生效' in menu(f'5\n{low_port}\n0\n')
        wait_ready(low_port)
        login(low_port, initial_account)
        menu(f'5\n{port}\n0\n')
        state_before = snapshot()
        bootstrap_output = install(bootstrap=True)
        assert '初始管理员密码' not in bootstrap_output
        assert snapshot() == state_before
        wait_ready(port)
        login(port, initial_account)
        print('PASS: published curl bootstrap, preserved data, and privileged port support', flush=True)
        menu('8\ny\ny\ny\n')
        absent_program()
        assert not DATA.exists()
    finally:
        if COMMAND.exists() and APP.exists():
            menu('8\ny\ny\ny\n')
    print('All published installation checks passed.', flush=True)


if __name__ == '__main__':
    main()
