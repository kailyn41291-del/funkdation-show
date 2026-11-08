'use strict';
// FUNKDATION VOL.4 賽事播出系統 — 本機伺服器（M1）
// 控制面板：http://localhost:3010/control
// 輸出畫面：http://localhost:3010/output （可直接當 OBS 瀏覽器來源）

const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { WebSocketServer } = require('ws');
const { Store } = require('./store');
const { createRemote, isLocal } = require('./remote');

let PORT = Number(process.env.FD_PORT) || 3010;
const DATA_DIR = process.env.FD_DATA || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1GB，底圖影片可能很大

const store = new Store(DATA_DIR, {
  saveDelay: Number(process.env.FD_SAVE_DELAY) || 250,
  backupEvery: Number(process.env.FD_BACKUP_EVERY) || 5 * 60 * 1000
});

const log = (...a) => console.log(new Date().toLocaleTimeString('zh-TW', { hour12: false }), ...a);
log(`狀態載入來源：${store.loadedFrom}（版本 ${store.rev}）`);
if (store.loadedFrom.startsWith('backup:')) log('⚠ 主存檔損壞，已從備份恢復');

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

// 遙控網頁：同網路其他裝置只能開遙控頁與輸出畫面，這台電腦本身不受影響
const remote = createRemote({
  dataDir: DATA_DIR, store, lanAddresses: () => lanAddresses(), getPort: () => PORT,
  // 遙控指令跟控制台一樣：先送動畫事件，再套用修改
  emit(ops, event) {
    if (event) broadcast({ type: 'event', event, origin: 'remote' });
    currentMeta = { origin: 'remote', id: null, quiet: false, event: event ? event.name : null };
    try { return store.apply(ops); } finally { currentMeta = null; }
  }
});
app.use(remote.gate);
// 換密碼、關閉遙控或登出時：已連線的手機版總控立刻失去操作權並斷線
remote.onAuthChange(() => {
  for (const c of wss.clients) {
    if (!c.readOnly && c.remote && remote.roleOfToken(c.token) !== 'master') { c.readOnly = true; try { c.close(4001, 'auth'); } catch { /* 已關閉 */ } }
  }
});
remote.routes(app);

app.get('/', (req, res) => res.redirect('/control/'));
app.get(['/favicon.svg', '/favicon.ico'], (req, res) => res.type('image/svg+xml').sendFile(path.join(PUBLIC_DIR, 'favicon.svg')));
app.use('/fonts', express.static(path.join(PUBLIC_DIR, 'fonts'), { maxAge: '7d' }));
app.use('/control', express.static(path.join(PUBLIC_DIR, 'control')));
app.use('/output', express.static(path.join(PUBLIC_DIR, 'output')));
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));
app.use('/remote', express.static(path.join(PUBLIC_DIR, 'remote')));
app.use('/clock', express.static(path.join(PUBLIC_DIR, 'clock')));
app.use('/builtin', express.static(path.join(PUBLIC_DIR, 'builtin'), { maxAge: '7d' }));
app.use('/assets', express.static(store.assetsDir, { maxAge: 0 }));

app.get('/api/state', (req, res) => res.json(store.snapshot()));
app.get('/api/defaults', (req, res) => res.json(require('./default-state').defaultState()));

// 目前連線中的畫面（只有這台電腦能看）
app.get('/api/clients', (req, res) => {
  if (!isLocal(req)) return res.status(403).end();
  const counts = {};
  for (const c of wss.clients) {
    if (c.readyState !== 1) continue;
    const k = c.kind + (c.remote ? '@lan' : '');
    counts[k] = (counts[k] || 0) + 1;
  }
  res.json({ counts });
});

app.get('/api/info', (req, res) => {
  res.json({ rev: store.rev, savedRev: store.savedRev, loadedFrom: store.loadedFrom, serverTime: Date.now(), addresses: lanAddresses() });
});

app.post('/api/ops', (req, res) => {
  try {
    const rev = store.apply(req.body.ops);
    res.json({ ok: true, rev });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 上傳素材：照片、外框、底圖圖片／影片、Logo、字型
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.webm', '.mov', '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.wav']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.assetsDir),
    filename: (req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(original).toLowerCase();
      const base = path.basename(original, path.extname(original)).replace(/[^\w一-鿿぀-ヿ-]+/g, '_').slice(0, 40) || 'file';
      cb(null, `${Date.now().toString(36)}-${base}${ext}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(Buffer.from(file.originalname, 'latin1').toString('utf8')).toLowerCase();
    if (ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error('不支援的檔案類型：' + ext));
  }
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    if (!req.file) return res.status(400).json({ ok: false, error: '沒有收到檔案' });
    res.json({ ok: true, path: 'assets/' + req.file.filename, size: req.file.size });
  });
});

app.get('/api/backups', (req, res) => res.json({ backups: store.listBackups() }));

app.post('/api/backups/now', (req, res) => {
  try {
    res.json({ ok: true, name: store.backupNow(true) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/backups/restore', (req, res) => {
  try {
    const rev = store.restoreBackup(String(req.body.name || ''));
    res.json({ ok: true, rev });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 匯出整個賽事（狀態＋所有素材）成 zip
app.get('/api/export', (req, res) => {
  try {
    store.saveNow();
    const zip = new AdmZip();
    zip.addLocalFile(store.file, '', 'state.json');
    if (fs.existsSync(store.assetsDir)) zip.addLocalFolder(store.assetsDir, 'assets');
    const buf = zip.toBuffer();
    const d = new Date();
    const name = `funkdation-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.zip`;
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` });
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 匯入：先備份目前狀態，再以 zip 內容取代
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD * 2 } });
app.post('/api/import', (req, res) => {
  importUpload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    if (!req.file) return res.status(400).json({ ok: false, error: '沒有收到檔案' });
    try {
      const zip = new AdmZip(req.file.buffer);
      const entry = zip.getEntry('state.json');
      if (!entry) throw new Error('壓縮檔裡找不到 state.json');
      const parsed = JSON.parse(entry.getData().toString('utf8'));
      if (!parsed || typeof parsed.state !== 'object') throw new Error('state.json 格式不正確');
      store.backupNow(true);
      for (const e of zip.getEntries()) {
        if (e.isDirectory || !e.entryName.startsWith('assets/')) continue;
        const rel = e.entryName.slice('assets/'.length);
        const target = path.resolve(store.assetsDir, rel);
        if (!target.startsWith(path.resolve(store.assetsDir) + path.sep)) continue; // 防止路徑跳脫
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, e.getData());
      }
      const rev = store.replaceState(parsed.state);
      res.json({ ok: true, rev });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
});

