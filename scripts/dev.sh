#!/usr/bin/env bash
# better-sqlite3 12.x 는 Node 20/22/23/24/25/26 을 지원.
# IDE 태스크가 launchd PATH로 떠서 다른 Node를 잡는 경우를 우회 —
# homebrew/nvm의 LTS 를 우선 사용하도록 PATH를 재배치.

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
