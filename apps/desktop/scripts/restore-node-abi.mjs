// 패키징은 better-sqlite3 를 Electron ABI 로 재빌드한다(rebuild:native). pnpm 의
// content-addressed 스토어는 이 네이티브 모듈을 dev 서버(plain Node)와 공유하므로,
// 패키징 후 다시 Node ABI 로 되돌려야 `pnpm dev` 가 살아난다. prebuild-install 은
// 기존 build/ 가 있으면 건너뛰므로 먼저 지운 뒤 Node prebuilt 를 받아 깐다.

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("better-sqlite3/package.json"));

fs.rmSync(path.join(pkgDir, "build"), { recursive: true, force: true });
execSync("npx --no-install prebuild-install || node-gyp rebuild --release", {
  cwd: pkgDir,
  stdio: "inherit",
});
console.log(`better-sqlite3 → Node ABI restored (${pkgDir})`);
