// Electron 메인/프리로드 + 서버 부팅 본체를 하나의 CJS 번들로 묶는다.
// 워크스페이스 패키지가 소스(.ts)를 main 으로 노출하고 내부에서 NodeNext 식
// .js 스펙파이어를 쓰므로, esbuild 가 .js → .ts 로 해석하도록 플러그인을 끼운다.
// 네이티브/워커 모듈(better-sqlite3, pino, pino-pretty)과 electron 은 external —
// 런타임에 node_modules 에서 require (electron-builder 가 동봉 + ABI 재빌드).

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(root, "..");

// NodeNext 코드베이스의 명시적 .js import 를 같은 위치의 .ts 로 잇는다.
const jsToTs = {
  name: "js-to-ts",
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return; // 상대경로만 — bare 모듈은 기본 해석에 위임
      const ts = path.resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
      return fs.existsSync(ts) ? { path: ts } : undefined;
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20", // electron 33 의 Node ABI
  sourcemap: true,
  resolveExtensions: [".ts", ".js", ".json", ".node"],
  plugins: [jsToTs],
  logLevel: "info",
};

// 서버는 별도 번들 — main 이 런타임에 require 해 LOOM_* 환경변수 설정 뒤 로드한다.
await build({
  ...common,
  entryPoints: [path.join(pkg, "src/server-entry.ts")],
  outfile: path.join(pkg, "build/server.cjs"),
  // 네이티브/워커 모듈은 번들 불가 → external (electron-builder 가 동봉·ABI 재빌드).
  external: ["better-sqlite3", "pino", "pino-pretty"],
});

await build({
  ...common,
  entryPoints: [path.join(pkg, "src/main.ts")],
  outfile: path.join(pkg, "build/main.cjs"),
  external: ["electron"], // 서버는 server.cjs 로 런타임 require — 여기 인라인 안 함
});

await build({
  ...common,
  entryPoints: [path.join(pkg, "src/preload.ts")],
  outfile: path.join(pkg, "build/preload.cjs"),
  external: ["electron"],
});
