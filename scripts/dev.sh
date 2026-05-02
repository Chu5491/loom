#!/usr/bin/env bash
# Node 22 (better-sqlite3 ABI 127과 일치) 보장한 채로 dev 기동.
# IDE 태스크가 launchd PATH로 떠서 다른 Node를 잡는 경우를 우회.
# 머신에 node@22 keg가 없으면 그냥 현재 Node로 진행 (해당 환경에서 ABI 맞으면 OK).

set -e

for p in \
  /opt/homebrew/opt/node@22/bin \
  /usr/local/opt/node@22/bin \
  "$HOME/.nvm/versions/node"/v22*/bin
do
  if [ -x "$p/node" ]; then
    export PATH="$p:$PATH"
    break
  fi
done

exec pnpm --parallel --filter @loom/server --filter @loom/web run dev
