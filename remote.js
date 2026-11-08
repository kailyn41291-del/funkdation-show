'use strict';
// 遙控網頁（手機／平板）：同一個 Wi-Fi 的裝置輸入密碼後，可以加減比分、選四強、控制 Timer
//
// 權限：
//   - 這台電腦本身（127.0.0.1）：完整權限，控制台、輸出畫面、OBS 照舊
//   - 同網路其他裝置：只能開遙控網頁與輸出畫面（唯讀）；遙控登入後只能呼叫下面兩種指令
// 密碼存在資料夾的 remote.json（不放進賽事狀態，避免同步給其他裝置）

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const TOKEN_TTL = 24 * 60 * 60 * 1000;      // 登入一次可用 24 小時
const FAIL_WINDOW = 5 * 60 * 1000;          // 5 分鐘內
const FAIL_MAX = 8;                         // 最多錯 8 次

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function isLocal(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return LOOPBACK.has(a);
}

// 手機能連的網址：排除 169.254（還沒連上網路時的暫時位址），虛擬網卡（VPN、VMware、Docker…）排到最後
const VIRTUAL = /vmware|virtualbox|vbox|vethernet|hyper-v|docker|veth|br-|bridge|utun|tun|tap|zerotier|zt|tailscale|wsl|loopback/i;
function networks() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ ip: a.address, name, virtual: VIRTUAL.test(name) });
    }
  }
  const rank = n => (n.virtual ? 10 : 0) + (/^(192\.168|172\.20\.10)\./.test(n.ip) ? 0 : /^10\./.test(n.ip) ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

function createRemote({ dataDir, store, emit, lanAddresses, getPort }) {
  const file = path.join(dataDir, 'remote.json');
  // password：完整遙控（比分、四強、Timer）；timerPassword：Timer 專用（只能控制 Timer，選填）
  let config = { enabled: false, password: '', timerPassword: '' };
  try { config = Object.assign(config, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* 第一次使用 */ }
  const tokens = new Map();   // token -> { exp, ip, role: 'full' | 'timer' }
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
  // 回傳登入身分（'full'／'timer'），沒登入回傳 null
  function roleOf(req) {
    if (!config.enabled) return null;
    const t = tokenOf(req), rec = t && tokens.get(t);
    if (!rec) return null;
    if (rec.exp < Date.now()) { tokens.delete(t); return null; }
    return rec.role || 'full';
  }
  function authed(req) { return !!roleOf(req); }

  // ---------- 同網路裝置能開哪些網址 ----------
  const LAN_OK = [/^\/remote(\/|$)/, /^\/timer\/?$/, /^\/output(\/|$)/, /^\/shared\//, /^\/fonts\//, /^\/builtin\//, /^\/assets\//, /^\/favicon\./, /^\/api\/remote\/(login|me|score|top4|timer)$/];
  function gate(req, res, next) {
    if (isLocal(req)) return next();
    if (req.path === '/' || req.path === '/control' || req.path.startsWith('/control/')) return res.redirect('/remote/');
    if (req.path === '/timer' || req.path === '/timer/') return res.redirect('/remote/?timer=1');
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

  // Timer：與控制台相同（開始／暫停、重置、設定秒數），時間以這台電腦為準
  function timer(action, seconds) {
    const t = JSON.parse(JSON.stringify(store.state.show.timer || { duration: 60, endsAt: null, pausedLeft: 60 }));
    const now = Date.now();
    const left = t.endsAt ? Math.max(0, (t.endsAt - now) / 1000) : (t.pausedLeft != null ? t.pausedLeft : t.duration);
    let next;
    if (action === 'toggle') {
      if (t.endsAt && left > 0) next = Object.assign(t, { pausedLeft: left, endsAt: null });
      else { const l = left <= 0 ? t.duration : left; next = Object.assign(t, { pausedLeft: l, endsAt: now + l * 1000 }); }
    } else if (action === 'reset') {
      next = { duration: t.duration, endsAt: null, pausedLeft: t.duration };
    } else if (action === 'set') {
      const sec = Number(seconds);
      if (!Number.isInteger(sec) || sec < 1 || sec > 3600) throw new Error('秒數請輸入 1–3600 的整數');
      next = { duration: sec, endsAt: null, pausedLeft: sec };
    } else throw new Error('不支援的 Timer 操作');
    return emit([{ op: 'set', path: ['show', 'timer'], value: next }], null);
  }

  // ---------- 路由 ----------
  function routes(app) {
    // 這台電腦：設定密碼、看網址與 QR Code
    // Timer 專用頁的捷徑（這台電腦也能用）
    app.get(['/timer', '/timer/'], (req, res) => res.redirect('/remote/?timer=1'));
    app.get('/api/remote/config', (req, res) => {
      if (!isLocal(req)) return res.status(403).end();
      const port = getPort();
      const qr = u => QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      const list = networks().map(n => ({ ip: n.ip, name: n.name, virtual: n.virtual, url: `http://${n.ip}:${port}/remote/`, timerUrl: `http://${n.ip}:${port}/timer` }));
      Promise.all(list.map(x => Promise.all([qr(x.url), qr(x.timerUrl)]).then(([a, b]) => Object.assign(x, { qr: a, timerQr: b }))))
        .then(urls => {
          let full = 0, timerOnly = 0;
          for (const r of tokens.values()) if (r.exp > Date.now()) { if (r.role === 'timer') timerOnly++; else full++; }
          res.json({ enabled: config.enabled, password: config.password, timerPassword: config.timerPassword || '', devices: full + timerOnly, timerDevices: timerOnly, urls });
        })
        .catch(e => res.status(500).json({ ok: false, error: e.message }));
    });
    app.post('/api/remote/config', (req, res) => {
      if (!isLocal(req)) return res.status(403).end();
      const b = req.body || {};
      if (b.logoutAll) { revokeAll(); return res.json({ ok: true }); }
      const pw = b.password != null ? String(b.password).trim() : config.password;
      const tpw = b.timerPassword != null ? String(b.timerPassword).trim() : (config.timerPassword || '');
      const en = b.enabled != null ? !!b.enabled : config.enabled;
      if (en && pw.length < 4) return res.status(400).json({ ok: false, error: '密碼至少 4 個字' });
      if (tpw && tpw.length < 4) return res.status(400).json({ ok: false, error: 'Timer 專用密碼至少 4 個字（不需要就留空）' });
      if (tpw && tpw === pw) return res.status(400).json({ ok: false, error: 'Timer 專用密碼不能和完整遙控密碼一樣' });
      // 換密碼或關閉：所有手機都要重新登入；只換 Timer 專用密碼時，只登出 Timer 專用的裝置
      if (pw !== config.password || !en) revokeAll();
      else if (tpw !== (config.timerPassword || '')) { for (const [k, r] of tokens) if (r.role === 'timer') tokens.delete(k); }
      config = { enabled: en, password: pw, timerPassword: tpw };
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
      const given = String((req.body || {}).password || '');
      const isFull = !!config.password && safeEqual(given, config.password);
      const isTimer = !isFull && !!config.timerPassword && safeEqual(given, config.timerPassword);
      if (!isFull && !isTimer) {
        list.push(now); fails.set(ip, list);
        return res.status(401).json({ ok: false, error: '密碼不正確' });
      }
      fails.delete(ip);
      const role = isFull ? 'full' : 'timer';
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.set(token, { exp: now + TOKEN_TTL, ip, role });
      res.json({ ok: true, token, role });
    });
    app.get('/api/remote/me', (req, res) => { const role = roleOf(req); res.status(role ? 200 : 401).json({ ok: !!role, role, enabled: config.enabled }); });
    // full：完整遙控才能用；timer：兩種身分都能用
    function guarded(fn, need) {
      return (req, res) => {
        const role = roleOf(req);
        if (!role) return res.status(401).json({ ok: false, error: '請重新輸入密碼' });
        if (need === 'full' && role !== 'full') return res.status(403).json({ ok: false, error: 'Timer 專用密碼只能控制 Timer' });
        try { res.json({ ok: true, rev: fn(req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
      };
    }
    app.post('/api/remote/score', guarded(b => score(String(b.battle || ''), String(b.side || ''), b.delta), 'full'));
    app.post('/api/remote/top4', guarded(b => top4(b.index, b.team ? String(b.team) : null), 'full'));
    app.post('/api/remote/timer', guarded(b => timer(String(b.action || ''), b.seconds), 'timer'));
  }

  return { gate, routes, isLocal, authed, revokeAll, score, top4, timer, get config() { return config; } };
}

module.exports = { createRemote, isLocal, networks };