app.use((req, res) => res.status(404).json({ ok: false, error: '找不到 ' + req.path }));

// ---------- WebSocket 即時同步 ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 20 * 1024 * 1024 });

function broadcast(msg) {
  const text = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(text);
}

let currentMeta = null;
store.on('change', (rev, ops) => broadcast({ type: 'ops', rev, ops, meta: currentMeta }));
store.on('replace', rev => broadcast({ type: 'state', rev, state: store.state }));
store.on('saved', rev => broadcast({ type: 'saved', rev }));
store.on('backup', name => log('已備份', name));
store.on('error-log', e => log('錯誤', e.message));

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  // 其他裝置（遙控網頁、另一台電腦的輸出畫面）只能讀取，修改一律走遙控指令；
  // 例外：用總控密碼登入的手機版控台，可以跟控制台一樣操作
  let q = null;
  try { q = new URL(req.url, 'http://x').searchParams; } catch { q = new URLSearchParams(); }
  ws.kind = q.get('kind') || 'other';
  ws.token = q.get('token') || '';
  ws.readOnly = !isLocal(req) && remote.roleOfToken(ws.token) !== 'master';
  ws.remote = !isLocal(req);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'hello', rev: store.rev, savedRev: store.savedRev, state: store.state, serverTime: Date.now() }));
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'ops') {
      if (ws.readOnly) { ws.send(JSON.stringify({ type: 'nack', id: msg.id, error: '這台裝置只能讀取', rev: store.rev })); return; }
      try {
        // 動畫事件先送出，再送狀態，輸出畫面才能分辨「要播動畫」還是「直接套用」
        if (msg.event) broadcast({ type: 'event', event: msg.event, origin: msg.origin || null });
        currentMeta = { origin: msg.origin || null, id: msg.id, quiet: !!msg.quiet, event: msg.event ? msg.event.name : null };
        let rev = store.rev;
        try {
          if (msg.ops && msg.ops.length) rev = store.apply(msg.ops);
        } finally {
          currentMeta = null;
        }
        ws.send(JSON.stringify({ type: 'ack', id: msg.id, rev }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'nack', id: msg.id, error: e.message, rev: store.rev }));
      }
    } else if (msg.type === 'time') {
      ws.send(JSON.stringify({ type: 'time', t0: msg.t0, serverTime: Date.now() }));
    } else if (msg.type === 'resync') {
      ws.send(JSON.stringify({ type: 'state', rev: store.rev, state: store.state }));
    }
  });
});

// 偵測斷線的用戶端
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000);
heartbeat.unref();

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------- 啟動與關閉 ----------
function shutdown(code = 0, exit = true) {
  try { store.close(); log('已存檔，關閉伺服器'); } catch (e) { log('關閉時存檔失敗', e.message); }
  if (exit) process.exit(code);
}
if (require.main === module) {
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGHUP', () => shutdown(0));
}
process.on('uncaughtException', e => { log('未預期的錯誤', e); try { store.saveNow(); } catch { /* 忽略 */ } });

let tries = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && tries < 20) {
    tries++;
    log(`連接埠 ${PORT} 已被佔用，改用 ${PORT + 1}`);
    PORT++;
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 50);
    return;
  }
  log('伺服器無法啟動', e.message);
  if (require.main === module) process.exit(1);
});

let resolveReady;
const ready = new Promise(r => { resolveReady = r; });

server.listen(PORT, '0.0.0.0');
server.on('listening', () => {
  store.startBackups();
  log('========================================');
  log(' FUNKDATION VOL.4 賽事播出系統已啟動');
  log(` 控制面板： http://localhost:${PORT}/control`);
  log(` 輸出畫面： http://localhost:${PORT}/output`);
  for (const ip of lanAddresses()) log(` 遙控網頁（同 Wi-Fi 手機）： http://${ip}:${PORT}/remote`);
  log(' 關閉這個視窗即可結束（資料已自動存檔）');
  log('========================================');
  resolveReady(PORT);
});

module.exports = { app, server, store, ready, lanAddresses, shutdown, getPort: () => PORT };
