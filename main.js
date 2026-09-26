'use strict';
// FUNKDATION 播出系統 — 桌面版（Windows / macOS）
const { app, BrowserWindow, Menu, screen, ipcMain, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// 讓輸出視窗在沒有焦點時也維持 60fps、影片可自動播放聲音
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const DATA_DIR = path.join(app.getPath('documents'), 'FUNKDATION 賽事資料');
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.FD_DATA = DATA_DIR;
process.env.FD_PORT = process.env.FD_PORT || '3010';

let server = null;
let control = null;
let output = null;
let port = 3010;
let quitting = false;
let sleepBlock = null;

function url(p) { return `http://127.0.0.1:${port}${p}`; }

function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    primary: d.id === primary,
    label: `螢幕 ${i + 1}${d.id === primary ? '（主螢幕）' : ''}　${d.size.width}×${d.size.height}`
  }));
}

function openOutput(displayId, fullscreen = true) {
  const displays = screen.getAllDisplays();
  const target = displays.find(d => d.id === displayId)
    || displays.find(d => d.id !== screen.getPrimaryDisplay().id)
    || screen.getPrimaryDisplay();
  const b = target.bounds;
  if (output && !output.isDestroyed()) {
    output.setFullScreen(false);
    output.setBounds({ x: b.x + 40, y: b.y + 40, width: Math.min(1280, b.width - 80), height: Math.min(720, b.height - 80) });
    if (fullscreen) setTimeout(() => output && !output.isDestroyed() && output.setFullScreen(true), 150);
    output.show();
    return;
  }
  output = new BrowserWindow({
    x: b.x + 40, y: b.y + 40,
    width: Math.min(1280, b.width - 80), height: Math.min(720, b.height - 80),
    backgroundColor: '#000000',
    title: 'FUNKDATION 輸出畫面',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true }
  });
  output.setMenuBarVisibility(false);
  output.loadURL(url('/output/'));
  output.once('ready-to-show', () => { if (fullscreen) output.setFullScreen(true); });
  if (fullscreen) setTimeout(() => output && !output.isDestroyed() && output.setFullScreen(true), 400);
  output.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' && output.isFullScreen()) { output.setFullScreen(false); e.preventDefault(); }
    if (input.key.toLowerCase() === 'f' && !input.control && !input.meta) { output.setFullScreen(!output.isFullScreen()); e.preventDefault(); }
  });
  output.webContents.on('render-process-gone', () => { if (output && !output.isDestroyed()) output.reload(); });
  output.on('closed', () => { output = null; buildMenu(); });
  buildMenu();
}

function closeOutput() {
  if (output && !output.isDestroyed()) output.close();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const outs = displayList().map(d => ({ label: '在' + d.label + '開啟', click: () => openOutput(d.id, true) }));
  const template = [
    ...(isMac ? [{ role: 'appMenu', label: app.name }] : []),
    {
      label: '檔案',
      submenu: [
        { label: '打開資料夾', click: () => shell.openPath(DATA_DIR) },
        { label: '在瀏覽器開啟控制台', click: () => shell.openExternal(url('/control/')) },
        { type: 'separator' },
        isMac ? { role: 'close', label: '關閉視窗' } : { role: 'quit', label: '結束' }
      ]
    },
    { role: 'editMenu', label: '編輯' },
    {
      label: '輸出',
      submenu: [
        ...outs,
        { type: 'separator' },
        { label: '輸出視窗：切換全螢幕', accelerator: 'CmdOrCtrl+Shift+F', enabled: !!output, click: () => output && output.setFullScreen(!output.isFullScreen()) },
        { label: '關閉輸出視窗', enabled: !!output, click: closeOutput }
      ]
    },
    {
      label: '顯示',
      submenu: [
        { role: 'reload', label: '重新整理控制台' },
        { role: 'resetZoom', label: '實際大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全螢幕' },
        { role: 'toggleDevTools', label: '開發者工具' }
      ]
    },
    { role: 'windowMenu', label: '視窗' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createControl() {
  control = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1000, minHeight: 640,
    backgroundColor: '#16110f',
    title: 'FUNKDATION 控制台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: ['--fd-data=' + DATA_DIR]
    }
  });
  control.loadURL(url('/control/'));
  control.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith(url('/'))) return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: '#000' } };
    shell.openExternal(u);
    return { action: 'deny' };
  });
  control.on('close', e => {
    if (quitting) return;
    const r = dialog.showMessageBoxSync(control, {
      type: 'question', buttons: ['結束', '取消'], defaultId: 1, cancelId: 1,
      title: '結束 FUNKDATION', message: '要結束播出系統嗎？', detail: '所有資料都已自動存檔，輸出畫面也會一起關閉。'
    });
    if (r !== 0) { e.preventDefault(); return; }
    quitting = true;
  });
  control.on('closed', () => { control = null; app.quit(); });
}

ipcMain.handle('fd:displays', () => displayList());
ipcMain.handle('fd:openOutput', (e, id, fs) => { openOutput(id, fs !== false); return true; });
ipcMain.handle('fd:closeOutput', () => { closeOutput(); return true; });
ipcMain.handle('fd:openDataFolder', () => shell.openPath(DATA_DIR));

app.on('second-instance', () => {
  if (control) { if (control.isMinimized()) control.restore(); control.focus(); }
});

app.whenReady().then(async () => {
  try {
    server = require('./server');
    port = await server.ready;
  } catch (e) {
    dialog.showErrorBox('無法啟動', '播出系統的伺服器無法啟動：\n' + (e && e.message));
    app.quit();
    return;
  }
  sleepBlock = powerSaveBlocker.start('prevent-display-sleep');
  buildMenu();
  createControl();
  screen.on('display-added', buildMenu);
  screen.on('display-removed', buildMenu);
});

app.on('before-quit', () => {
  quitting = true;
  if (sleepBlock !== null && powerSaveBlocker.isStarted(sleepBlock)) powerSaveBlocker.stop(sleepBlock);
  try { if (server) server.shutdown(0, false); } catch (e) { /* 已經關閉 */ }
});

app.on('window-all-closed', () => app.quit());
