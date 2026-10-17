#!/usr/bin/env node
/**
 * 簡易的 Chrome CDP 檢查器（給開發時驗證頁面用）
 *
 * 用法：
 *   node tools/browser-check.mjs <url> <輸出.png> [--width 1440] [--height 1000]
 *        [--wait 1500] [--full] [--eval "<JS 運算式>"]
 *
 * 會啟動一個獨立的 headless Chrome，載入頁面、可選擇執行 JS 後截圖，
 * 並把 console 錯誤 / 未捕捉例外印出來，最後自動關閉瀏覽器。
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const argv = process.argv.slice(2);
const positional = argv.filter((arg) => !arg.startsWith("--"));
const url = positional[0];
const outFile = positional[1];

function flag(name, fallback) {
  const index = argv.indexOf("--" + name);
  return index >= 0 ? argv[index + 1] : fallback;
}

if (!url || !outFile) {
  console.error("用法：node tools/browser-check.mjs <url> <輸出.png> [選項]");
  process.exit(1);
}

const width = Number(flag("width", 1440));
const height = Number(flag("height", 1000));
const waitMs = Number(flag("wait", 1500));
const fullPage = argv.includes("--full");
const mobile = argv.includes("--mobile");
const evalJs = flag("eval", "");
const postWait = Number(flag("post-wait", 300));
const timeoutMs = Number(flag("timeout", 15000));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profileDir = await mkdtemp(path.join(tmpdir(), "phoebe-chrome-"));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profileDir,
    "--window-size=" + width + "," + height,
    "--force-device-scale-factor=1",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore"] }
);

let ws = null;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function waitForDevtoolsPort() {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (existsSync(portFile)) {
        readFile(portFile, "utf8")
          .then((text) => {
            const [port] = text.split("\n");
            resolve(Number(port));
          })
          .catch(reject);
        return;
      }
      if (Date.now() - started > 10000) {
        reject(new Error("Chrome DevTools port 沒有出現"));
        return;
      }
      setTimeout(poll, 100);
    })();
  });
}

function parseCdpMessage(raw) {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(method + " 失敗：" + JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params.exceptionDetails;
    const text =
      (detail.exception && (detail.exception.description || detail.exception.value)) ||
      detail.text ||
      "未知錯誤";
    pageErrors.push(String(text).split("\n")[0]);
  }

  if (message.method === "Runtime.consoleAPICalled") {
    if (message.params.type === "error") {
      consoleErrors.push(
        message.params.args
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ")
      );
    }
  }

  if (message.method === "Log.entryAdded") {
    const entry = message.params.entry;
    if (entry.level === "error" && entry.source !== "network") {
      consoleErrors.push(entry.text);
    }
  }
}

async function main() {
  const port = await waitForDevtoolsPort();
  const targets = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) =>
    response.json()
  );
  const page = targets.find((target) => target.type === "page") || targets[0];
  if (!page) throw new Error("找不到可用的頁面 target");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  ws.addEventListener("message", (event) => parseCdpMessage(event.data));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  if (mobile) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }

  const loaded = new Promise((resolve) => {
    const listener = (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.method === "Page.loadEventFired") {
        ws.removeEventListener("message", listener);
        resolve();
      }
    };
    ws.addEventListener("message", listener);
    setTimeout(resolve, timeoutMs);
  });

  await send("Page.navigate", { url });
  await loaded;
  await sleep(waitMs);

  let evalResult = null;
  if (evalJs) {
    const result = await send("Runtime.evaluate", {
      expression: evalJs,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      evalResult = {
        error:
          (result.exceptionDetails.exception &&
            result.exceptionDetails.exception.description) ||
          result.exceptionDetails.text,
      };
    } else {
      evalResult = result.result.value;
    }
    await sleep(postWait);
  }

  let shotParams = { format: "png", fromSurface: true };
  if (fullPage) {
    const metrics = await send("Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    shotParams = {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(size.width),
        height: Math.ceil(size.height),
        scale: 1,
      },
    };
  }

  const shot = await send("Page.captureScreenshot", shotParams);
  await writeFile(outFile, Buffer.from(shot.data, "base64"));

  console.log("截圖：" + outFile);
  if (evalResult !== null && evalResult !== undefined) {
    console.log("EVAL " + JSON.stringify(evalResult, null, 2));
  }
  if (pageErrors.length) {
    console.log("頁面錯誤：");
    pageErrors.forEach((error) => console.log("  ✗ " + error));
  }
  if (consoleErrors.length) {
    console.log("Console 錯誤：");
    consoleErrors.forEach((error) => console.log("  ✗ " + error));
  }
  if (!pageErrors.length && !consoleErrors.length) {
    console.log("沒有 JS 錯誤 ✓");
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exitCode = 1;
} finally {
  try {
    if (ws) ws.close();
  } catch {}
  chrome.kill("SIGTERM");
  setTimeout(async () => {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    process.exit(process.exitCode || 0);
  }, 500);
}
