#!/bin/zsh
set -e
cd -- "${0:A:h}"
if [[ ! -x output/Sentinel.app/Contents/MacOS/Sentinel ]]; then
  ./build-app.sh
fi
if ! /usr/bin/curl --silent --fail --max-time 2 http://127.0.0.1:5173/api/auth/session >/dev/null; then
  open '../../Start Sentinel.command'
fi
open output/Sentinel.app
