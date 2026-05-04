import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/hyj/Desktop/chukw/03. Project/16. MyHarness/docs/assets";
const PROJECT_ID = "d248e1e1-fe8e-458a-b0ef-95966bb9d87d";
const BASE = "http://localhost:3201";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Pre-set workspace to editor view + a file open via tabs key
  await page.evaluate((t, pid) => {
    localStorage.setItem("loom.theme", t);
    localStorage.setItem("loom:workspace:view", "editor");
    localStorage.setItem("loom:chatDock:open", "1");
    localStorage.setItem("loom:chatDock:height", "260");
    localStorage.setItem(`loom:workspace:${pid}:tabs`, JSON.stringify({
      openFiles: ["README.md"],
      activeTab: "README.md",
      activeThreadId: null,
    }));
  }, theme, PROJECT_ID);
  await page.goto(`${BASE}/projects/${PROJECT_ID}`, { waitUntil: "networkidle0", timeout: 15000 }).catch(()=>{});
  await new Promise(r => setTimeout(r, 2000));
  const file = `${OUT}/${theme}-editor.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log("✓", file);
  await page.close();
}
await browser.close();
