import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/hyj/Desktop/chukw/03. Project/16. MyHarness/docs/assets";
const PROJECT_ID = "d248e1e1-fe8e-458a-b0ef-95966bb9d87d";
const BASE = "http://localhost:3201";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  // [name, route, viewport, prep?]
  ["projects",   "/projects",                          [1440, 900]],
  ["office",     `/projects/${PROJECT_ID}`,            [1440, 900]],
  ["agents",     `/projects/${PROJECT_ID}/agents`,     [1440, 900]],
  ["skills",     `/projects/${PROJECT_ID}/skills`,     [1440, 900]],
  ["history",    `/projects/${PROJECT_ID}/runs`,       [1440, 900]],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

for (const theme of ["light", "dark"]) {
  for (const [name, route, vp] of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: 2 });
    // Prime localStorage with theme + open chat dock + persist tabs.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => {
      localStorage.setItem("loom.theme", t);
      localStorage.setItem("loom:chatDock:open", "1");
      localStorage.setItem("loom:chatDock:height", "260");
    }, theme);
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0", timeout: 15000 }).catch(()=>{});
    await new Promise(r => setTimeout(r, 1200));
    const file = `${OUT}/${theme}-${name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log("✓", file);
    await page.close();
  }
}
await browser.close();
