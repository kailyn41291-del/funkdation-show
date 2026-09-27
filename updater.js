'use strict';
// 程式內更新：到 GitHub 下載頁檢查新版本，詢問後下載並自動安裝、重新開啟
// - Windows 安裝版：背景安裝（/S）後自動開啟新版
// - Windows 免安裝版：下載新的免安裝檔放在同一個資料夾並開啟
// - Mac：下載後替換 FUNKDATION.app 並重新開啟
// 賽事資料存在「文件」資料夾，更新不會動到。
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'kailyn41291-del/funkdation-show';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases/latest`;

let getWindow = () => null;
let busy = false;
let latest = null;

function send(msg) {
  const w = getWindow();
  if (w && !w.isDestroyed()) w.webContents.send('fd:update', msg);
}

function parseVer(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function newer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function assetSuffix() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? '-Mac-AppleSilicon.zip' : '-Mac-Intel.zip';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? '-Windows-Portable.exe' : '-Windows-Setup.exe';
  return null;
}

async function check() {
  const res = await fetch(API, { headers: { 'User-Agent': 'FUNKDATION-updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('無法連到更新伺服器（' + res.status + '）');
  const r = await res.json();
  const version = (r.tag_name || '').replace(/^v/, '');
  const suffix = assetSuffix();
  const asset = suffix && (r.assets || []).find(a => a.name.endsWith(suffix));
  latest = { version, notes: r.body || '', url: r.html_url, asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null };
  return { current: app.getVersion(), latest: version, available: newer(version, app.getVersion()) && !!asset, url: r.html_url };
}

async function download(asset, dest) {
  const res = await fetch(asset.url, { headers: { 'User-Agent': 'FUNKDATION-updater' } });
  if (!res.ok || !res.body) throw new Error('下載失敗（' + res.status + '）');
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let got = 0, lastSent = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
    const now = Date.now();
    if (now - lastSent > 150) {
      lastSent = now;
      const p = total ? got / total : 0;
      send({ state: 'downloading', progress: p, got, total });
      const w = getWindow();
      if (w && !w.isDestroyed()) w.setProgressBar(p);
    }
  }
  await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
  const w = getWindow();
  if (w && !w.isDestroyed()) w.setProgressBar(-1);
  if (total && fs.statSync(dest).size !== total) throw new Error('下載的檔案不完整，請再試一次');
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', rej);
    p.on('exit', c => (c === 0 ? res() : rej(new Error(cmd + ' 失敗（' + c + '）'))));
  });
}

async function installWindows(file) {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable) {
    // 免安裝版：新檔放在舊檔旁邊，開啟新版後結束舊版
    let target = path.join(path.dirname(portable), latest.asset.name);
    try { fs.copyFileSync(file, target); } catch (e) { target = path.join(app.getPath('downloads'), latest.asset.name); fs.copyFileSync(file, target); }
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // 安裝版：背景安裝，完成後自動開啟
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  }
  setTimeout(() => app.quit(), 300);
}

async function installMac(zip, work) {
  // 找出目前 FUNKDATION.app 的位置
  const appPath = path.resolve(process.execPath, '..', '..', '..');
  if (!appPath.endsWith('.app')) throw new Error('找不到程式位置');
  if (appPath.includes('/AppTranslocation/') || appPath.startsWith('/Volumes/')) {
    throw new Error('請先把 FUNKDATION 拖到「應用程式」資料夾再更新');
  }
  const outDir = path.join(work, 'new');
  fs.mkdirSync(outDir, { recursive: true });
  await run('/usr/bin/ditto', ['-x', '-k', zip, outDir]);
  const fresh = path.join(outDir, 'FUNKDATION.app');
  if (!fs.existsSync(fresh)) throw new Error('更新檔內容不正確');
  fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
  // 等目前的程式結束後替換，替換失敗就還原舊版
  const script = path.join(work, 'swap.sh');
  fs.writeFileSync(script, [
    '#!/bin/bash',
    'PID="$1"; OLD="$2"; NEW="$3"',
    'for i in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done',
    'rm -rf "$OLD.old"',
    'if mv "$OLD" "$OLD.old" && mv "$NEW" "$OLD"; then rm -rf "$OLD.old"; else [ -d "$OLD.old" ] && [ ! -d "$OLD" ] && mv "$OLD.old" "$OLD"; fi',
    'xattr -cr "$OLD" 2>/dev/null',
    'open "$OLD"',
    ''
  ].join('\n'), { mode: 0o755 });
  spawn('/bin/bash', [script, String(process.pid), appPath, fresh], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
}

async function install() {
  if (busy) return;
  if (!latest || !latest.asset) await check();
  if (!latest || !latest.asset) throw new Error('找不到這台電腦適用的更新檔');
  busy = true;
  try {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'funkdation-update-'));
    const file = path.join(work, latest.asset.name);
    send({ state: 'downloading', progress: 0, version: latest.version });
    await download(latest.asset, file);
    send({ state: 'installing', version: latest.version });
    if (process.platform === 'win32') await installWindows(file);
    else if (process.platform === 'darwin') await installMac(file, work);
    else { shell.showItemInFolder(file); busy = false; }
  } catch (e) {
    busy = false;
    send({ state: 'error', error: e.message });
    throw e;
  }
}

// 詢問是否更新（啟動時自動檢查、或設定頁按「檢查更新」）
async function prompt(manual) {
  if (busy) return;
  let info;
  try {
    info = await check();
  } catch (e) {
    if (manual) dialog.showMessageBox(getWindow(), { type: 'warning', message: '無法檢查更新', detail: e.message + '\n請確認這台電腦有連上網路。' });
    return;
  }
  const w = getWindow();
  if (!info.available) {
    if (manual) dialog.showMessageBox(w, { type: 'info', message: '已經是最新版本', detail: '目前版本 ' + info.current });
    return;
  }
  const r = await dialog.showMessageBox(w, {
    type: 'info',
    buttons: ['下載並更新', '稍後', '查看更新內容'],
    defaultId: 0, cancelId: 1,
    title: '版本更新',
    message: '發現新版本 ' + info.latest + '，是否下載並更新？',
    detail: '目前版本 ' + info.current + '\n\n更新時程式會關閉並自動重新開啟，賽事資料都會保留。\n演出進行中請不要更新。'
  });
  if (r.response === 2) { shell.openExternal(info.url || PAGE); return; }
  if (r.response !== 0) return;
  try {
    await install();
  } catch (e) {
    const x = await dialog.showMessageBox(w, { type: 'error', buttons: ['打開下載頁', '關閉'], message: '更新失敗', detail: e.message + '\n\n也可以到下載頁手動下載新版。' });
    if (x.response === 0) shell.openExternal(PAGE);
  }
}

function init(opts) {
  getWindow = opts.getWindow;
  // 啟動 5 秒後自動檢查一次（沒有網路就安靜略過）
  if (app.isPackaged) setTimeout(() => prompt(false), 5000);
}

module.exports = { init, check, prompt, install, newer, download, PAGE };
