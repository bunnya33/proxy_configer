#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

APP_DIR=/opt/proxy-configer
DATA_DIR=/var/lib/proxy-configer
SERVICE=proxy-configer
SERVICE_USER=proxy-configer
SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

die() { echo "安装失败：$*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || die '请使用 sudo bash install.sh。'
[[ $(uname -s) == Linux ]] || die '仅支持 Linux 服务器。'
if ! command -v systemctl >/dev/null || [[ ! -d /run/systemd/system ]]; then
  die '需要运行 systemd 的 Linux 系统。'
fi
[[ -f "$SOURCE_DIR/package-lock.json" && -f "$SOURCE_DIR/linux/manage.sh" ]] || die '项目文件不完整。'
[[ ! -L "$APP_DIR" && ! -L "$DATA_DIR" ]] || die '安装目录或数据目录不能是符号链接。'

stage=$(mktemp -d /tmp/proxy-configer-install.XXXXXXXX)
trap 'rm -rf -- "$stage"' EXIT

echo '正在检查和安装依赖……'
missing_dependencies=false
for dependency in curl tar xz ss runuser useradd sha256sum; do
  command -v "$dependency" >/dev/null || missing_dependencies=true
done
if [[ ! -d /etc/ssl/certs ]]; then missing_dependencies=true; fi
if [[ "$missing_dependencies" == false ]]; then
  echo '系统依赖已就绪。'
elif command -v apt-get >/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl tar xz-utils iproute2 util-linux
elif command -v dnf >/dev/null; then
  dnf install -y ca-certificates curl tar xz iproute util-linux
elif command -v yum >/dev/null; then
  yum install -y ca-certificates curl tar xz iproute util-linux
elif command -v pacman >/dev/null; then
  pacman -S --needed --noconfirm ca-certificates curl tar xz iproute2 util-linux
else
  for dependency in curl tar xz ss runuser useradd sha256sum; do
    command -v "$dependency" >/dev/null || die "缺少 $dependency，请通过系统包管理器安装。"
  done
fi

if ! command -v node >/dev/null || ! node -e 'const [m,n]=process.versions.node.split(".").map(Number); process.exit(m>22 || (m===22 && n>=12) ? 0 : 1)'; then
  case $(uname -m) in
    x86_64) node_arch=x64 ;;
    aarch64|arm64) node_arch=arm64 ;;
    *) die '自动安装 Node.js 只支持 x86_64 和 arm64；请先安装 Node.js 22.12 或更高版本。' ;;
  esac
  echo '正在安装 Node.js 22 LTS（使用官方文件并校验 SHA-256）……'
  curl --proto '=https' --tlsv1.2 -fsSL --retry 3 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$stage/SHASUMS256.txt"
  archive=$(awk -v suffix="-linux-$node_arch.tar.xz" '$2 ~ suffix "$" {print $2}' "$stage/SHASUMS256.txt")
  [[ "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || die '无法确定 Node.js 官方下载文件。'
  curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "https://nodejs.org/dist/latest-v22.x/$archive" -o "$stage/$archive"
  awk -v archive="$archive" '$2 == archive' "$stage/SHASUMS256.txt" > "$stage/checksum.txt"
  (cd "$stage" && sha256sum -c checksum.txt) || die 'Node.js 校验失败。'
  mkdir -p /usr/local/lib/nodejs /usr/local/bin
  tar -xJf "$stage/$archive" -C /usr/local/lib/nodejs
  for binary in node npm npx; do
    ln -sfn "/usr/local/lib/nodejs/${archive%.tar.xz}/bin/$binary" "/usr/local/bin/$binary"
  done
  export PATH="/usr/local/bin:$PATH"
  hash -r
fi
command -v npm >/dev/null || die 'Node.js 已安装，但缺少 npm。'
NODE_BIN=$(command -v node)
[[ "$NODE_BIN" == /* && "$NODE_BIN" != *' '* ]] || die 'Node.js 路径必须为不含空格的绝对路径。'
case $(readlink -f "$NODE_BIN") in
  /root/*|/home/*|/tmp/*) die 'Node.js 位于服务无法访问的目录，请安装到 /usr/local/bin 等系统路径。' ;;
esac

echo '正在构建完整部署包……'
(cd "$SOURCE_DIR" && npm ci --no-audit --no-fund && npm run build)
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR/releases" "$DATA_DIR/config"
chmod 755 "$APP_DIR" "$APP_DIR/releases"
chmod 700 "$DATA_DIR" "$DATA_DIR/config"

# Only seed absent files/directories. An existing registry and its business data stay together.
for file in admin.json server.json; do
  if [[ ! -e "$DATA_DIR/config/$file" ]]; then
    install -m 600 "$SOURCE_DIR/dist/config/$file" "$DATA_DIR/config/$file"
  fi
done
if [[ ! -d "$DATA_DIR/data" ]]; then
  cp -a "$SOURCE_DIR/dist/data" "$DATA_DIR/data"
fi
if [[ ! -e "$DATA_DIR/bunnya.yaml" ]]; then
  install -m 600 "$SOURCE_DIR/dist/bunnya.yaml" "$DATA_DIR/bunnya.yaml"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod -R go-rwx "$DATA_DIR"
release="$APP_DIR/releases/$(date -u +%Y%m%d%H%M%S)-$$"
mkdir "$release"
cp -a "$SOURCE_DIR/dist/server" "$SOURCE_DIR/dist/web" "$SOURCE_DIR/dist/package.json" "$release/"
chmod -R a+rX "$release"
runuser -u "$SERVICE_USER" -- env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$release/server/manage.js" init
previous_release=$(readlink "$APP_DIR/current" || true)
if [[ -e "$APP_DIR/current" && ! -L "$APP_DIR/current" ]]; then
  die "$APP_DIR/current 已存在且不是部署链接。"
fi
systemctl stop "$SERVICE.service" 2>/dev/null || true
if ! env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$release/server/manage.js" check-port "$(runuser -u "$SERVICE_USER" -- env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$release/server/manage.js" port)"; then
  [[ -z "$previous_release" ]] || systemctl start "$SERVICE.service" || true
  die '配置端口无法监听，请先释放端口或修正监听地址。'
fi
ln -sfn "$release" "$APP_DIR/current"
install -m 755 "$SOURCE_DIR/linux/manage.sh" /usr/local/bin/proxy-configer
cat > /etc/systemd/system/proxy-configer.service <<EOF
[Unit]
Description=Proxy Configer - Clash configuration manager
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/current
Environment=APP_DATA_DIR=$DATA_DIR
ExecStart=$NODE_BIN $APP_DIR/current/server/index.js
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE.service"
systemctl restart "$SERVICE.service" || true
healthy=false
port=$(runuser -u "$SERVICE_USER" -- env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$APP_DIR/current/server/manage.js" port)
for ((attempt=0; attempt<20; attempt++)); do
  pid=$(systemctl show "$SERVICE.service" -p MainPID --value)
  if [[ "$pid" != 0 ]] && systemctl is-active --quiet "$SERVICE.service" && ss -H -ltnp "( sport = :$port )" | grep -Fq "pid=$pid,"; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$APP_DIR/current"
    systemctl restart "$SERVICE.service" || true
  else
    systemctl stop "$SERVICE.service" || true
  fi
  journalctl -u "$SERVICE.service" -n 20 --no-pager >&2
  die '服务未正常监听，请检查日志；如有旧版本，已恢复旧程序。'
fi

echo '安装完成，服务已启动并设为开机自启。'
echo '后台访问地址（请使用服务器公网 IP 或域名）：'
runuser -u "$SERVICE_USER" -- env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$APP_DIR/current/server/manage.js" address
echo '打开管理菜单：sudo proxy-configer'
echo "配置与业务数据：$DATA_DIR（重复安装会保留）"
