'use strict';
// 遙控網頁（手機／平板）：同一個 Wi-Fi 的裝置輸入密碼後，可以加減比分、選四強
//
// 權限：
//   - 這台電腦本身（127.0.0.1）：完整權限，控制台、輸出畫面、OBS 照舊
//   - 同網路其他裝置：只能開遙控網頁與輸出畫面（唯讀）；遙控登入後只能呼叫下面兩種指令
// 密碼存在資料夾的 remote.json（不放進賽事狀態，避免同步給其他裝置）

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const TOKEN_TTL = 24 * 60 * 60 * 1000;      // 登入一次可用 24 小時
const FAIL_WINDOW = 5 * 60 * 1000;          // 5 分鐘內
const FAIL_MAX = 8;                         // 最多錯 8 次

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function isLocal(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return LOOPBACK.has(a);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

function createRemote({ dataDir, store, emit, lanAddresses, getPort }) {
  const file = path.join(dataDir, 'remote.json');
  let config = { enabled: false, password: '' };
  try { config = Object.assign(config, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* 第一次使用 */ }
  const tokens = new Map();   // token -> { exp, ip }
  const fails = new Map();    // ip -> [時間...]

  function saveConfig() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, file);
  }
  function revokeAll() { tokens.clear(); }

  function tokenOf(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/.exec(h);
    return m ? m[1] : '';
  }
  function authed(req) {
    if (!config.enabled) return false;
    const t = tokenOf(req), rec = t && tokens.get(t);
    if (!rec) return false;
    if (rec.exp < Date.now()) { tokens.delete(t); return false; }
    return true;
  }

  // ---------- 同網路裝置能開哪些網址 ----------
  const LAN_OK = [/^\/remote(\/|$)/, /^\/output(\/|$)/, /^\/shared\//, /^\/fonts\//, /^\/builtin\//, /^\/assets\//, /^\/favicon\./, /^\/api\/remote\/(login|me|score|top4)$/];
  function gate(req, res, next) {
    if (isLocal(req)) return next();
    if (req.path === '/' || req.path === '/control' || req.path.startsWith('/control/')) return res.redirect('/remote/');
    if (LAN_OK.some(r => r.test(req.path)) && (req.method === 'GET' || req.path.startsWith('/api/remote/'))) return next();
    res.status(403).json({ ok: false, error: '這台裝置只能使用遙控網頁（/remote）' });
  }

  // ---------- 遙控指令 ----------
  const SIDES = new Set(['l', 'r']);
  function battleIds() { return Object.keys((store.state.results && store.state.results.battles) || {}); }
  function score(battle, side, delta) {
    if (!battleIds().includes(battle)) throw new Error('沒有這個場次');
    if (!SIDES.has(side)) throw new Error('左右方不正確');
    delta = Math.round(Number(delta));
    if (![-1, 1, 2].includes(delta)) throw new Error('只能加 1、加 2 或減 1');
    const b = JSON.parse(JSON.stringify(store.state.results.battles[battle]));
    const v = Math.max(0, Math.min(50, (Number(b[side]) || 0) + delta));
    if (v === b[side]) return store.rev;
    // 與控制台相同：留下復原紀錄，並送出比分動畫事件
    b.hist = (b.hist || []).concat([{ l: b.l, r: b.r, round: b.round, seal: b.seal, winner: b.winner }]).slice(-100);
    b[side] = v;
    return emit([{ op: 'set', path: ['results', 'battles', battle], value: b }], { name: 'score', battle, side, value: v });
  }
  function top4(index, team) {
    index = Number(index);
    if (!(index >= 0 && index <= 3 && Number.isInteger(index))) throw new Error('四強位置不正確');
    const teams = store.state.teams || [];
    if (team) {
      const t = teams.find(x => x.id === team);
      if (!t || t.guest) throw new Error('這支隊伍不能選為四強');
    }
    const cur = (store.state.results.top4 || [null, null, null, null]).slice(0, 4);
    while (cur.length < 4) cur.push(null);
    if (team && cur.some((x, i) => x === team && i !== index)) throw new Error('這隊已經選過了');
    cur[index] = team || null;
    return emit([{ op: 'set', path: ['results', 'top4'], value: cur }], null);
  }

  // ---------- 路由 ----------
  function routes(app) {
    // 這台電腦：設定密碼、看網址與 QR Code
    app.get('/api/remote/config', (req, res) => {
      if (!isLocal(req)) return res.status(403).end();
      const port = getPort();
      const urls = lanAddresses().map(ip => `http://${ip}:${port}/remote/`);
      Promise.all(urls.map(u => QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })))
        .then(qrs => res.json({ enabled: config.enabled, password: config.password, devices: tokens.size, urls: urls.map((u, i) => ({ url: u, qr: qrs[i] })) }))
        .catch(e => res.status(500).json({ ok: false, error: e.message }));
    });
    app.post('/api/remote/config', (req, res) => {
      if (!isLocal(req)) return res.status(403).end();
      const b = req.body || {};
      if (b.logoutAll) { revokeAll(); return res.json({ ok: true }); }
      const pw = b.password != null ? String(b.password).trim() : config.password;
      const en = b.enabled != null ? !!b.enabled : config.enabled;
      if (en && pw.length < 4) return res.status(400).json({ ok: false, error: '密碼至少 4 個字' });
      if (pw !== config.password || !en) revokeAll();   // 換密碼或關閉：所有手機都要重新登入
      config = { enabled: en, password: pw };
      saveConfig();
      res.json({ ok: true });
    });

    // 手機：登入
    app.post('/api/remote/login', (req, res) => {
      const ip = req.socket.remoteAddress || '';
      const now = Date.now();
      const list = (fails.get(ip) || []).filter(t => now - t < FAIL_WINDOW);
      if (list.length >= FAIL_MAX) return res.status(429).json({ ok: false, error: '密碼錯太多次，請 5 分鐘後再試' });
      if (!config.enabled) return res.status(403).json({ ok: false, error: '遙控網頁沒有開啟，請在控制台「設定」開啟' });
      if (!config.password || !safeEqual(String((req.body || {}).password || ''), config.password)) {
        list.push(now); fails.set(ip, list);
        return res.status(401).json({ ok: false, error: '密碼不正確' });
      }
      fails.delete(ip);
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.set(token, { exp: now + TOKEN_TTL, ip });
      res.json({ ok: true, token });
    });
    app.get('/api/remote/me', (req, res) => res.status(authed(req) ? 200 : 401).json({ ok: authed(req), enabled: config.enabled }));
    function guarded(fn) {
      return (req, res) => {
        if (!authed(req)) return res.status(401).json({ ok: false, error: '請重新輸入密碼' });
        try { res.json({ ok: true, rev: fn(req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
      };
    }
    app.post('/api/remote/score', guarded(b => score(String(b.battle || ''), String(b.side || ''), b.delta)));
    app.post('/api/remote/top4', guarded(b => top4(b.index, b.team ? String(b.team) : null)));
  }

  return { gate, routes, isLocal, authed, revokeAll, score, top4, get config() { return config; } };
}

module.exports = { createRemote, isLocal };
