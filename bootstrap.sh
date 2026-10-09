#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo '请使用 curl -fsSL https://raw.githubusercontent.com/bunnya33/proxy_configer/main/bootstrap.sh | sudo bash' >&2
  exit 1
fi
command -v curl >/dev/null || { echo '请先安装 curl。' >&2; exit 1; }
command -v tar >/dev/null || { echo '请先安装 tar。' >&2; exit 1; }
stage=$(mktemp -d /tmp/proxy-configer-bootstrap.XXXXXXXX)
trap 'rm -rf -- "$stage"' EXIT
echo '正在下载 proxy_configer 项目……'
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 180 --retry 3 \
  https://codeload.github.com/bunnya33/proxy_configer/tar.gz/refs/heads/main -o "$stage/source.tar.gz"
mkdir "$stage/source"
tar -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/source"
bash "$stage/source/install.sh"
