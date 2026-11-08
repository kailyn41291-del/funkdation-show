'use strict';
// 切換 Cue 不閃：每種畫面切進來時，逐格記錄所有元素的不透明度，
// 不能有「先出現、又消失、再淡入」的情形（跳閃）；底圖交接時每一格都要完整蓋住
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || 'test/assets');
const PORT = 3215, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-flash-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });
async function upload(f) { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, f))]), f); return (await (await fetch(BASE + '/api/upload', { method: 'POST', body: fd })).json()).path; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  // 有贊助商 Logo、隊伍照片、四強、主視覺圖片：盡量接近正式演出
  const logos = [];
  for (const f of ['logo0.png', 'logo1.png', 'logo2.png']) logos.push({ id: f, src: await upload(f), scale: 100 });
  const photo = await upload('p6.png'), bg = await upload('bg.jpg');
  const set = [{ op: 'set', path: ['sponsors', 'logos'], value: logos }, { op: 'set', path: ['sponsors', 'band'], value: 'dark' },
    { op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] },
    { op: 'set', path: ['layouts', 'idle', 'bg'], value: { mode: 'image', src: bg, color: '#8b2420', texture: true, sound: false } }];
  for (let i = 0; i < 9; i++) set.push({ op: 'set', path: ['teams', i, 'photo', 'src'], value: photo });
  await ops(set);
  const st = (await (await fetch(BASE + '/api/state')).json()).state;
  const extra = [{ id: 'x-judge', type: 'judge', judge: 'j1' }, { id: 'x-mc', type: 'mc', judge: 'm1' }];
  await ops([{ op: 'set', path: ['cues'], value: st.cues.concat(extra) }]);
  const cues = st.cues.concat(extra);
  const seen = new Set(), targets = [];
  for (const c of cues) { const k = c.type + (c.type === 'battle' ? ':' + c.battle : ''); if (!seen.has(k)) { seen.add(k); targets.push(c); } }

  const browser = await chromium.launch({ executablePath: CHROME });
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '/output/');
  await sleep(1500);
  let seq = 10;
  for (const c of targets) {
    // 每次都從「單隊展示」切過來
    await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-team1' }, { op: 'set', path: ['show', 'seq'], value: seq++ }]);
    await sleep(1600);
    await p.evaluate(() => {
      window.__rec = []; window.__cover = 1;
      const L = [document.getElementById('bgA'), document.getElementById('bgB')];
      const t0 = performance.now();
      (function f() {
        const scs = document.querySelectorAll('#scenes .scene'), root = scs[scs.length - 1];
        const o = L.map(e => +getComputedStyle(e).opacity);
        window.__cover = Math.min(window.__cover, 1 - (1 - o[0]) * (1 - o[1]));
        if (root && root.dataset.mark !== 'old') {
          const frame = [];
          root.querySelectorAll('*').forEach((el, i) => {
            if (!el.__id) el.__id = 'e' + Math.random().toString(36).slice(2, 8);
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            let op = 1, n = el;
            while (n && n !== document.body) { op *= +getComputedStyle(n).opacity; n = n.parentElement; }
            frame.push([el.__id, el.className && el.className.baseVal == null ? el.className : el.tagName, +op.toFixed(2)]);
          });
          window.__rec.push({ t: performance.now() - t0, frame });
        }
        if (performance.now() - t0 < 1500) requestAnimationFrame(f);
      })();
      document.querySelectorAll('#scenes .scene').forEach(s => { s.dataset.mark = 'old'; });
    });
    await ops([{ op: 'set', path: ['show', 'cueId'], value: c.id }, { op: 'set', path: ['show', 'seq'], value: seq++ }]);
    await sleep(1700);
    const r = await p.evaluate(() => ({ rec: window.__rec, cover: window.__cover }));
    // 找「先看得到（>0.3）→ 消失（<0.05）→ 之後又出現」的元素
    const hist = {};
    r.rec.forEach(f => f.frame.forEach(([id, cls, op]) => { (hist[id] = hist[id] || { cls, ops: [] }).ops.push(op); }));
    // 新畫面第一格就看得到、之後又消失 → 跳閃（正常的登場都是從 0 開始淡入）
    const pops = Object.values(hist).filter(h => h.ops[0] > 0.3 && h.ops.slice(1).some(v => v < 0.05)).map(h => h.cls);
    check(`切到「${c.name || c.type}」不跳閃`, pops.length === 0 && r.cover > 0.999, pops.length ? '跳閃：' + [...new Set(pops)].join(', ') : '底圖覆蓋最低 ' + r.cover.toFixed(3));
  }
  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
