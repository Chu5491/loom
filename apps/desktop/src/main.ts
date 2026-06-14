// loom 데스크톱 메인 프로세스.
//  - 패키징: 선택한 오피스 폴더를 LOOM_HOME 으로 서버를 인-프로세스 기동
//    (빌드된 웹을 같은 오리진에서 서빙) 후 그 포트를 BrowserWindow 로 로드.
//  - 개발: 서버를 띄우지 않고 Vite(3201)를 로드 — `pnpm dev` 와 함께 쓴다.
// 헌법: CLI 전역설정 불가침 — 여기서 손대는 건 사용자가 고른 오피스 폴더뿐.

import { app, BrowserWindow, dialog, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Settings {
  officeHome?: string;
}

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Settings;
  } catch {
    return {}; // 첫 실행이거나 깨진 파일 — 빈 설정으로 시작
  }
}

function writeSettings(next: Settings): void {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${JSON.stringify(next, null, 2)}\n`);
}

// 오피스 폴더(office/ + data/ 의 부모 = LOOM_HOME) 결정. 저장돼 있으면 그대로,
// 없으면 ~/loom 기본값으로 폴더 선택 다이얼로그. 헌법: 정의는 git, 사용자가 보는 곳.
async function resolveOfficeHome(): Promise<string | null> {
  const saved = readSettings().officeHome;
  if (saved && fs.existsSync(saved)) return saved;

  const fallback = path.join(os.homedir(), "loom");
  fs.mkdirSync(fallback, { recursive: true });

  const picked = await dialog.showOpenDialog({
    title: "loom 오피스 폴더 선택",
    message: "office(정의)와 data(기록)를 둘 폴더를 고르세요. 나중에 git 으로 관리할 수 있어요.",
    defaultPath: fallback,
    buttonLabel: "이 폴더 사용",
    properties: ["openDirectory", "createDirectory"],
  });
  const home = picked.canceled ? undefined : picked.filePaths[0];
  if (!home) return null;
  fs.mkdirSync(home, { recursive: true });
  writeSettings({ officeHome: home });
  return home;
}

interface Booted {
  port: number;
  shutdown: () => Promise<void>;
}

let booted: Booted | null = null;

async function startServer(home: string): Promise<number> {
  process.env.LOOM_HOME = home;
  process.env.LOOM_WEB_DIR = path.join(process.resourcesPath, "web");
  process.env.LOOM_PORT = "0"; // OS 가 빈 포트 배정 — dev 서버(3200)와 충돌 회피
  process.env.NODE_ENV = "production"; // pino-pretty 워커 경로 회피(raw JSON 로그)
  // 런타임 require — 별도 번들이라 config 가 위 환경변수 설정 뒤에 평가된다.
  // (main 번들에 인라인하면 esbuild 가 부팅 전에 config 를 평가해 env 가 안 먹는다.)
  const { bootServer } = require(path.join(__dirname, "server.cjs")) as {
    bootServer: () => Promise<Booted>;
  };
  booted = await bootServer();
  return booted.port;
}

async function createWindow(url: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 외부 링크(skills.sh 등)는 기본 브라우저로 — 앱 창에 가두지 않는다.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });

  await win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) {
      const home = await resolveOfficeHome();
      if (!home) {
        app.quit();
        return;
      }
      const port = await startServer(home);
      await createWindow(`http://127.0.0.1:${port}`);
    } else {
      // 개발: 별도로 띄운 Vite 를 로드(HMR). `pnpm dev` 가 3200/3201 을 맡는다.
      await createWindow(process.env.LOOM_DEV_URL ?? "http://localhost:3201");
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const url = app.isPackaged ? `http://127.0.0.1:${booted?.port}` : (process.env.LOOM_DEV_URL ?? "http://localhost:3201");
        void createWindow(url);
      }
    });
  }).catch((err: unknown) => {
    // 부팅 실패를 조용히 죽지 않게 — 사용자가 원인을 보고 재시작하도록.
    dialog.showErrorBox("loom 시작 실패", err instanceof Error ? err.stack ?? err.message : String(err));
    app.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // 종료 전 실행 중 run 정리 — DB 에 "running" 좀비를 남기지 않는다.
  let quitting = false;
  app.on("before-quit", (e) => {
    if (!booted || quitting) return;
    quitting = true;
    e.preventDefault();
    const b = booted;
    booted = null;
    void b.shutdown().finally(() => app.quit());
  });
}
