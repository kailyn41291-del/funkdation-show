'use strict';
// 程式更新後重新啟動：已開著的輸出畫面自動重新整理；同一版重新啟動（例如當機重開）不重新整理
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3224, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-reload-'));
let srv;
async function start(build) {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: dir, FD_PORT: String(PORT), FD_BUILD: build }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
}
async function stop() { const p = new Promise(r => srv.on('exit', r)); srv.kill('SIGKILL'); await p; }
process.on('exit', () => srv && srv.kill('SIGKILL'));

(async () => {
  await start('v1');
  const browser = await chromium.launch({ executablePath: CHROME });
  const out = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await out.goto(BASE + '/output/');
  await sleep(1000);
  await out.evaluate(() => { window.__mark = 1; });
  await stop();
  await sleep(500);
  await start('v1');
  await sleep(4000);
  check('同一版重新啟動：畫面不重新整理', await out.evaluate(() => window.__mark === 1 && window.fd.status === 'online'), await out.evaluate(() => String(window.fd.status)));
  await stop();
  await sleep(500);
  await start('v2');
  await sleep(5000);
  check('更新後重新啟動：畫面自動重新整理成新版', await out.evaluate(() => window.__mark === undefined && window.fd.build === 'v2'), await out.evaluate(() => String(window.fd.build)));
  await browser.close();
  await stop();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
