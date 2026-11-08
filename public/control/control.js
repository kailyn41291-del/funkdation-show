/* FUNKDATION 控制面板 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 基本工具
  // ---------------------------------------------------------------------------
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function getAt(o, p) { return FD.getAt(o, p); }
  function uid(prefix) { return (prefix || 'c-') + Math.random().toString(36).slice(2, 8); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = document.querySelector('.toast') || document.body.appendChild(h('div', { class: 'toast' }));
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, bad ? 5000 : 2200);
  }
  function fail(e) { toast(e && e.message ? e.message : String(e), true); }

  // ---------------------------------------------------------------------------
  // 狀態與連線
  // ---------------------------------------------------------------------------
  var S = null, D = null;
  var ui = Object.assign({ page: 'flow', mode: 'edit', sel: null, tabs: {}, photoSide: 'L', team: 't1', pkind: 'judge', psel: {}, guides: { safe: false, lines: false } },
    (function () { try { return JSON.parse(localStorage.getItem('fd-ui') || '{}'); } catch (e) { return {}; } })());
  // 演出小面板（?mini=1）：永遠在最上層的小視窗，只有 GO 與播出中 Cue 的操作，搭配 OBS／Arena 時不用切視窗
  var MINI = /[?&]mini=1/.test(location.search);
  // 手機版總控（?phone=1）：同 Wi-Fi 的手機用總控密碼登入，切換 Cue 與所有演出操作
  var PHONE = /[?&]phone=1/.test(location.search);
  var PHONE_TOKEN = null;
  if (PHONE) {
    MINI = true;
    document.documentElement.classList.add('phone');
    try { PHONE_TOKEN = localStorage.getItem('fd-remote-token'); } catch (e) { /* 私密瀏覽 */ }
    var isHere = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
    // 不是這台電腦：一定要用總控密碼登入，否則回到登入頁
    var checkMaster = function () {
      if (isHere) return;
      fetch('/api/remote/me', { headers: PHONE_TOKEN ? { Authorization: 'Bearer ' + PHONE_TOKEN } : {} })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.role !== 'master') location.replace('/remote/?master=1'); })
        .catch(function () { /* 連線中斷：等重新連線 */ });
    };
    checkMaster();
    setInterval(checkMaster, 15000);
  }
  if (MINI) { ui.page = 'flow'; ui.mode = 'show'; document.documentElement.classList.add('mini'); }
  function saveUi() { if (MINI) return; try { localStorage.setItem('fd-ui', JSON.stringify(ui)); } catch (e) { /* 忽略 */ } }

  var status = { conn: 'connecting', saved: true };
  var fd = FD.connect({
    kind: PHONE ? 'phone' : MINI ? 'mini' : 'control',
    token: PHONE_TOKEN,
    onState: function (state, rev, reason, meta) {
      S = state;
      if (!D) return;
      if (reason === 'hello' || reason === 'state') { renderAll(); return; }
      status.saved = fd.savedRev >= rev;
      renderStatus();
      if (meta && meta.origin === fd.id) refreshLive();
      else scheduleRender();
    },
    onStatus: function (s) { status.conn = s; renderStatus(); },
    onSaved: function (r) { status.saved = r >= fd.rev; renderStatus(); },
    // 尚未送出的本機修改，伺服器回傳舊確認時要重新套上
    localOps: function () {
      var ops = [];
      if (!pendingOps) return ops;
      pendingOps.forEach(function (v, k) { ops.push({ op: 'set', path: JSON.parse(k), value: v }); });
      return ops;
    }
  });
  fetch('/api/defaults').then(function (r) { return r.json(); }).then(function (d) { D = d; if (S) renderAll(); }).catch(fail);

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderPage(true); });
  }

  // 修改：先套用在本機，合併同一欄位後每個畫格最多送一次
  var pendingOps = new Map(), flushQueued = false;
  function setPath(path, value) {
    FD.applyOne(S, { op: 'set', path: path, value: value });
    pendingOps.set(JSON.stringify(path), value);
    status.saved = false;
    renderStatus();
    if (!flushQueued) { flushQueued = true; requestAnimationFrame(flush); }
  }
  function flush() {
    flushQueued = false;
    if (!pendingOps.size) return;
    var ops = [];
    pendingOps.forEach(function (v, k) { ops.push({ op: 'set', path: JSON.parse(k), value: v }); });
    pendingOps.clear();
    fd.send(ops).catch(fail);
  }
  // 演出指令：可附帶動畫事件
  function cmd(ops, event, quiet) {
    flush();
    ops.forEach(function (op) { FD.applyOne(S, op); });
    fd.cmd(ops, { event: event || null, quiet: !!quiet }).catch(fail);
    refreshLive();
  }
  function set(path, value) { return { op: 'set', path: path, value: value }; }

  // 預設值：own 版型對應回 battle
  function defAt(path) {
    var p = path.slice();
    if (p[0] === 'layouts' && typeof p[1] === 'string' && p[1].indexOf('battle@') === 0) p[1] = 'battle';
    return getAt(D, p);
  }

  // ---------------------------------------------------------------------------
  // 表單元件
  // ---------------------------------------------------------------------------
  function slider(o) {
    var step = o.step || 1;
    var r = h('input', { type: 'range', min: o.min, max: o.max, step: step, 'aria-label': o.label });
    var n = h('input', { type: 'number', step: step, 'aria-label': o.label + '數值' });
    function show() { var v = o.get(); if (v == null) v = o.def; r.value = clamp(v, o.min, o.max); n.value = v; }
    function put(v) { o.set(v); show(); }
    r.addEventListener('input', function () { put(+r.value); });
    n.addEventListener('input', function () {
      var v = Number(n.value);
      if (n.value === '' || !isFinite(v)) return;
      v = step < 1 ? v : Math.round(v);
      o.set(v);
      r.value = clamp(v, o.min, o.max);
    });
    n.addEventListener('blur', show);
    var rs = h('button', { class: 'rs', title: '重置為 ' + o.def + (o.unit || ''), 'aria-label': '重置' + o.label, text: '↺', onclick: function () { put(o.def); } });
    show();
    var row = h('div', { class: 'row2' }, h('label', { text: o.label, title: o.label }), r, n, rs);
    row.sync = show;
    return row;
  }
  // 綁定到狀態路徑的拉桿
  function sl(path, label, min, max, extra) {
    extra = extra || {};
    var def = extra.def != null ? extra.def : defAt(path);
    if (def == null) def = 0;
    return slider({
      label: label, min: min, max: max, step: extra.step, def: def, unit: extra.unit,
      get: function () { return getAt(S, path); },
      set: function (v) { setPath(path, v); if (extra.after) extra.after(v); }
    });
  }
  function fld(label, control, hint) {
    return h('div', { class: 'fld' }, h('label', { text: label }), h('div', { class: 'inl' }, control, hint ? h('span', { class: 'faint', text: hint }) : null));
  }
  function sel(options, value, onchange, attrs) {
    var s = h('select', attrs || {});
    options.forEach(function (o) {
      if (o.group) {
        var g = h('optgroup', { label: o.group });
        o.items.forEach(function (it) { g.appendChild(h('option', { value: it[0], text: it[1] })); });
        s.appendChild(g);
      } else s.appendChild(h('option', { value: o[0], text: o[1] }));
    });
    s.value = value;
    s.addEventListener('change', function () { onchange(s.value, s); });
    return s;
  }
  function selPath(path, options, after) {
    return sel(options, getAt(S, path), function (v) { setPath(path, v); if (after) after(v); });
  }
  function txtPath(path, placeholder, after) {
    var i = h('input', { type: 'text', value: getAt(S, path) || '', placeholder: placeholder || '' });
    i.addEventListener('input', function () { setPath(path, i.value); if (after) after(i.value); });
    return i;
  }
  function chk(label, path, after) {
    var c = h('input', { type: 'checkbox', checked: !!getAt(S, path) });
    c.addEventListener('change', function () { setPath(path, c.checked); if (after) after(c.checked); });
    return h('label', { style: 'display:inline-flex;gap:6px;align-items:center;cursor:pointer;color:var(--text)' }, c, label);
  }
  function colorPath(path) {
    var c = h('input', { type: 'color', value: getAt(S, path) || '#000000' });
    c.addEventListener('input', function () { setPath(path, c.value); });
    return c;
  }
  function uploadBtn(label, accept, multiple, handler) {
    var input = h('input', { type: 'file', accept: accept, multiple: !!multiple });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files);
      input.value = '';
      if (files.length) handler(files);
    });
    return h('label', { class: 'upload' }, input, h('span', { class: 'btnlike' }, h('button', { type: 'button', text: label, onclick: function () { input.click(); } })));
  }
  function upload(file) {
    toast('上傳中：' + file.name);
    return fd.upload(file, function (p) { toast('上傳中：' + file.name + ' ' + Math.round(p * 100) + '%'); })
      .then(function (r) { toast('已上傳 ' + file.name); return r.path; });
  }

  // 上傳前確認這台電腦能播放影片（ok / bad / unknown）
  function checkVideo(file) {
    return new Promise(function (res) {
      var v = document.createElement('video'), u = URL.createObjectURL(file), done = false;
      function fin(ok) { if (done) return; done = true; var r = { ok: ok, w: v.videoWidth, h: v.videoHeight }; v.removeAttribute('src'); v.load(); URL.revokeObjectURL(u); res(r); }
      v.muted = true;
      v.preload = 'auto';
      v.onloadeddata = function () { fin(v.videoWidth > 0 ? 'ok' : 'bad'); };
      v.onerror = function () { fin('bad'); };
      setTimeout(function () { fin('unknown'); }, 8000);
      v.src = u;
    });
  }

  // 去背照片：自動偵測人物範圍，裁掉四周透明
  function processPhoto(file) {
    return upload(file).then(function (src) {
      if (!/png|webp/i.test(file.type)) return { src: src, trim: null };
      return createImageBitmap(file).then(function (bmp) {
        var W = bmp.width, H = bmp.height, k = Math.min(1, 1000 / Math.max(W, H));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
        var x = c.getContext('2d');
        x.drawImage(bmp, 0, 0, c.width, c.height);
        var d = x.getImageData(0, 0, c.width, c.height).data;
        var x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (var y = 0; y < c.height; y++) for (var i = 0; i < c.width; i++) {
          if (d[(y * c.width + i) * 4 + 3] > 12) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0 || (x0 <= 1 && y0 <= 1 && x1 >= c.width - 2 && y1 >= c.height - 2)) return { src: src, trim: null };
        var m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
        x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m);
        var sx = x0 / k, sy = y0 / k, sw = (x1 - x0 + 1) / k, sh = (y1 - y0 + 1) / k;
        var ok = Math.min(1, 2400 / Math.max(sw, sh));
        var o = document.createElement('canvas');
        o.width = Math.round(sw * ok); o.height = Math.round(sh * ok);
        o.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, o.width, o.height);
        return new Promise(function (res) { o.toBlob(res, 'image/png'); }).then(function (blob) {
          var f = new File([blob], file.name.replace(/\.\w+$/, '') + '-trim.png', { type: 'image/png' });
          return fd.upload(f).then(function (r) { return { src: src, trim: r.path }; });
        });
      }).catch(function () { return { src: src, trim: null }; });
    });
  }

  // ---------------------------------------------------------------------------
  // 監看畫面（iframe 1920×1080 縮放）
  // ---------------------------------------------------------------------------
  // 監看畫面直接以小尺寸渲染（輸出頁會自己縮放），比先畫 1920×1080 再縮小省很多效能
  var monitors = [];
  function monitor(src, label, cls) {
    var f = h('iframe', { src: src, title: label, tabindex: '-1' });
    var m = h('div', { class: 'mon ' + (cls || '') }, h('div', { class: 'lab', text: label }), f);
    monitors.push(m);
    return { el: m, frame: f, post: function (msg) { msg.fd = 'preview'; try { f.contentWindow.postMessage(msg, '*'); } catch (e) { /* 忽略 */ } } };
  }

  // ---------------------------------------------------------------------------
  // 頂部列
  // ---------------------------------------------------------------------------
  var root = document.getElementById('app');
  var headerEl, mainEl;
  function renderAll() {
    root.innerHTML = '';
    headerEl = h('header');
    mainEl = h('main');
    root.appendChild(h('div', { class: 'offline-banner', id: 'offline', text: '與伺服器的連線中斷，正在重新連線…（輸出畫面會保持最後的狀態）' }));
    root.appendChild(headerEl);
    root.appendChild(mainEl);
    renderHeader();
    renderPage(false);
  }
  var PAGES = [['flow', '流程'], ['teams', '隊伍'], ['judges', '評審／MC／DJ'], ['sponsors', '贊助商'], ['assets', '素材與字型'], ['settings', '設定']];
  function renderHeader() {
    headerEl.innerHTML = '';
    if (MINI) {
      var top = !window.funk || !window.funk.miniOnTop || miniTop;
      add(headerEl, [
        h('div', { class: 'brand', text: 'FUNKDATION' }, h('small', { text: PHONE ? '總控' : '演出小面板' })),
        h('div', { class: 'spacer' }),
        window.funk && window.funk.miniOnTop ? h('button', { class: 'small' + (top ? ' on' : ''), title: '永遠顯示在其他視窗（OBS、Arena）上面', text: top ? '📌 置頂中' : '置頂', onclick: function () {
          miniTop = !miniTop; window.funk.miniOnTop(miniTop); renderHeader();
        } }) : null,
        h('div', { class: 'status', id: 'status' }),
        PHONE ? h('button', { class: 'small', text: '登出', onclick: function () {
          try { localStorage.removeItem('fd-remote-token'); localStorage.removeItem('fd-remote-role'); } catch (e) { /* 忽略 */ }
          location.replace('/remote/?master=1');
        } }) : null
      ]);
      renderStatus();
      return;
    }
    add(headerEl, [
      h('div', { class: 'brand', text: 'FUNKDATION' }, h('small', { text: '控制台' })),
      h('nav', null, PAGES.map(function (p) {
        return h('button', { class: ui.page === p[0] ? 'on' : '', text: p[1], onclick: function () { ui.page = p[0]; saveUi(); renderHeader(); renderPage(false); } });
      })),
      ui.page === 'flow' ? h('div', { class: 'seg' },
        h('button', { class: ui.mode === 'edit' ? 'on' : '', text: '編排', onclick: function () { setMode('edit'); } }),
        h('button', { class: ui.mode === 'show' ? 'on' : '', text: '演出', onclick: function () { setMode('show'); } })) : null,
      h('div', { class: 'spacer' }),
      window.funk && window.funk.openMini ? h('button', { text: '演出小面板', title: '開一個永遠在最上層的小視窗（GO、比分、Timer、印章），搭配 OBS／Arena 時不用來回切換', onclick: function () { window.funk.openMini(); } }) : null,
      window.funk ? h('button', { text: '開啟輸出畫面', title: '有第二個螢幕（投影機）時會全螢幕顯示在第二個螢幕', onclick: function () {
        window.funk.displays().then(function (list) {
          var ext = list.filter(function (d) { return !d.primary; })[0];
          window.funk.openOutput(ext ? ext.id : list[0].id, !!ext);
          if (!ext) toast('目前只偵測到一個螢幕，輸出畫面以視窗開啟。接上投影機後到「設定」選擇螢幕。');
        });
      } }) : h('a', { href: '/output/', target: 'fd-output' }, h('button', { text: '開啟輸出畫面' })),
      h('div', { class: 'status', id: 'status' })
    ]);
    renderStatus();
  }
  function setMode(m) {
    ui.mode = m; saveUi();
    if (m === 'show' && !S.show.cueId && S.cues.length) toast('按 GO（空白鍵）開始播出第一個 Cue');
    renderHeader(); renderPage(false);
  }
  function renderStatus() {
    var st = document.getElementById('status');
    if (!st) return;
    var c = status.conn;
    st.innerHTML = '';
    add(st, [
      h('span', null, h('span', { class: 'dot ' + (c === 'online' ? 'ok' : c === 'offline' ? 'bad' : 'wait') }), c === 'online' ? '已連線' : c === 'offline' ? '連線中斷' : '連線中'),
      h('span', null, h('span', { class: 'dot ' + (status.saved ? 'ok' : 'wait') }), status.saved ? '已自動存檔' : '儲存中…')
    ]);
    var off = document.getElementById('offline');
    if (off) off.style.display = c === 'offline' ? 'block' : 'none';
  }

  // ---------------------------------------------------------------------------
  // 頁面
  // ---------------------------------------------------------------------------
  var flowView = null; // { mode, cues, center, insp, previewMon, liveMon, nextMon }
  var miniTop = true;
  function renderPage(partial) {
    if (!S || !D) return;
    liveUpdaters = [];
    if (ui.page === 'flow') {
      if (!partial || !flowView || flowView.mode !== ui.mode) buildFlow();
      else { renderCueList(); renderInspector(); syncMonitors(); }
    } else {
      flowView = null;
      if (ui.page !== 'settings') remoteCache = null;
      // 其他裝置更新狀態時整頁會重畫：正在打字的遙控密碼欄要保留內容、游標與焦點
      var ae = document.activeElement, keep = null;
      if (remoteCache && ae && remoteCache.contains(ae)) keep = { el: ae, a: ae.selectionStart, b: ae.selectionEnd };
      var y = mainEl.firstChild ? mainEl.firstChild.scrollTop : 0;
      mainEl.innerHTML = '';
      monitors = [];
      var page = h('div', { class: 'page' });
      mainEl.appendChild(page);
      ({ teams: pageTeams, judges: pageJudges, sponsors: pageSponsors, assets: pageAssets, settings: pageSettings })[ui.page](page);
      page.scrollTop = y;
      if (keep && document.body.contains(keep.el)) {
        keep.el.focus();
        try { keep.el.setSelectionRange(keep.a, keep.b); } catch (e) { /* 核取方塊沒有游標 */ }
      }
    }
    refreshLive();
  }

  // ---------------------------------------------------------------------------
  // 流程頁
  // ---------------------------------------------------------------------------
  function cueIndex(id) { for (var i = 0; i < S.cues.length; i++) if (S.cues[i].id === id) return i; return -1; }
  function cueById(id) { var i = cueIndex(id); return i >= 0 ? S.cues[i] : null; }
  function selCue() {
    var c = cueById(ui.sel);
    if (!c && S.cues.length) { ui.sel = S.cues[0].id; c = S.cues[0]; }
    return c;
  }
  function liveCue() { return cueById(S.show.cueId); }
  function nextCue() {
    var i = cueIndex(S.show.cueId);
    return S.cues[i + 1] || null;
  }

  function buildFlow() {
    mainEl.innerHTML = '';
    monitors = [];
    var cuesCol = h('div', { class: 'col cues' });
    var center = h('div', { class: 'col center' });
    var insp = h('div', { class: 'col insp' });
    mainEl.appendChild(h('div', { class: 'flow' }, cuesCol, center, insp));
    flowView = { mode: ui.mode, cuesCol: cuesCol, center: center, insp: insp };
    if (ui.mode === 'edit') {
      var c = selCue();
      flowView.previewMon = monitor('/output/?preview=' + encodeURIComponent(c ? c.id : ''), 'PREVIEW 預覽', 'prev');
      flowView.testbar = h('div', { class: 'testbar' });
      add(center, [flowView.previewMon.el, flowView.testbar,
        h('div', { class: 'hint', text: '預覽只在這裡播放，不會影響正在播出的輸出畫面。所有修改都會自動存檔。' })]);
      flowView.previewMon.frame.addEventListener('load', function () { sendGuides(); });
    } else if (MINI) {
      // 小面板不放監看畫面（省資源）；看畫面請看 OBS／Arena
    } else if (ui.noMonitors) {
      // 監看畫面關閉：省下兩個完整輸出畫面的運算（OBS／Arena 卡頓時使用）
      add(center, [h('div', { class: 'card', style: 'text-align:center;padding:28px' },
        h('div', { style: 'font-weight:700;margin-bottom:6px', text: '監看畫面已關閉（省效能）' }),
        h('div', { class: 'muted', style: 'margin-bottom:14px', text: '請看 OBS／Arena 的畫面。操作都在左右兩邊，跟平常一樣。' }),
        h('button', { text: '開啟監看畫面', onclick: function () { ui.noMonitors = false; saveUi(); renderPage(false); } })),
        h('div', { class: 'hint', html: shortcutHelp() })]);
    } else {
      var nx = nextCue();
      flowView.liveMon = monitor('/output/?monitor=1', 'LIVE 播出中', 'live');
      flowView.nextMon = monitor('/output/?still=1&preview=' + encodeURIComponent(nx ? nx.id : ''), 'NEXT 下一個', 'next');
      flowView.nextId = nx ? nx.id : null;
      add(center, [flowView.liveMon.el, h('div', { class: 'monrow' }, h('div', { class: 'hint', html: shortcutHelp() }), flowView.nextMon.el),
        h('div', { class: 'btnrow' }, h('button', { class: 'small', text: '關閉監看畫面（省效能）', title: '電腦同時跑 OBS／Arena 卡頓時，關掉 LIVE／NEXT 監看可以省下兩個完整畫面的運算', onclick: function () { ui.noMonitors = true; saveUi(); renderPage(false); } }))]);
    }
    renderCueList();
    renderInspector();
  }

  function syncMonitors() {
    if (!flowView) return;
    if (ui.mode === 'edit' && flowView.previewMon) {
      var c = selCue();
      if (c && flowView.previewId !== c.id) {
        flowView.previewId = c.id;
        flowView.previewMon.post({ setCue: c.id, view: previewChampView });
        renderTestbar();
      }
    }
    if (ui.mode === 'show' && flowView.nextMon) {
      var nx = nextCue(), id = nx ? nx.id : '';
      if (flowView.nextId !== id) { flowView.nextId = id; flowView.nextMon.post({ setCue: id }); }
    }
  }

  // ---------- Cue 表 ----------
  function renderCueList() {
    var col = flowView.cuesCol;
    var keepScroll = col.querySelector('.cuelist') ? col.querySelector('.cuelist').scrollTop : 0;
    col.innerHTML = '';
    if (ui.mode === 'show') {
      var nx = nextCue();
      var lc = liveCue();
      add(col, h('div', { class: 'gobox' },
        MINI ? h('div', { class: 'nowline', id: 'nowline' }, '播出中：', h('b', { text: lc ? FDM.cueTitle(S, lc) : '（尚未開始）' })) : null,
        h('button', { class: 'go', text: 'GO', title: '空白鍵', onclick: go }),
        h('div', { class: 'nextline', id: 'nextline' }, '下一個：', h('b', { text: nx ? FDM.cueTitle(S, nx) : '（已是最後一個）' })),
        h('div', { class: 'row' },
          h('button', { text: '← 上一個', onclick: prev }),
          h('button', { text: '回主視覺', title: '緊急回到第一個主視覺 Cue', onclick: emergency })),
        h('div', { class: 'row' },
          h('button', { id: 'blackBtn', class: S.show.blackout ? 'on' : '', text: S.show.blackout ? '取消黑畫面' : '黑畫面', title: 'B', onclick: toggleBlack }))));
    }
    var list = h('div', { class: 'cuelist' });
    S.cues.forEach(function (c, i) {
      var row = h('div', {
        class: 'cue', draggable: ui.mode === 'edit' ? 'true' : null, 'data-id': c.id,
        onclick: function () { if (ui.mode === 'edit') { ui.sel = c.id; saveUi(); renderCueList(); renderInspector(); syncMonitors(); } },
        ondblclick: function () { if (ui.mode === 'show') goTo(c.id); }
      },
      h('span', { class: 'no', text: String(i + 1).padStart(2, '0') }),
      h('div', null, h('div', { class: 't' }, FDM.cueTitle(S, c), h('span', { class: 'tag' })), h('div', { class: 's', text: FDM.cueSub(S, c) })),
      PHONE ? h('div', { class: 'acts' }, h('button', { class: 'jump', text: '▶ 播', onclick: function (e) {
        e.stopPropagation();
        var b = e.currentTarget;
        if (c.id === S.show.cueId) { toast('這個 Cue 正在播出'); return; }
        // 手機上避免捲動時誤觸：按第一下變成「確定播？」，3 秒內再按一次才切換
        if (!b.classList.contains('arm')) {
          flowView.cuesCol.querySelectorAll('.jump.arm').forEach(function (x) { x.classList.remove('arm'); x.textContent = '▶ 播'; });
          b.classList.add('arm'); b.textContent = '確定播？';
          setTimeout(function () { if (b.isConnected) { b.classList.remove('arm'); b.textContent = '▶ 播'; } }, 3000);
          return;
        }
        goTo(c.id);
      } })) :
      h('div', { class: 'acts' },
        h('button', { class: 'ghost', text: '↑', title: '上移', onclick: function (e) { e.stopPropagation(); moveCue(i, -1); } }),
        h('button', { class: 'ghost', text: '↓', title: '下移', onclick: function (e) { e.stopPropagation(); moveCue(i, 1); } }),
        ui.mode === 'edit' ? h('button', { class: 'ghost', text: '⧉', title: '複製', onclick: function (e) { e.stopPropagation(); dupCue(i); } }) : null,
        h('button', { class: 'ghost del', text: '✕', title: '刪除', onclick: function (e) { e.stopPropagation(); delCue(i); } })));
      if (ui.mode === 'edit') {
        row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); });
        row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drag-over'); });
        row.addEventListener('dragleave', function () { row.classList.remove('drag-over'); });
        row.addEventListener('drop', function (e) {
          e.preventDefault(); row.classList.remove('drag-over');
          var from = +e.dataTransfer.getData('text/plain');
          if (isFinite(from) && from !== i) { var arr = clone(S.cues); var it = arr.splice(from, 1)[0]; arr.splice(from < i ? i - 1 : i, 0, it); setCues(arr); }
        });
      }
      list.appendChild(row);
    });
    col.appendChild(list);
    list.scrollTop = keepScroll;
    col.appendChild(addBar());
    refreshCueMarks();
  }
  function refreshCueMarks() {
    if (!flowView) return;
    var live = S.show.cueId, nx = nextCue();
    flowView.cuesCol.querySelectorAll('.cue').forEach(function (r) {
      var id = r.getAttribute('data-id');
      var isLive = ui.mode === 'show' && id === live, isNext = ui.mode === 'show' && nx && id === nx.id;
      r.classList.toggle('sel', ui.mode === 'edit' && id === ui.sel);
      r.classList.toggle('live', isLive);
      r.classList.toggle('next', !!isNext);
      var tag = r.querySelector('.tag');
      if (tag) tag.textContent = isLive ? (S.show.blackout ? '黑畫面' : '播出中') : isNext ? '下一個' : '';
      if (tag) tag.style.display = tag.textContent ? '' : 'none';
    });
    // 播出中（小面板、手機版總控）：自己切換 Cue 時也要立刻更新
    var nw = document.getElementById('nowline');
    if (nw) { var lc2 = liveCue(); nw.innerHTML = ''; add(nw, ['播出中：', h('b', { text: lc2 ? FDM.cueTitle(S, lc2) : '（尚未開始）' })]); }
    var nl = document.getElementById('nextline');
    if (nl) { nl.innerHTML = ''; add(nl, ['下一個：', h('b', { text: nx ? FDM.cueTitle(S, nx) : '（已是最後一個）' })]); }
    var bb = document.getElementById('blackBtn');
    if (bb) { bb.className = S.show.blackout ? 'on' : ''; bb.textContent = S.show.blackout ? '取消黑畫面' : '黑畫面'; }
  }
  function setCues(arr) { setPath(['cues'], arr); renderCueList(); syncMonitors(); }
  function moveCue(i, d) { var j = i + d; if (j < 0 || j >= S.cues.length) return; var a = clone(S.cues); var t = a[i]; a[i] = a[j]; a[j] = t; setCues(a); }
  function dupCue(i) { var a = clone(S.cues); var c = clone(a[i]); c.id = uid(); if (c.own) c.own = false; a.splice(i + 1, 0, c); setCues(a); }
  function delCue(i) {
    var c = S.cues[i];
    if (c.id === S.show.cueId) { toast('這個 Cue 正在播出，不能刪除', true); return; }
    if (!confirm('刪除「' + FDM.cueTitle(S, c) + '」？')) return;
    var a = clone(S.cues); a.splice(i, 1); setCues(a);
    if (c.own) setPath(['layouts', 'battle@' + c.id], null);
  }
  function newCue(type, team) {
    var c = { id: uid(), type: type };
    if (type === 'team') c.team = team;
    if (FDM.isPerson(type)) c.judge = team;
    if (type === 'battle') Object.assign(c, { battle: 'semi1', name: '四強對戰 1', left: { source: 'top4', index: 0 }, right: { source: 'top4', index: 1 }, title: 'SEMI FINAL', zh: '四強賽', rounds: 4, seconds: 60, own: false });
    if (type === 'champ') Object.assign(c, { name: '冠軍公布', champ: { source: 'winner', battle: 'final' }, runner: { source: 'team', team: null } });
    if (['idle', 'overview', 'top4', 'black'].indexOf(type) >= 0) c.name = FDM.TYPES[type];
    return c;
  }
  var addState = { type: 'team', team: 't1', person: {}, after: true };
  function addBar() {
    var teamSel = sel(S.teams.map(function (t, i) { return [t.id, (i + 1) + '. ' + t.en]; }), addState.team, function (v) { addState.team = v; });
    var judges = FDM.peopleOf(S, 'judge');
    // 評審／MC／DJ 各自的人員選單
    var pSels = {};
    Object.keys(FDM.PEOPLE).forEach(function (t) {
      var list = FDM.peopleOf(S, t);
      if (!FDM.personById(S, t, addState.person[t]) && list[0]) addState.person[t] = list[0].id;
      pSels[t] = sel(list.length ? list.map(function (j, i) { return [j.id, (i + 1) + '. ' + j.en]; }) : [['', '（請先到「評審／MC／DJ」頁新增）']], addState.person[t] || '', function (v) { addState.person[t] = v; });
    });
    function vis() {
      teamSel.style.display = addState.type === 'team' ? '' : 'none';
      Object.keys(pSels).forEach(function (t) { pSels[t].style.display = addState.type === t ? '' : 'none'; });
    }
    var typeSel = sel(Object.keys(FDM.TYPES).map(function (k) { return [k, FDM.TYPES[k]]; }), addState.type, function (v) { addState.type = v; vis(); });
    vis();
    function insertAt() {
      if (ui.mode === 'show') return addState.after && S.show.cueId ? cueIndex(S.show.cueId) + 1 : S.cues.length;
      var i = cueIndex(ui.sel);
      return i >= 0 ? i + 1 : S.cues.length;
    }
    return h('div', { class: 'addbar' },
      h('div', { class: 'row' }, typeSel, teamSel, pSels.judge, pSels.mc, pSels.dj),
      h('div', { class: 'row' },
        h('button', { class: 'primary', text: '＋ 新增 Cue', style: 'flex:1', onclick: function () {
          var a = clone(S.cues), c = newCue(addState.type, FDM.isPerson(addState.type) ? addState.person[addState.type] : addState.team); a.splice(insertAt(), 0, c);
          if (ui.mode === 'edit') ui.sel = c.id;
          setCues(a); renderInspector();
        } }),
        h('button', { text: '產生 9 隊', title: '依隊伍順序一次新增所有單隊展示 Cue', onclick: function () {
          var a = clone(S.cues), at = insertAt();
          a.splice.apply(a, [at, 0].concat(S.teams.filter(function (t) { return !t.guest; }).map(function (t) { return newCue('team', t.id); })));
          setCues(a);
        } }),
        h('button', { text: '產生評審', title: '依評審順序一次新增所有評審表演 Cue', onclick: function () {
          if (!judges.length) { toast('還沒有評審，請先到「評審／MC／DJ」頁新增', true); return; }
          var a = clone(S.cues), at = insertAt();
          a.splice.apply(a, [at, 0].concat(judges.map(function (j) { return newCue('judge', j.id); })));
          setCues(a);
        } })),
      ui.mode === 'show' ? h('label', { style: 'font-size:12px' }, (function () {
        var c = h('input', { type: 'checkbox', checked: addState.after });
        c.addEventListener('change', function () { addState.after = c.checked; });
        return c;
      })(), ' 插入在播出中的 Cue 之後') : h('div', { class: 'faint', text: '新增在選取的 Cue 之後，可拖拉排序' }));
  }

  // ---------------------------------------------------------------------------
  // 演出指令
  // ---------------------------------------------------------------------------
  function goTo(id) {
    var c = cueById(id);
    if (!c) return;
    flush();
    var ops = [set(['show', 'cueId'], id), set(['show', 'seq'], (S.show.seq || 0) + 1), set(['show', 'teamOut'], false), set(['show', 'blackout'], false)];
    if (c.type === 'top4') ops.push(set(['show', 'top4Shown'], 0));
    if (c.type === 'champ') ops.push(set(['show', 'champView'], 'none'));
    if (c.type === 'battle') ops.push(set(['show', 'timer'], { duration: c.seconds || 60, endsAt: null, pausedLeft: c.seconds || 60 }));
    cmd(ops);
    renderInspector();
    syncMonitors();
  }
  function go() {
    var i = cueIndex(S.show.cueId);
    if (i + 1 >= S.cues.length) { toast('已經是最後一個 Cue'); return; }
    goTo(S.cues[i + 1].id);
  }
  function prev() {
    var i = cueIndex(S.show.cueId);
    if (i <= 0) return;
    goTo(S.cues[i - 1].id);
  }
  function emergency() {
    var c = S.cues.filter(function (x) { return x.type === 'idle'; })[0];
    if (c) goTo(c.id); else toast('沒有主視覺 Cue', true);
  }
  function toggleBlack() { cmd([set(['show', 'blackout'], !S.show.blackout)]); }

  // ---------- 對戰 ----------
  function battleOf(c) { return S.results.battles[c.battle]; }
  function battlePath(c) { return ['results', 'battles', c.battle]; }
  function snapshot(b) { return { l: b.l, r: b.r, round: b.round, seal: b.seal, winner: b.winner }; }
  function battleChange(c, patch, event) {
    var b = clone(battleOf(c));
    b.hist = (b.hist || []).concat([snapshot(b)]).slice(-100);
    Object.assign(b, patch);
    cmd([set(battlePath(c), b)], event);
  }
  function score(c, side, delta, absolute) {
    var b = battleOf(c), v = absolute != null ? absolute : b[side] + delta;
    v = clamp(Math.round(v), 0, 50);
    if (v === b[side]) return;
    var p = {}; p[side] = v;
    battleChange(c, p, { name: 'score', battle: c.battle, side: side, value: v });
  }
  function round(c, d) {
    var b = battleOf(c), n = clamp(b.round + d, 1, c.rounds || 12);
    if (n === b.round) return;
    battleChange(c, { round: n, seal: null }, { name: 'round', battle: c.battle, round: n });
  }
  function seal(c, side) {
    var b = battleOf(c);
    if (side) battleChange(c, { seal: side }, { name: 'seal', battle: c.battle, side: side });
    else if (b.seal) battleChange(c, { seal: null }, { name: 'sealFade', battle: c.battle });
  }
  function undo(c) {
    var b = clone(battleOf(c));
    var last = b.hist && b.hist.pop();
    if (!last) { toast('沒有可以復原的步驟'); return; }
    Object.assign(b, last);
    cmd([set(battlePath(c), b)], null, true);
  }
  function timerLeft() {
    var t = S.show.timer;
    if (t.endsAt) return Math.max(0, (t.endsAt - fd.now()) / 1000);
    return t.pausedLeft != null ? t.pausedLeft : t.duration;
  }
  function timerToggle() {
    var t = clone(S.show.timer);
    if (t.endsAt && timerLeft() > 0) { t.pausedLeft = timerLeft(); t.endsAt = null; }
    else { var left = timerLeft(); if (left <= 0) left = t.duration; t.pausedLeft = left; t.endsAt = fd.now() + left * 1000; }
    cmd([set(['show', 'timer'], t)]);
  }
  function timerReset() { var t = S.show.timer; cmd([set(['show', 'timer'], { duration: t.duration, endsAt: null, pausedLeft: t.duration })]); }
  function timerSet(sec) { cmd([set(['show', 'timer'], { duration: sec, endsAt: null, pausedLeft: sec })]); }

  // ---------- 頒獎（排舞賽冠軍／Battle 冠軍） ----------
  function champReveal(k) { cmd([set(['show', 'champView'], 'solo-' + k)], { name: 'champReveal', k: k }); }
  function champDuo() { cmd([set(['show', 'champView'], 'duo')], { name: 'champDuo' }); }
  function champView(v) { cmd([set(['show', 'champView'], v)]); }

  // ---------- 快捷鍵 ----------
  function shortcutHelp() {
    return '<b>快捷鍵</b>　<span class="kbd">空白</span> GO　<span class="kbd">B</span> 黑畫面<br>' +
      '單隊／評審／MC／DJ：<span class="kbd">X</span> 退場<br>' +
      '對戰：<span class="kbd">T</span> 計時開始／暫停　<span class="kbd">R</span> 重置　<span class="kbd">←</span><span class="kbd">→</span> 印章　<span class="kbd">↓</span> 印章淡出<br>' +
      '頒獎：<span class="kbd">1</span> 排舞賽冠軍　<span class="kbd">2</span> Battle 冠軍　<span class="kbd">3</span> 同框　<span class="kbd">Q</span><span class="kbd">W</span><span class="kbd">E</span> 直接切換　<span class="kbd">Esc</span> 回底圖';
  }
  document.addEventListener('keydown', function (e) {
    if (!S || ui.page !== 'flow' || ui.mode !== 'show') return;
    var tg = e.target.tagName;
    if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    var c = liveCue(), k = e.key.toLowerCase(), handled = true;
    if (e.code === 'Space') go();
    else if (k === 'b') toggleBlack();
    else if (c && (c.type === 'team' || FDM.isPerson(c.type)) && k === 'x') teamExit();
    else if (c && c.type === 'battle' && k === 't') timerToggle();
    else if (c && c.type === 'battle' && k === 'r') timerReset();
    else if (c && c.type === 'battle' && e.key === 'ArrowLeft') seal(c, 'l');
    else if (c && c.type === 'battle' && e.key === 'ArrowRight') seal(c, 'r');
    else if (c && c.type === 'battle' && e.key === 'ArrowDown') seal(c, null);
    else if (c && c.type === 'champ' && k === '1') champReveal('r');
    else if (c && c.type === 'champ' && k === '2') champReveal('c');
    else if (c && c.type === 'champ' && k === '3') champDuo();
    else if (c && c.type === 'champ' && k === 'q') champView('solo-r');
    else if (c && c.type === 'champ' && k === 'w') champView('solo-c');
    else if (c && c.type === 'champ' && k === 'e') champView('duo');
    else if (c && c.type === 'champ' && e.key === 'Escape') champView('none');
    else handled = false;
    if (handled) { e.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  });
  function teamExit() { cmd([set(['show', 'teamOut'], true)], { name: 'teamExit' }); }
  function replay() { cmd([], { name: 'entrance' }); }

  // ---------------------------------------------------------------------------
  // 右欄：編排設定 / 演出控制
  // ---------------------------------------------------------------------------
  var liveUpdaters = [];
  function onLive(fn) { liveUpdaters.push(fn); fn(); }
  function refreshLive() {
    if (!S) return;
    refreshCueMarks();
    syncMonitors();
    liveUpdaters.forEach(function (f) { try { f(); } catch (e) { /* 忽略 */ } });
  }

  function renderInspector() {
    if (!flowView) return;
    var insp = flowView.insp, y = insp.scrollTop;
    // 其他裝置更新時面板會重畫：正在打字的欄位（data-keep）要保留游標與焦點
    var ae = document.activeElement, keep = null;
    if (ae && insp.contains(ae) && ae.dataset && ae.dataset.keep) keep = { k: ae.dataset.keep, a: ae.selectionStart, b: ae.selectionEnd };
    liveUpdaters = [];
    insp.innerHTML = '';
    if (ui.mode === 'edit') editPanel(insp);
    else showPanel(insp);
    insp.scrollTop = y;
    if (keep) {
      var el = insp.querySelector('[data-keep="' + keep.k + '"]');
      if (el) { el.focus(); try { el.setSelectionRange(keep.a, keep.b); } catch (e) { /* 忽略 */ } }
    }
    if (ui.mode === 'edit') renderTestbar();
  }

  // ========== 演出控制 ==========
  function showPanel(insp) {
    var c = liveCue();
    if (!c) {
      add(insp, h('div', { class: 'live-head' }, h('h2', { text: '尚未開始播出' }), h('div', { class: 'muted', text: PHONE ? '按 GO 播出第一個 Cue，或在下方 Cue 列表按兩下「▶ 播」直接跳過去。' : '按 GO 或空白鍵播出第一個 Cue，或在左側 Cue 上點兩下直接跳過去。' })));
      return;
    }
    add(insp, h('div', { class: 'live-head' }, h('div', { class: 'faint', text: FDM.TYPES[c.type] + '・播出中' }), h('h2', { text: FDM.cueTitle(S, c) })));
    var pane = h('div', { class: 'pane' });
    insp.appendChild(pane);
    if (c.type === 'team') {
      add(pane, [h('h3', { text: '單隊展示' }), h('div', { class: 'btnrow' },
        h('button', { text: '重播登場', onclick: replay }),
        h('button', { class: 'primary', text: '退場（X）', onclick: teamExit })),
      h('div', { class: 'hint', text: '退場後畫面回到乾淨底圖，再按 GO 播下一隊。沒按退場直接 GO，系統會自動先退場。' })]);
    } else if (FDM.isPerson(c.type)) {
      add(pane, [h('h3', { text: FDM.TYPES[c.type] }), h('div', { class: 'btnrow' },
        h('button', { text: '重播（含懸念文字）', onclick: replay }),
        h('button', { text: '直接顯示' + FDM.PEOPLE[c.type].label, title: '跳過懸念文字直接出場', onclick: function () { cmd([set(['show', 'teamOut'], false)], { name: 'judgeDirect' }); } }),
        h('button', { class: 'primary', text: '退場（X）', onclick: teamExit })),
      h('div', { class: 'hint', text: '按 GO 播到這個 Cue 時會先出現懸念文字，停頓後登場。結束按退場，或直接 GO 下一個。' })]);
    } else if (c.type === 'top4') top4Panel(pane);
    else if (c.type === 'battle') { battlePanel(pane, c); lineupEditor(pane, c, true); }
    else if (c.type === 'champ') champPanel(pane, c);
    else {
      add(pane, [h('h3', { text: FDM.TYPES[c.type] }), h('div', { class: 'btnrow' }, h('button', { text: '重播登場', onclick: replay }))]);
      // 評審討論時就先把四強選好（輸出畫面不會有任何變化，揭曉仍在「四強公布」）
      if (c.type === 'idle' && c.pickTop4) {
        top4Picker(pane);
        var st = h('div', { class: 'hint' });
        add(pane, st);
        onLive(function () {
          var n = S.results.top4.filter(Boolean).length;
          st.className = n === 4 ? 'hint ok' : 'hint';
          st.textContent = n === 4 ? '✓ 四強已選好。播到「四強公布」時直接揭曉即可。' : '已選 ' + n + ' / 4。在這裡選隊不會改變輸出畫面，觀眾看不到。';
        });
      }
    }
  }

  // noGuest：四強、排舞賽冠軍等正式賽項目不列出表演賽的特邀隊伍
  function teamOptions(withEmpty, noGuest) {
    var o = S.teams.map(function (t, i) { return t.guest && noGuest ? null : [t.id, (i + 1) + '. ' + t.en + (t.seed ? '（種子）' : '') + (t.guest ? '（表演賽）' : '')]; }).filter(Boolean);
    return withEmpty ? [['', '（未選）']].concat(o) : o;
  }

  // 四強選隊（兩組對戰卡片）：「四強公布」與「評審討論」等待機 Cue 共用，選的是同一份四強
  function top4Picker(pane) {
    var err = h('div', { class: 'err' });
    // 四強位置 0/1 = 對戰 1（第 1 名 vs 第 4 名），2/3 = 對戰 2（第 2 名 vs 第 3 名）
    function pick(i) {
      var rank = FDM.TOP4_RANK[i];
      var s = sel(teamOptions(true, true), S.results.top4[i] || '', function (v, el) {
        if (v && S.results.top4.indexOf(v) >= 0 && S.results.top4.indexOf(v) !== i) { err.textContent = '這隊已經選過了'; el.value = S.results.top4[i] || ''; return; }
        err.textContent = '';
        var a = clone(S.results.top4); a[i] = v || null; setPath(['results', 'top4'], a);
        renderCueList();
      });
      return h('div', { class: 'mside' }, h('div', { class: 'rank' }, h('b', { text: '第 ' + rank + ' 名' }), ' 晉級'), s);
    }
    function match(n, a, b) {
      return h('div', { class: 'match' },
        h('div', { class: 'mtitle', text: '四強對戰 ' + n + '　第 ' + FDM.TOP4_RANK[a] + ' 名 vs 第 ' + FDM.TOP4_RANK[b] + ' 名' }),
        h('div', { class: 'mrow' }, pick(a), h('div', { class: 'mvs', text: 'VS' }), pick(b)));
    }
    var picks = h('div', null, match(1, 0, 1), match(2, 2, 3));
    add(pane, [h('h3', { text: '晉級隊伍（依對戰組合填入）' }), picks, err,
      h('div', { class: 'hint', text: '依晉級名次填入：第 1 名打第 4 名、第 2 名打第 3 名，後面的對戰 Cue 會自動帶入。揭曉順序：對戰 1 的兩隊 → 對戰 2 的兩隊。' })]);
  }
  function top4Panel(pane) {
    top4Picker(pane);
    var cnt = h('span', { class: 'muted' });
    onLive(function () { cnt.textContent = '已揭曉 ' + (S.show.top4Shown || 0) + ' / 4'; });
    add(pane, [h('h3', { text: '揭曉' }), h('div', { class: 'btnrow' },
        h('button', { class: 'primary', text: '揭曉下一隊', onclick: function () {
          if (S.results.top4.some(function (x) { return !x; })) { toast('請先選好 4 隊', true); return; }
          var n = S.show.top4Shown || 0; if (n >= 4) return;
          cmd([set(['show', 'top4Shown'], n + 1)], { name: 'top4next', index: n });
        } }),
        h('button', { text: '自動依序揭曉', onclick: function () {
          if (S.results.top4.some(function (x) { return !x; })) { toast('請先選好 4 隊', true); return; }
          cmd([set(['show', 'top4Shown'], 4)], { name: 'top4auto' });
        } }),
        h('button', { text: '重來', onclick: function () { cmd([set(['show', 'top4Shown'], 0)], { name: 'top4reset' }); } }), cnt)]);
  }

  function battlePanel(pane, c) {
    var sides = [['l', FDM.resolve(S, c.left), c.left], ['r', FDM.resolve(S, c.right), c.right]];
    var cards = h('div', { class: 'scores' });
    var err = h('div', { class: 'err' });
    sides.forEach(function (sd) {
      var k = sd[0], t = sd[1];
      var big = h('div', { class: 'big' });
      var inp = h('input', { type: 'number', min: 0, max: 50, step: 1, placeholder: '0–50' });
      var card = h('div', { class: 'sc' },
        h('div', { class: 'nm', text: (k === 'l' ? '左方　' : '右方　') + (t ? t.en : FDM.sourceLabel(sd[2]) + '（未決定）') }),
        big,
        h('div', { class: 'btns' },
          h('button', { text: '+1', onclick: function () { score(c, k, 1); } }),
          h('button', { text: '+2', onclick: function () { score(c, k, 2); } }),
          h('button', { text: '−1', onclick: function () { score(c, k, -1); } })),
        h('div', { class: 'btns', style: 'margin-top:4px' }, inp, h('button', { text: '設定', onclick: function () {
          var v = Number(inp.value);
          if (inp.value === '' || !Number.isInteger(v) || v < 0 || v > 50) { err.textContent = '請輸入 0 到 50 的整數'; return; }
          err.textContent = ''; score(c, k, 0, v); inp.value = '';
        } })),
        h('div', { class: 'btns', style: 'margin-top:4px' }, h('button', { class: 'winbtn', 'data-side': k, text: c.battle === 'exhibition' ? '確認勝方' : '確認晉級', onclick: function () {
          var b = battleOf(c);
          battleChange(c, { winner: b.winner === k ? null : k });
          renderCueList();
        } })));
      inp.addEventListener('input', function () { err.textContent = ''; });
      onLive(function () {
        var b = battleOf(c);
        big.textContent = b[k];
        card.classList.toggle('win', b.winner === k);
        var wb = card.querySelector('.winbtn');
        wb.classList.toggle('on', b.winner === k);
        wb.textContent = c.battle === 'exhibition' ? (b.winner === k ? '勝方（再按取消）' : '確認勝方') : (b.winner === k ? '已晉級（再按取消）' : '確認晉級');
      });
      cards.appendChild(card);
    });
    var rdTx = h('span', { style: 'font-size:16px;font-weight:700;padding:0 8px' });
    var bL = h('button', { text: '左方勝 ←', onclick: function () { seal(c, 'l'); } });
    var bR = h('button', { text: '→ 右方勝', onclick: function () { seal(c, 'r'); } });
    onLive(function () {
      var b = battleOf(c);
      rdTx.textContent = 'Round ' + b.round + ' / ' + (c.rounds || '?');
      bL.classList.toggle('on', b.seal === 'l'); bR.classList.toggle('on', b.seal === 'r');
    });
    var tBig = h('span', { class: 'timerbig', id: 'timerbig' });
    var tBtn = h('button', { class: 'primary', onclick: timerToggle });
    onLive(function () { var run = !!S.show.timer.endsAt && timerLeft() > 0; tBtn.textContent = run ? '❚❚ 暫停（T）' : '▶ 開始（T）'; });
    var tIn = h('input', { type: 'number', min: 1, step: 1, placeholder: '秒', style: 'width:64px' });
    add(pane, [
      h('h3', { text: '比分（0–50）' }), cards, err,
      h('h3', { text: '回合' }), h('div', { class: 'btnrow', style: 'align-items:center' },
        h('button', { text: '−', 'aria-label': '上一回合', onclick: function () { round(c, -1); } }), rdTx,
        h('button', { text: '＋', 'aria-label': '下一回合', onclick: function () { round(c, 1); } })),
      h('h3', { text: '勝方印章' }), h('div', { class: 'btnrow' }, bL, bR,
        h('button', { text: '印章淡出 ↓', onclick: function () { seal(c, null); } })),
      h('div', { class: 'hint', text: '印章和比分分開，蓋印章不會加分。切換回合時印章會自動淡出。' }),
      h('h3', { text: '倒數計時' }),
      h('div', { class: 'btnrow', style: 'align-items:center' }, tBig, tBtn, h('button', { text: '重置（R）', onclick: timerReset })),
      h('div', { class: 'btnrow' },
        [30, 45, 60].map(function (s) { return h('button', { text: s + ' 秒', onclick: function () { timerSet(s); } }); }),
        tIn, h('button', { text: '設定', onclick: function () {
          var v = Number(tIn.value);
          if (!Number.isInteger(v) || v < 1) { toast('請輸入大於 0 的整數秒數', true); return; }
          timerSet(v); tIn.value = '';
        } })),
      h('h3', { text: '其他' }),
      h('div', { class: 'btnrow' },
        h('button', { text: '↶ 復原', onclick: function () { undo(c); } }),
        h('button', { text: '重播登場', onclick: replay }),
        h('button', { class: 'danger', text: '清除本場比分', onclick: function () {
          if (!confirm('清除「' + FDM.cueTitle(S, c) + '」的比分、回合、印章與晉級？')) return;
          battleChange(c, { l: 0, r: 0, round: 1, seal: null, winner: null });
        } }))
    ]);
  }

  function champPanel(pane, c) {
    var champ = FDM.resolve(S, c.champ), show = FDM.resolve(S, c.runner);
    var cp = ['cues', cueIndex(c.id)];
    var viewTx = h('span', { class: 'muted' });
    var NAMES = { none: '底圖', 'lead-c': 'Battle 冠軍懸念文字', 'lead-r': '排舞賽冠軍懸念文字', 'solo-c': '單獨 Battle 冠軍', 'solo-r': '單獨排舞賽冠軍', duo: '兩位冠軍同框' };
    onLive(function () { viewTx.textContent = '目前：' + (NAMES[S.show.champView] || S.show.champView); });
    // 排舞賽冠軍由評審決定，演出時直接在這裡選
    var showPick = c.runner && c.runner.source === 'team'
      ? sel(teamOptions(true, true), c.runner.team || '', function (v) { setPath(cp.concat('runner'), { source: 'team', team: v || null }); renderCueList(); renderInspector(); })
      : h('b', { text: show ? show.en : FDM.sourceLabel(c.runner) + '（未決定）' });
    add(pane, [
      h('div', { class: 'card awards' },
        h('div', { class: 'aw' }, h('span', { class: 'lab', text: '排舞賽冠軍' }), showPick),
        h('div', { class: 'aw' }, h('span', { class: 'lab', text: 'Battle 冠軍' }), h('b', { text: champ ? champ.en : '（決賽確認晉級後自動帶入）' })),
        !show ? h('div', { class: 'err', text: '請先選擇排舞賽冠軍。' }) : null,
        !champ ? h('div', { class: 'err', text: '請先在決賽按「確認晉級」，Battle 冠軍才會帶入。' }) : null),
      h('h3', { text: '揭曉（含懸念文字）' }),
      h('div', { class: 'btnrow' },
        h('button', { class: 'primary', text: '1. 排舞賽冠軍揭曉', onclick: function () { champReveal('r'); } }),
        h('button', { class: 'primary', text: '2. Battle 冠軍揭曉', onclick: function () { champReveal('c'); } }),
        h('button', { class: 'primary', text: '3. 兩位冠軍同框', onclick: champDuo })),
      h('h3', { text: '直接切換（拍得獎照用）' }),
      h('div', { class: 'btnrow' },
        h('button', { text: '單獨排舞賽冠軍（Q）', onclick: function () { champView('solo-r'); } }),
        h('button', { text: '單獨 Battle 冠軍（W）', onclick: function () { champView('solo-c'); } }),
        h('button', { text: '同框（E）', onclick: function () { champView('duo'); } }),
        h('button', { text: '回到底圖（Esc）', onclick: function () { champView('none'); } })),
      viewTx
    ]);
  }

  // ========== 編排設定 ==========
  var previewChampView = 'solo-c';
  function post(ev) { if (flowView && flowView.previewMon) flowView.previewMon.post({ event: ev }); }
  function sendGuides() { if (flowView && flowView.previewMon) flowView.previewMon.post({ guides: ui.guides }); }

  function renderTestbar() {
    var tb = flowView && flowView.testbar;
    if (!tb) return;
    tb.innerHTML = '';
    var c = selCue();
    var btns = [];
    if (c) {
      if (c.type === 'team') btns = [['登場', { name: 'entrance' }], ['退場', { name: 'teamExit' }]];
      if (c.type === 'overview') btns = [['登場', { name: 'entrance' }]];
      if (FDM.isPerson(c.type)) btns = [['登場（含懸念）', { name: 'entrance' }], ['直接登場', { name: 'judgeDirect' }], ['退場', { name: 'teamExit' }]];
      if (c.type === 'top4') btns = [['自動揭曉', { name: 'top4auto' }], ['重置', { name: 'top4reset' }]];
      if (c.type === 'battle') btns = [['登場', { name: 'entrance' }], ['左方印章', { name: 'seal', side: 'l' }], ['右方印章', { name: 'seal', side: 'r' }], ['印章淡出', { name: 'sealFade' }], ['最後 10 秒', { name: 'testTimer' }], ['比分變化', { name: 'testScore' }]];
      if (c.type === 'champ') btns = [['排舞賽冠軍揭曉', { name: 'champReveal', k: 'r' }], ['Battle 冠軍揭曉', { name: 'champReveal', k: 'c' }], ['同框揭曉', { name: 'champDuo' }], null,
        ['懸念文字', { name: 'champView', view: 'lead-c' }], ['單獨排舞賽', { name: 'champView', view: 'solo-r' }], ['單獨 Battle', { name: 'champView', view: 'solo-c' }], ['同框', { name: 'champView', view: 'duo' }]];
      if (c.type === 'idle') btns = [['登場', { name: 'entrance' }]];
    }
    if (btns.length) add(tb, h('span', { class: 'faint', text: '預覽測試：' }));
    btns.forEach(function (b) {
      if (!b) { tb.appendChild(h('span', { class: 'sep' })); return; }
      tb.appendChild(h('button', { class: 'small', text: b[0], onclick: function () {
        if (b[1].name === 'champView') previewChampView = b[1].view;
        if (b[1].name === 'champReveal') previewChampView = 'solo-' + b[1].k;
        if (b[1].name === 'champDuo') previewChampView = 'duo';
        post(b[1]);
      } }));
    });
    tb.appendChild(h('span', { class: 'sep' }));
    [['safe', '安全區'], ['lines', '對齊線']].forEach(function (g) {
      var ch = h('input', { type: 'checkbox', checked: !!ui.guides[g[0]] });
      ch.addEventListener('change', function () { ui.guides[g[0]] = ch.checked; saveUi(); sendGuides(); });
      tb.appendChild(h('label', { style: 'font-size:12px;display:inline-flex;gap:4px;align-items:center' }, ch, g[1]));
    });
  }

  var TABS = {
    team: [['basic', '基本'], ['photo', '照片'], ['layout', '版面'], ['anim', '動畫']],
    judge: [['basic', '基本'], ['text', '文字'], ['photo', '照片'], ['layout', '版面'], ['anim', '動畫']],
    mc: [['basic', '基本'], ['text', '文字'], ['photo', '照片'], ['layout', '版面'], ['anim', '動畫']],
    dj: [['basic', '基本'], ['text', '文字'], ['photo', '照片'], ['layout', '版面'], ['anim', '動畫']],
    top4: [['basic', '基本'], ['layout', '版面'], ['anim', '動畫']],
    battle: [['basic', '基本'], ['rtitle', '回合稱號'], ['photo', '照片'], ['layout', '版面'], ['anim', '動畫'], ['seal', '印章與計時']],
    champ: [['basic', '基本'], ['text', '內容'], ['layout', '版面'], ['anim', '動畫']],
    idle: [['basic', '基本']], overview: [['basic', '基本'], ['text', '標題'], ['layout', '版面'], ['anim', '動畫']], black: [['basic', '基本']]
  };

  function editPanel(insp) {
    var c = selCue();
    if (!c) { add(insp, h('div', { class: 'pane' }, h('p', { class: 'muted', text: '還沒有 Cue，請在左下角新增。' }))); return; }
    var idx = cueIndex(c.id);
    var tabs = TABS[c.type] || [['basic', '基本']];
    var tab = ui.tabs[c.type] && tabs.some(function (t) { return t[0] === ui.tabs[c.type]; }) ? ui.tabs[c.type] : tabs[0][0];
    add(insp, h('div', { class: 'insp-head' }, h('div', { class: 'faint', text: 'Cue ' + String(idx + 1).padStart(2, '0') + '・' + FDM.TYPES[c.type] }), h('h2', { text: FDM.cueTitle(S, c) })));
    add(insp, h('div', { class: 'tabs' }, tabs.map(function (t) {
      return h('button', { class: t[0] === tab ? 'on' : '', text: t[1], onclick: function () { ui.tabs[c.type] = t[0]; saveUi(); renderInspector(); } });
    })));
    var pane = h('div', { class: 'pane' });
    insp.appendChild(pane);
    var cp = ['cues', idx];
    var lk = FDM.layoutKey(c), lp = ['layouts', lk];
    if (c.type === 'battle' && c.own && !S.layouts[lk]) setPath(lp, clone(S.layouts.battle));
    var editors = {
      team: { basic: teamBasic, photo: function (p) { photoTab(p, [c.team]); }, layout: teamLayout, anim: function (p) { animEditor(p, lp.concat('anim'), 'team', [['fr', '外框'], ['ph', '照片'], ['en', '英文隊名'], ['zh', '第二行']]); } },
      judge: { basic: judgeBasic, text: judgeText, photo: judgePhoto, layout: judgeLayout, anim: judgeAnim },
      mc: { basic: judgeBasic, text: judgeText, photo: judgePhoto, layout: judgeLayout, anim: judgeAnim },
      dj: { basic: judgeBasic, text: judgeText, photo: judgePhoto, layout: judgeLayout, anim: judgeAnim },
      top4: { basic: top4Basic, layout: top4Layout, anim: top4Anim },
      battle: { basic: battleBasic, rtitle: battleRoundTitle, photo: battlePhoto, layout: battleLayout, anim: battleAnim, seal: battleSeal },
      champ: { basic: champBasic, text: champText, layout: champLayout, anim: champAnim },
      idle: { basic: idleBasic }, overview: { basic: overviewBasic, text: overviewText, layout: overviewLayout, anim: overviewAnim }, black: { basic: blackBasic }
    };
    (editors[c.type][tab] || function () {})(pane, c, cp, lp);
  }

  function nameField(cp) { return fld('Cue 名稱', txtPath(cp.concat('name'), '顯示在 Cue 表', function () { renderCueListSoon(); })); }
  var clTimer = null;
  function renderCueListSoon() { clearTimeout(clTimer); clTimer = setTimeout(function () { renderCueList(); var hd = flowView.insp.querySelector('.insp-head h2'); var c = selCue(); if (hd && c) hd.textContent = FDM.cueTitle(S, c); }, 250); }

  function bgEditor(pane, bgPath) {
    var bg = getAt(S, bgPath) || {};
    var box = h('div');
    function draw() {
      box.innerHTML = '';
      bg = getAt(S, bgPath);
      var modeSel = sel([['color', '純色＋紙紋'], ['image', '圖片'], ['video', '影片（MP4 循環）'], ['transparent', '透明（OBS 疊加用）']], bg.mode, function (v) { setPath(bgPath.concat('mode'), v); draw(); });
      add(box, fld('模式', modeSel));
      if (bg.mode === 'color') add(box, [fld('顏色', colorPath(bgPath.concat('color'))), fld('紙紋', chk('加上紙紋質感', bgPath.concat('texture')))]);
      if (bg.mode === 'image' || bg.mode === 'video') {
        var isV = bg.mode === 'video';
        add(box, fld(isV ? '影片' : '圖片', h('div', { class: 'inl' },
          uploadBtn(isV ? '上傳影片' : '上傳圖片', isV ? 'video/mp4,video/webm,video/quicktime' : 'image/*', false, function (f) {
            (isV ? checkVideo(f[0]) : Promise.resolve({ ok: 'ok' })).then(function (r) {
              if (r.ok === 'bad') {
                toast('這個影片在這台電腦無法播放（常見原因：HEVC／H.265 編碼，例如 iPhone 錄影）。請轉成 H.264 的 MP4 再上傳。', true);
                return;
              }
              return upload(f[0]).then(function (p) {
                setPath(bgPath.concat('src'), p); draw();
                if (r.w && (r.w !== 1920 || r.h !== 1080)) toast('已上傳。影片尺寸是 ' + r.w + '×' + r.h + '，會自動填滿 1920×1080 畫面（比例不同時邊緣會被裁切）。');
              });
            }).catch(fail);
          }),
          h('span', { class: 'faint', text: bg.src ? String(bg.src).replace(/^assets\/\w+-/, '') : '尚未上傳（1920×1080）' }))));
        if (isV) add(box, fld('聲音', chk('播放影片聲音（只在正式輸出播放）', bgPath.concat('sound'))));
      }
      if (bg.mode === 'transparent') add(box, h('div', { class: 'hint', text: '透明只在 OBS／導播軟體有意義；直接接投影時透明處會是黑色。' }));
    }
    draw();
    add(pane, [h('h3', { text: '底圖' }), box, h('div', { class: 'hint', text: '同類型的 Cue 共用底圖與版面（對戰可勾選獨立版型）。' })]);
  }

  function sourceSelect(value, onchange, withEmpty) {
    var opts = [
      withEmpty ? { group: '尚未決定', items: [['', '（未選，演出時再選）']] } : null,
      { group: '指定隊伍', items: S.teams.map(function (t, i) { return ['team:' + t.id, (i + 1) + '. ' + t.en + (t.seed ? '（種子）' : '') + (t.guest ? '（表演賽）' : '')]; }) },
      { group: '自動帶入', items: [['top4:0', '晉級第 1 名'], ['top4:2', '晉級第 2 名'], ['top4:3', '晉級第 3 名'], ['top4:1', '晉級第 4 名'],
        ['winner:semi1', '四強對戰 1 勝方'], ['winner:semi2', '四強對戰 2 勝方'], ['winner:final', '決賽勝方'],
        ['loser:semi1', '四強對戰 1 敗方'], ['loser:semi2', '四強對戰 2 敗方'], ['loser:final', '決賽敗方']] }
    ].filter(Boolean);
    var enc = value ? (value.source === 'team' ? (value.team ? 'team:' + value.team : '') : value.source === 'top4' ? 'top4:' + value.index : value.source + ':' + value.battle) : '';
    return sel(opts, enc, function (v) {
      var p = v.split(':'), o;
      if (!v) o = { source: 'team', team: null };
      else if (p[0] === 'team') o = { source: 'team', team: p[1] };
      else if (p[0] === 'top4') o = { source: 'top4', index: +p[1] };
      else o = { source: p[0], battle: p[1] };
      onchange(o);
    });
  }

  // ---------- 單隊 ----------
  function teamBasic(pane, c, cp, lp) {
    add(pane, [h('h3', { text: '隊伍' }), fld('上場隊伍', sel(teamOptions(), c.team, function (v) { setPath(cp.concat('team'), v); renderCueList(); renderInspector(); })),
      h('div', { class: 'hint', text: '隊名、照片請到上方「隊伍」頁編輯，或在「照片」分頁調整這隊的照片。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function teamLayout(pane, c, cp, lp) {
    var v = lp.concat('v');
    add(pane, [h('h3', { text: '照片框' }),
      sl(v.concat('pw'), '照片框寬度', 200, 1920), sl(v.concat('px'), '水平位置', -900, 900), sl(v.concat('pt'), '垂直位置', -400, 1080), sl(v.concat('pad'), '框內邊距', 0, 300),
      h('h3', { text: '隊名' }),
      sl(v.concat('ng'), '隊名間距', -300, 500), sl(v.concat('es'), '英文字級', 12, 300), sl(v.concat('zs'), '第二行字級', 12, 240), sl(v.concat('lg'), '行距', -100, 300)]);
  }

  // ---------- 照片 ----------
  function photoTab(pane, teamIds, sideLabels) {
    var side = 0;
    if (teamIds.length > 1) side = ui.photoSide === 'R' ? 1 : 0;
    if (sideLabels) add(pane, h('div', { class: 'seg', style: 'margin:10px 0' }, sideLabels.map(function (l, i) {
      return h('button', { class: i === side ? 'on' : '', text: l, onclick: function () { ui.photoSide = i ? 'R' : 'L'; saveUi(); renderInspector(); } });
    })));
    var id = teamIds[side];
    var t = FDM.teamById(S, id);
    if (!t) { add(pane, h('div', { class: 'card muted', text: '這個位置是自動帶入，隊伍決定後才能調整照片。也可以到「隊伍」頁先調整每隊的照片。' })); return; }
    photoEditor(pane, t, function () { renderInspector(); });
    add(pane, h('div', { class: 'hint', text: '照片設定存在隊伍資料上，單隊展示、四強、對戰、頒獎都會沿用。' }));
  }
  function photoEditor(pane, t, redraw, pp) {
    pp = pp || ['teams', S.teams.indexOf(t), 'photo'];
    var ph = t.photo;
    add(pane, [h('h3', { text: t.en + ' 的照片' }),
      h('div', { class: 'btnrow', style: 'align-items:center' },
        ph.src ? h('img', { class: 'thumb' + (ph.logo ? ' logo' : ''), src: '/' + (ph.trim || ph.src), alt: '' }) : null,
        uploadBtn(ph.src ? '更換照片' : '上傳照片', 'image/*', false, function (f) {
          processPhoto(f[0]).then(function (r) {
            setPath(pp, Object.assign(clone(getAt(S, pp)), { src: r.src, trim: r.trim, fit: 'auto', zoom: 100, x: 0, y: 0 }));
            if (r.trim) toast('偵測到去背照片，已自動裁掉四周透明區域');
            redraw();
          }).catch(fail);
        }),
        ph.src ? h('button', { class: 'ghost', text: '移除', onclick: function () { setPath(pp.concat('src'), null); setPath(pp.concat('trim'), null); redraw(); } }) : null),
      fld('適應方式', selPath(pp.concat('fit'), [['auto', '自動 Fit（裁掉透明邊）'], ['contain', '完整顯示'], ['cover', '填滿外框']])),
      h('div', { class: 'btnrow' }, h('button', { text: '一鍵自動調整', onclick: function () {
        setPath(pp, Object.assign(clone(getAt(S, pp)), { fit: 'auto', zoom: 100, x: 0, y: 0 })); redraw();
      } })),
      sl(pp.concat('zoom'), '照片縮放 %', 10, 400, { def: 100 }),
      sl(pp.concat('x'), '左右位置', -1200, 1200, { def: 0 }),
      sl(pp.concat('y'), '上下位置', -900, 900, { def: 0 }),
      fld('出框', chk('允許人物超出外框（去背照片適用）', pp.concat('free'))),
      fld('Logo 模式', chk('用 Logo 代替隊伍照片：不顯示外框，Logo 可放大超出框', pp.concat('logo'), function () { redraw(); })),
      ph.logo ? fld('隊名', chk('對戰畫面不顯示隊名（Logo 已含隊名）', pp.concat('noName'))) : null,
      ph.logo ? h('div', { class: 'hint', text: 'Logo 請用透明背景 PNG。用「照片縮放」放大、「上下位置」往上移，讓 Logo 底部對齊隊名上方。' }) : null,
      ph.fit === 'auto' && ph.src && !ph.trim ? h('div', { class: 'hint', text: '這張照片沒有透明背景，自動 Fit 會以完整顯示處理。' }) : null]);
  }

  // ---------- 評審表演／MC 介紹／DJ 介紹（同一套版面，資料與設定各自獨立） ----------
  function K(type) { return FDM.PEOPLE[type] || FDM.PEOPLE.judge; }
  function personOptions(type) {
    var js = FDM.peopleOf(S, type);
    return js.length ? js.map(function (j, i) { return [j.id, (i + 1) + '. ' + j.en]; }) : [['', '（還沒有' + K(type).label + '）']];
  }
  var RATIOS = [['3:2', '橫式 3:2（跟隊伍照片同比例）'], ['16:9', '寬螢幕 16:9'], ['1:1', '正方形 1:1'], ['4:5', '直式 4:5'], ['2:3', '直式 2:3']];
  function ratioNum(r) { var p = String(r || '3:2').split(':'); return (Number(p[1]) || 2) / (Number(p[0]) || 3); }
  function judgeBasic(pane, c, cp, lp) {
    var k = K(c.type), lead = (getAt(S, lp.concat(['text', 'lead'])) || 'NEXT ' + k.ph + ' IS...');
    add(pane, [h('h3', { text: k.label }),
      fld('上台' + k.label, sel(personOptions(c.type), c.judge || '', function (v) { setPath(cp.concat('judge'), v); renderCueList(); renderInspector(); })),
      h('div', { class: 'hint', text: k.label + '名字、照片請到上方「評審／MC／DJ」頁編輯，或在「照片」分頁調整。' }),
      h('h3', { text: '出場方式' }),
      fld('懸念文字', chk('先顯示「' + lead + '」再登場', lp.concat('intro'))),
      fld('照片比例', sel(RATIOS, getAt(S, lp.concat('ratio')) || '3:2', function (v) {
        // 換比例時維持照片高度差不多，不會突然變很大
        var L = getAt(S, lp), hgt = L.v.pw * ratioNum(L.ratio);
        setPath(lp.concat('ratio'), v);
        setPath(lp.concat(['v', 'pw']), Math.round(clamp(hgt / ratioNum(v), 200, 1920)));
        renderInspector();
      }), '直式照片外框會跟著拉長；外框 PNG 是橫式時建議用 3:2'),
      h('div', { class: 'hint', text: '所有「' + FDM.TYPES[c.type] + '」Cue 共用底圖、版面與動畫；評審、MC、DJ 三種各自獨立設定。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function judgeText(pane, c, cp, lp) {
    var t = lp.concat('text');
    add(pane, [h('h3', { text: '懸念文字' }),
      fld('英文', txtPath(t.concat('lead'), 'NEXT ' + K(c.type).ph + ' IS...')), fld('中文', txtPath(t.concat('leadZh'), '選填')),
      h('div', { class: 'hint', text: '兩行都留空就不顯示懸念文字，按 GO 直接登場。' }),
      h('h3', { text: '照片上方稱號' }),
      fld('稱號', txtPath(t.concat('title'), K(c.type).ph)),
      h('div', { class: 'hint', text: '留空就不顯示。名字下方第二行顯示中文名；沒有中文名時顯示標籤（Crew／城市）。' })]);
  }
  function judgePhoto(pane, c) {
    var js = FDM.peopleOf(S, c.type), j = FDM.personById(S, c.type, c.judge);
    if (!j) { add(pane, h('div', { class: 'card muted', text: '請先在「基本」分頁選擇' + K(c.type).label + '。' })); return; }
    photoEditor(pane, j, function () { renderInspector(); }, [K(c.type).list, js.indexOf(j), 'photo']);
  }
  function judgeLayout(pane, c, cp, lp) {
    var v = lp.concat('v');
    add(pane, [h('h3', { text: '懸念文字' }),
      sl(v.concat('lEs'), '英文字級', 12, 300), sl(v.concat('lZs'), '中文字級', 12, 200), sl(v.concat('lY'), '垂直位置', -200, 1000), sl(v.concat('lG'), '中英間距', -200, 400),
      h('h3', { text: '照片框' }),
      sl(v.concat('pw'), '照片框寬度', 200, 1920), sl(v.concat('px'), '水平位置', -900, 900), sl(v.concat('pt'), '垂直位置', -400, 1080), sl(v.concat('pad'), '框內邊距', 0, 300),
      h('h3', { text: '稱號' }),
      sl(v.concat('tS'), '稱號字級', 12, 240), sl(v.concat('tG'), '稱號距照片', -300, 400),
      h('h3', { text: '名字' }),
      sl(v.concat('ng'), '名字距照片', -300, 500), sl(v.concat('es'), '英文字級', 12, 300), sl(v.concat('zs'), '第二行字級', 12, 240), sl(v.concat('lg'), '行距', -100, 300)]);
  }
  function judgeAnim(pane, c, cp, lp) {
    animEditor(pane, lp.concat('anim'), c.type, [['lt', '懸念英文'], ['lz', '懸念中文'], null,
      ['fr', '外框'], ['ph', '照片'], ['en', '英文名字'], ['zh', '第二行'], ['tt', '稱號']]);
    add(pane, [h('h3', { text: '懸念' }),
      sl(lp.concat('pause'), '懸念停頓 ms', 0, 10000, { step: 100 }),
      fld('懸念退場', selPath(lp.concat('leadOut'), FDM.FX_OUT))]);
  }

  // ---------- 四強 ----------
  function top4Basic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '排列方式' }),
      fld('模式', selPath(lp.concat('mode'), [['step', '逐組揭曉（兩隊出現後拉開、VS 落下）'], ['pair', '對戰組合（直接兩兩一組）'], ['row', '一排四隊']])),
      h('div', { class: 'hint', text: '晉級隊伍在演出模式選擇：四強對戰 1 = 第 1 名 vs 第 4 名，四強對戰 2 = 第 2 名 vs 第 3 名。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function top4Layout(pane, c, cp, lp) {
    var v = lp.concat('v');
    add(pane, [h('h3', { text: '照片' }),
      sl(v.concat('w'), '照片寬度', 100, 900), sl(v.concat('top'), '垂直位置', -300, 1000), sl(v.concat('pad'), '框內邊距', 0, 300),
      h('h3', { text: '間距' }),
      sl(v.concat('close'), '併排間距', 12, 400, { after: function () { post({ name: 'top4view', open: false }); } }),
      sl(v.concat('vsg'), '拉開間距', 0, 600, { after: function () { post({ name: 'top4view', open: true }); } }),
      sl(v.concat('pg'), '兩組距離', -200, 800, { after: function () { post({ name: 'top4view', open: true }); } }),
      h('div', { class: 'hint', text: '調整「併排間距」時預覽會顯示兩隊剛出現、還沒拉開的樣子；調整「拉開間距」會顯示拉開後的樣子。' }),
      h('h3', { text: '文字' }),
      sl(v.concat('ng'), '隊名距照片', -200, 400), sl(v.concat('ens'), '英文字級', 12, 200), sl(v.concat('zhs'), '第二行字級', 12, 160), sl(v.concat('vss'), 'VS 字級', 12, 300)]);
  }
  function top4Anim(pane, c, cp, lp) {
    animEditor(pane, lp.concat('anim'), 'top4', [['fr', '外框'], ['ph', '照片'], ['en', '英文隊名'], ['zh', '第二行']]);
    add(pane, [h('h3', { text: 'VS 與拉開' }),
      fld('VS 效果', selPath(lp.concat('vsFx'), [['slam', '重擊落下'], ['brush', '毛筆刷出'], ['fade', '淡入'], ['ink', '潑墨暈開']])),
      sl(lp.concat('wait'), '拉開前停頓 ms', 0, 6000, { step: 50 }), sl(lp.concat('split'), '拉開時間 ms', 100, 4000, { step: 50 }),
      sl(lp.concat('itv'), '自動揭曉間隔 ms', 0, 8000, { step: 50 })]);
  }

  // ---------- 對戰 ----------
  function battleBasic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '對戰' }),
      fld('場次', sel([['semi1', '四強對戰 1'], ['semi2', '四強對戰 2'], ['final', '決賽'], ['exhibition', '表演賽（特邀隊伍）']], c.battle, function (v) {
        var gs = S.teams.filter(function (t) { return t.guest; });
        var m = { semi1: ['SEMI FINAL', '四強賽', 5, { source: 'top4', index: 0 }, { source: 'top4', index: 1 }, '四強對戰 1'],
          semi2: ['SEMI FINAL', '四強賽', 5, { source: 'top4', index: 2 }, { source: 'top4', index: 3 }, '四強對戰 2'],
          final: ['FINAL', '決賽', 5, { source: 'winner', battle: 'semi1' }, { source: 'winner', battle: 'semi2' }, '決賽'],
          exhibition: ['EXHIBITION', '表演賽', 3, { source: 'team', team: gs[0] ? gs[0].id : null }, { source: 'team', team: gs[1] ? gs[1].id : null }, '表演賽'] }[v];
        var n = Object.assign(clone(c), { battle: v, title: m[0], zh: m[1], rounds: m[2], left: m[3], right: m[4], name: m[5], noTitles: v === 'exhibition' });
        setPath(cp, n); renderCueList(); renderInspector();
      }), '比分與印章依場次記錄'),
      fld('左方隊伍', sourceSelect(c.left, function (o) { setPath(cp.concat('left'), o); renderCueList(); })),
      fld('右方隊伍', sourceSelect(c.right, function (o) { setPath(cp.concat('right'), o); renderCueList(); })),
      h('h3', { text: '標題與回合' }),
      fld('英文標題', txtPath(cp.concat('title'), 'SEMI FINAL')),
      fld('中文標題', txtPath(cp.concat('zh'), '四強賽')),
      fld('回合數', (function () {
        var i = h('input', { type: 'number', min: 1, max: 12, step: 1, value: c.rounds, style: 'width:80px' });
        i.addEventListener('change', function () { var v = Number(i.value); if (!Number.isInteger(v) || v < 1 || v > 12) { toast('回合數請輸入 1 到 12', true); i.value = c.rounds; return; } setPath(cp.concat('rounds'), v); });
        return i;
      })()),
      fld('預設秒數', (function () {
        var i = h('input', { type: 'number', min: 1, step: 1, value: c.seconds, style: 'width:80px' });
        i.addEventListener('change', function () { var v = Number(i.value); if (!Number.isInteger(v) || v < 1) { toast('秒數請輸入大於 0 的整數', true); i.value = c.seconds; return; } setPath(cp.concat('seconds'), v); });
        return i;
      })(), '播到這個 Cue 時 Timer 會重設成這個秒數'),
      fld('回合稱號', (function () {
        var i = h('input', { type: 'checkbox' });
        i.checked = !c.noTitles;
        i.addEventListener('change', function () { setPath(cp.concat('noTitles'), !i.checked); renderInspector(); });
        return h('label', { style: 'display:inline-flex;gap:6px;align-items:center;cursor:pointer;color:var(--text)' }, i, '這場顯示回合稱號（先鋒、策應…）');
      })(), '表演賽預設不顯示；稱號樣式在「回合稱號」分頁'),
      (function () { var d = h('div'); lineupEditor(d, c, false); return d; })(),
      h('h3', { text: '版型' }),
      fld('獨立版型', chk('這個 Cue 使用獨立的版面與動畫（例如讓決賽更隆重）', cp.concat('own'), function (on) {
        if (on && !S.layouts['battle@' + c.id]) setPath(['layouts', 'battle@' + c.id], clone(S.layouts.battle));
        renderInspector();
      })),
      h('div', { class: 'hint', text: c.own ? '這個 Cue 的版面、動畫、印章、底圖只影響自己。' : '與其他對戰 Cue 共用版面、動畫、印章與底圖。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function battlePhoto(pane, c) {
    var l = FDM.resolve(S, c.left), r = FDM.resolve(S, c.right);
    photoTab(pane, [l ? l.id : null, r ? r.id : null], ['左方 ' + (l ? l.en : ''), '右方 ' + (r ? r.en : '')]);
  }
  // ---------- 出賽名單：每回合兩隊上場的舞者（選填）；有填就和回合稱號一起顯示名字，沒填只顯示稱號 ----------
  function lineupEditor(pane, c, live) {
    if (c.noTitles) {
      if (!live) add(pane, h('div', { class: 'hint', text: '這場不顯示回合稱號，所以也不顯示名單。要顯示請到「基本」勾選「這場顯示回合稱號」。' }));
      return;
    }
    var ci = S.cues.indexOf(c), lp0 = ['cues', ci, 'lineup'], b = getAt(S, ['results', 'battles', c.battle]) || {}, nm = c.lineup || {};
    var rt = (S.layouts.battle && S.layouts.battle.rt) || {}, titles = rt.titles || [];
    var tL = FDM.resolve(S, c.left), tR = FDM.resolve(S, c.right), n = Math.max(1, c.rounds || 5);
    function put(side, i, val) {
      var cur = getAt(S, lp0) || {};
      var arr = (cur[side] || []).slice();
      while (arr.length < n) arr.push('');
      arr[i] = val;
      setPath(lp0.concat(side), arr);
    }
    function textInput(side, i, v) {
      var el = h('input', { type: 'text', value: v, placeholder: '（不填）', maxlength: 40, 'data-keep': c.battle + side + i, 'aria-label': (side === 'l' ? '左方' : '右方') + '第 ' + (i + 1) + ' 回合舞者' });
      // 手動輸入模式下清空也要留在手動輸入（存一個空白）
      el.addEventListener('input', function () { put(side, i, el.value || (el.dataset.manual ? ' ' : '')); });
      return el;
    }
    // 一格：這隊有成員（字卡）就用選單選人；也可以「手動輸入」或「不顯示」
    function input(side, i) {
      var raw = (nm[side] || [])[i] || '', team = side === 'l' ? tL : tR;
      var ms = (team && !team._ph && team.members) || [];
      if (!ms.length) return textInput(side, i, typeof raw === 'string' ? raw : '');
      var val = raw && typeof raw === 'object' ? raw.m : typeof raw === 'string' && raw ? '__text' : '';
      var opts = [['', '（不顯示）']].concat(ms.map(function (m) { return [m.id, (m.name || '（未命名）') + (m.card ? '' : '（無字卡）')]; }), [['__text', '手動輸入…']]);
      if (val && val !== '__text' && !FDM.memberOf(team, val)) val = '';
      var s = sel(opts, val, function (v) {
        if (v === '__text') put(side, i, ' ');
        else put(side, i, v ? { m: v } : '');
        renderInspector();
      }, { 'aria-label': (side === 'l' ? '左方' : '右方') + '第 ' + (i + 1) + ' 回合選人', 'data-keep': c.battle + side + i + 's' });
      if (val !== '__text') return s;
      var t = textInput(side, i, String(raw).trim());
      t.dataset.manual = '1';
      return h('div', { class: 'lcell' }, s, t);
    }
    var rows = [];
    for (var i = 0; i < n; i++) {
      var cur = live && (b.round || 1) === i + 1;
      rows.push(h('div', { class: 'lrow' + (cur ? ' cur' : '') },
        h('div', { class: 'ltitle' }, h('b', { text: titles[i] || ('第 ' + (i + 1) + ' 回合') }), cur ? h('span', { class: 'lnow', text: '目前' }) : null),
        input('l', i), input('r', i)));
    }
    add(pane, [h('h3', { text: '出賽名單（選填）' }),
      h('div', { class: 'lineup' },
        h('div', { class: 'lrow lhead' }, h('div'), h('div', { text: '左方　' + (tL && !tL._ph ? tL.en : FDM.sourceLabel(c.left) + '（未決定）') }), h('div', { text: '右方　' + (tR && !tR._ph ? tR.en : FDM.sourceLabel(c.right) + '（未決定）') })),
        rows),
      h('div', { class: 'hint', text: (live ? '演出中也可以臨時修改，輸出畫面即時更新。' : '比賽前先在這裡選好每個稱號上場的舞者（存在這個 Cue，清除比賽結果不會清掉）。演出中也可以在演出面板臨時修改。') + '隊伍頁上傳了成員字卡的隊伍可以直接選人，畫面會顯示那個人的字卡；選「不顯示」或不填就只有稱號。四強的隊伍要等四強選好後才能選人。' })]);
  }
  // 回合稱號設定（所有對戰共用）
  var BRUSH_FONTS = [['FD Potta One', '霸氣毛筆（Potta One，預設）'], ['FD Yuji Boku', '傳統書法（Yuji Boku）'], ['FD Reggae One', '粗獷筆刷（Reggae One）']];
  function battleRoundTitle(pane, c, cp, lp) {
    var rp = lp.concat('rt'), v = lp.concat('v'), rt = getAt(S, rp) || {};
    var maxR = Math.max.apply(null, [5].concat(S.cues.filter(function (x) { return x.type === 'battle'; }).map(function (x) { return x.rounds || 0; })));
    var fonts = BRUSH_FONTS.concat((S.event.fonts || []).map(function (f) { return [f.name, f.name + '（上傳）']; }));
    function setArr(key, i, val) {
      var arr = (getAt(S, rp.concat(key)) || []).slice();
      while (arr.length < maxR) arr.push(key === 'images' ? null : '');
      arr[i] = val;
      setPath(rp.concat(key), arr);
    }
    var rows = [];
    for (var i = 0; i < maxR; i++) {
      (function (i) {
        var el = h('input', { type: 'text', value: (rt.titles || [])[i] || '', placeholder: '（不顯示）', maxlength: 12, 'data-keep': 'rtitle' + i });
        el.addEventListener('input', function () { setArr('titles', i, el.value); });
        var img = (rt.images || [])[i];
        rows.push(h('div', { class: 'rtrow' },
          h('div', { class: 'rtn', text: '第 ' + (i + 1) + ' 回合' }), el,
          img ? h('div', { class: 'rtthumb', style: 'background-image:url("/' + img.replace(/^\//, '') + '")' }) : h('span', { class: 'faint', text: '文字' }),
          uploadBtn(img ? '換圖' : '上傳 PNG', 'image/png,image/webp', false, function (f) { upload(f[0]).then(function (p) { setArr('images', i, p); renderInspector(); }).catch(fail); }),
          img ? h('button', { class: 'ghost', text: '改回文字', onclick: function () { setArr('images', i, null); renderInspector(); } }) : null));
      })(i);
    }
    var photoMode = rt.mode === 'photo';
    add(pane, [c.noTitles ? h('div', { class: 'hint warnline', text: '這個 Cue 設定為不顯示回合稱號（「基本」分頁可以打開）。下面的設定是所有對戰共用的。' }) : null,
      h('h3', { text: '回合稱號' }),
      fld('顯示', chk('依回合顯示稱號', rp.concat('on'))),
      fld('位置', selPath(rp.concat('mode'), [['photo', '取代團隊照片（不顯示照片與外框）'], ['side', '照片框外側（保留團隊照片）']], function () { renderInspector(); })),
      h('div', { class: 'rttable' }, rows),
      h('div', { class: 'hint', text: '有上傳 PNG 的回合用圖片（透明背景），沒有的用下方的書法字。四強與決賽各 5 回合；表演賽不顯示。' }),
      h('h3', { text: '稱號位置與大小' }),
      photoMode ? [sl(v.concat('rp'), '大小（%）', 30, 200), sl(v.concat('rpy'), '上下微調', -300, 300),
        h('div', { class: 'hint', text: '稱號放在原本團隊照片的位置，照片與外框都不顯示。100% 等於原本照片的高度；位置跟著「版面」分頁的照片位置（照片寬度、左右間距、上下位置）。名字在隊名下方。' })]
        : [sl(v.concat('rh'), '大小（高度）', 80, 900), sl(v.concat('rx'), '左右位置', 300, 950), sl(v.concat('ry'), '上下位置', 100, 1000),
          h('div', { class: 'hint', text: '左右兩邊一起調、保持對稱。「左右位置」是離畫面中心的距離：數字越大越靠外側。' })],
      h('h3', { text: '名字' }),
      fld('顯示', chk('顯示出賽名字／字卡（關掉就只有稱號）', rp.concat('showNames'))),
      sl(v.concat('nch'), '字卡高度', 30, 300),
      sl(v.concat('ns'), '名字字級（沒有字卡時）', 16, 160), sl(v.concat('rng'), photoMode ? '名字與隊名間距' : '名字與稱號間距', 0, 200),
      photoMode ? null : sl(v.concat('rw'), '名字最大寬度', 60, 600),
      fld('名字字型', selPath(rp.concat('nameFont'), [['brush', '跟稱號文字同一個書法字型'], ['title', '跟隊名一樣']].concat(BRUSH_FONTS, [['Noto Serif TC', '思源宋體 Noto Serif TC'], ['Cinzel', 'Cinzel（英文）']],
        (S.event.fonts || []).map(function (f) { return [f.name, f.name + '（上傳）']; })), function () { renderInspector(); }), '可以到「素材與字型」上傳自己的字型'),
      fld('名字顏色', (function () {
        var cur = rt.nameColor || '';
        var s = sel([['', '跟稱號一樣'], ['ink', '墨色（深）'], ['light', '米白（淺）'], ['custom', '自訂顏色']], cur && cur !== 'ink' && cur !== 'light' ? 'custom' : cur, function (v) { setPath(rp.concat('nameColor'), v === 'custom' ? '#ffffff' : v || null); renderInspector(); });
        return cur && cur !== 'ink' && cur !== 'light' ? h('span', { style: 'display:inline-flex;gap:8px;align-items:center' }, s, colorPath(rp.concat('nameColor'))) : s;
      })()),
      h('h3', { text: '文字樣式（沒有圖片的回合）' }),
      fld('排列', selPath(rp.concat('dir'), [['v', '直式'], ['h', '橫式']])),
      fld('書法字型', selPath(rp.concat('font'), fonts), '也可以到「素材與字型」上傳自己的書法字型'),
      photoMode ? null : sl(v.concat('rs'), '文字字級', 40, 400),
      fld('顏色', selPath(rp.concat('color'), [['ink', '墨色（深）'], ['light', '米白（淺）']])),
      h('div', { class: 'hint', text: '動畫在「動畫」分頁的「回合稱號與名字」。' })]);
  }

  function battleLayout(pane, c, cp, lp) {
    var v = lp.concat('v'), rows = {};
    function R(k, l, a, b) { rows[k] = sl(v.concat(k), l, a, b); return rows[k]; }
    add(pane, [h('h3', { text: '照片' }), R('pw', '照片寬度', 150, 900), R('pd', '照片距中線', 0, 900), R('pt', '照片垂直', -300, 1000), R('pad', '框內邊距', 0, 300),
      h('h3', { text: '比分' }), R('ss', '比分字級', 20, 400), R('sd', '比分距中線', 0, 700), R('sy', '比分垂直', -200, 1080),
      h('div', { class: 'btnrow' },
        h('button', { class: 'small', text: '垂直對齊照片中心', onclick: function () { var q = getAt(S, v); setPath(v.concat('sy'), Math.round(q.pt + q.pw / 3)); rows.sy.sync(); } }),
        h('button', { class: 'small', text: '水平置中於照片與中線之間', onclick: function () { var q = getAt(S, v); setPath(v.concat('sd'), Math.round(q.pd / 2)); rows.sd.sync(); } })),
      fld('中線', chk('顯示比分中間的直線', lp.concat('divider'))),
      h('h3', { text: '標題' }), R('hy', '標題垂直', -300, 1000), R('hs', '標題字級', 12, 160), R('hg', '中文標題間距', 0, 400),
      h('h3', { text: '計時' }), R('ty', 'Timer 垂直', -300, 1080), R('ts', 'Timer 字級', 12, 240),
      h('h3', { text: '隊名' }), R('es', '英文字級', 12, 160), R('zs', '第二行字級', 12, 120), R('ng', '隊名距照片', -300, 400)]);
  }
  function battleAnim(pane, c, cp, lp) {
    animEditor(pane, lp.concat('anim'), 'battle', [['fr', '外框'], ['ph', '照片'], ['nm', '隊名'], ['info', '標題、比分、Timer'], ['rt', '回合稱號與名字（換回合也用這個）']]);
    add(pane, [sl(lp.concat(['anim', 'stagger']), '左右隊間隔 ms', 0, 3000, { step: 50 }),
      h('h3', { text: '比分變化' }), fld('效果', selPath(lp.concat('scoreFx'), [['fade', '浮現'], ['flip', '翻頁'], ['pop', '彈跳']]))]);
  }
  function battleSeal(pane, c, cp, lp) {
    var sp = lp.concat('seal'), v = lp.concat('v');
    add(pane, [h('h3', { text: '印章位置（左隊右下角、右隊左下角對稱）' }),
      sl(v.concat('gs'), '大小', 40, 400), sl(v.concat('gx'), '水平偏移', -400, 400), sl(v.concat('gy'), '垂直偏移', -400, 400), sl(v.concat('ga'), '角度', -45, 45),
      h('h3', { text: '印章樣式' }),
      fld('文字', txtPath(sp.concat('text'), '勝')),
      fld('印泥', h('div', { class: 'inl' }, colorPath(sp.concat('ink')), h('span', { class: 'faint', text: '字' }), colorPath(sp.concat('color')),
        h('button', { class: 'small', text: '米白／深紅', onclick: function () { setPath(sp.concat('ink'), '#ece0c8'); setPath(sp.concat('color'), '#8b2420'); renderInspector(); } }),
        h('button', { class: 'small', text: '墨黑／米白', onclick: function () { setPath(sp.concat('ink'), '#140707'); setPath(sp.concat('color'), '#ece0c8'); renderInspector(); } }),
        h('button', { class: 'small', text: '朱紅／米白', onclick: function () { setPath(sp.concat('ink'), '#e04a2c'); setPath(sp.concat('color'), '#ece0c8'); renderInspector(); } }))),
      fld('印章圖片', h('div', { class: 'inl' },
        uploadBtn('上傳印章 PNG', 'image/png,image/webp', false, function (f) { upload(f[0]).then(function (p) { setPath(sp.concat('img'), p); renderInspector(); }).catch(fail); }),
        getAt(S, sp.concat('img')) ? h('button', { class: 'ghost', text: '改回文字印章', onclick: function () { setPath(sp.concat('img'), null); renderInspector(); } }) : h('span', { class: 'faint', text: '上傳後會取代文字印章' }))),
      fld('蓋章動畫', selPath(sp.concat('anim'), [['ritual', '儀式感（懸停後蓋下）'], ['quick', '快速']])),
      h('h3', { text: '印章淡出' }),
      sl(sp.concat('fadeMs'), '淡出時間 ms', 100, 5000, { step: 50 }),
      fld('淡出方式', selPath(sp.concat('fadeMode'), [['fade', '單純淡出'], ['shrink', '淡出並縮小'], ['sink', '淡出並下沉']])),
      fld('切換回合', chk('切換回合時自動淡出', sp.concat('autoFade'))),
      h('h3', { text: 'Timer 最後幾秒' }),
      fld('效果', selPath(lp.concat(['timer', 'fx']), [['heartbeat', '米白心跳'], ['none', '無']])),
      sl(lp.concat(['timer', 'warn']), '開始秒數', 1, 60),
      fld('壓暗', chk('畫面四周墨色壓暗', lp.concat(['timer', 'vignette']))),
      fld('震動', chk('最後 3 秒加強並震動', lp.concat(['timer', 'shake'])))]);
  }

  // ---------- 頒獎（排舞賽冠軍／Battle 冠軍） ----------
  function champBasic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '得獎隊伍' }),
      fld('排舞賽冠軍', sourceSelect(c.runner, function (o) { setPath(cp.concat('runner'), o); renderCueList(); }, true), '可以先留空，演出時在頒獎 Cue 直接選'),
      fld('Battle 冠軍', sourceSelect(c.champ, function (o) { setPath(cp.concat('champ'), o); renderCueList(); }), '預設自動帶入決賽勝方'),
      h('div', { class: 'hint', text: '沒有亞軍。排舞賽冠軍與 Battle 冠軍可以是同一隊。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function champText(pane, c, cp, lp) {
    var t = lp.concat('text');
    add(pane, [h('h3', { text: 'Battle 冠軍' }),
      fld('懸念英文', txtPath(t.concat('lc'))), fld('懸念中文', txtPath(t.concat('lcz'))), fld('稱號', txtPath(t.concat('tc'))), fld('中文', txtPath(t.concat('cz'))),
      h('h3', { text: '排舞賽冠軍' }),
      fld('懸念英文', txtPath(t.concat('lr'))), fld('懸念中文', txtPath(t.concat('lrz'))), fld('稱號', txtPath(t.concat('trr'))), fld('中文', txtPath(t.concat('rz')))]);
  }
  function champLayout(pane, c, cp, lp) {
    var v = lp.concat('v');
    add(pane, [h('h3', { text: '懸念文字' }),
      sl(v.concat('lEs'), '英文字級', 12, 300), sl(v.concat('lZs'), '中文字級', 12, 200), sl(v.concat('lY'), '垂直位置', -200, 1000), sl(v.concat('lG'), '中英間距', -200, 400),
      h('h3', { text: '單獨畫面' }),
      sl(v.concat('sw'), '照片寬度', 300, 1400), sl(v.concat('sy'), '照片垂直', -200, 900), sl(v.concat('sTs'), '稱號字級', 12, 240), sl(v.concat('sTg'), '稱號距照片', -300, 400),
      sl(v.concat('sNs'), '隊名字級', 12, 240), sl(v.concat('sNg'), '隊名距照片', -300, 400), sl(v.concat('sZs'), '中文字級', 12, 200), sl(v.concat('sZg'), '中文行距', -100, 300),
      h('h3', { text: '同框畫面' }),
      sl(v.concat('cw'), 'Battle 冠軍照片寬度（右）', 200, 1100), sl(v.concat('rw'), '排舞賽冠軍照片寬度（左）', 200, 1100), sl(v.concat('gap'), '兩隊間距', -200, 800), sl(v.concat('dy'), '垂直位置', -200, 900),
      sl(v.concat('cTs'), 'Battle 稱號字級', 12, 200), sl(v.concat('cNs'), 'Battle 隊名字級', 12, 200), sl(v.concat('rTs'), '排舞賽稱號字級', 12, 200), sl(v.concat('rNs'), '排舞賽隊名字級', 12, 200),
      sl(v.concat('dTg'), '稱號距照片', -300, 400), sl(v.concat('dNg'), '隊名距照片', -300, 400), sl(v.concat('pad'), '框內邊距', 0, 300)]);
  }
  function champAnim(pane, c, cp, lp) {
    animEditor(pane, lp.concat('anim'), 'champ', [
      ['lt', '懸念英文'], ['lz', '懸念中文'], null,
      ['sf', '單獨：外框'], ['sp', '單獨：照片'], ['sn', '單獨：隊名'], ['sz', '單獨：中文'], ['st', '單獨：稱號'], null,
      ['df', '同框：外框'], ['dp', '同框：照片'], ['dn', '同框：隊名'], ['dt', '同框：稱號']]);
    add(pane, [h('h3', { text: '懸念與同框' }),
      sl(lp.concat('pause'), '懸念停頓 ms', 0, 10000, { step: 100 }),
      fld('懸念退場', selPath(lp.concat('leadOut'), FDM.FX_OUT)),
      fld('同框順序', selPath(lp.concat('duoOrder'), [['rc', '排舞賽冠軍先、Battle 冠軍後'], ['cr', 'Battle 冠軍先、排舞賽冠軍後'], ['same', '兩隊同時']])),
      sl(lp.concat('stg'), '兩隊間隔 ms', 0, 5000, { step: 50 })]);
  }

  function idleBasic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '贊助商跑馬燈' }),
      fld('跑馬燈', chk('在主視覺上顯示贊助商跑馬燈', lp.concat('marquee'))),
      fld('四強選隊', chk('演出時在這個 Cue 顯示四強選隊（評審討論用）', cp.concat('pickTop4'))),
      h('h3', { text: '切換' }),
      sl(lp.concat('fade'), '淡入時間 ms', 0, 5000, { step: 50 }),
      h('div', { class: 'hint', text: '切到主視覺待機時，底圖與贊助商跑馬燈淡入的時間（1000 = 1 秒）。所有主視覺待機 Cue 共用。' }),
      h('div', { class: 'btnrow' }, h('button', { text: '編輯贊助商 Logo →', onclick: function () { ui.page = 'sponsors'; saveUi(); renderHeader(); renderPage(false); } }))]);
    bgEditor(pane, lp.concat('bg'));
  }
  // ---------- 九隊總覽（上 4 下 5） ----------
  function overviewBasic(pane, c, cp, lp) {
    var n = S.teams.filter(function (t) { return !t.guest; }).length, top = getAt(S, lp.concat('top')), rows = FDM.overviewRows(n, top);
    add(pane, [nameField(cp), h('h3', { text: '排列' }),
      fld('顯示隊伍', chk('在底圖上排出所有隊伍的照片與隊名', lp.concat('teams'), function () { renderInspector(); })),
      fld('上排隊數', sel(Array.from({ length: n + 1 }, function (_, i) { return [String(i), '上 ' + i + '／下 ' + (n - i)]; }), String(rows[0]), function (v) { setPath(lp.concat('top'), Number(v)); renderInspector(); }), '預設上 4 下 5'),
      h('div', { class: 'hint', text: '隊伍順序依「隊伍」頁的順序：前 ' + rows[0] + ' 隊在上排，其餘在下排。關掉「顯示隊伍」就只顯示底圖（例如自己做好的影片）。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function overviewText(pane, c, cp, lp) {
    var t = lp.concat('text');
    add(pane, [h('h3', { text: '標題' }), fld('英文', txtPath(t.concat('title'), 'LINE UP')), fld('中文', txtPath(t.concat('zh'), '參賽隊伍')),
      h('div', { class: 'hint', text: '留空就不顯示。隊名第二行依「隊伍」頁的「隊名第二行」設定。' })]);
  }
  function overviewLayout(pane, c, cp, lp) {
    var v = lp.concat('v');
    add(pane, [h('h3', { text: '標題' }),
      sl(v.concat('hy'), '標題垂直', -200, 1000), sl(v.concat('hs'), '英文字級', 12, 240), sl(v.concat('hz'), '中文字級', 12, 160), sl(v.concat('hg'), '中英間距', -100, 300),
      h('h3', { text: '照片' }),
      sl(v.concat('w'), '照片寬度', 100, 600), sl(v.concat('gx'), '左右間距', 0, 300), sl(v.concat('y1'), '上排垂直', -200, 1000), sl(v.concat('y2'), '下排垂直', -200, 1080), sl(v.concat('pad'), '框內邊距', 0, 200),
      h('h3', { text: '隊名' }),
      sl(v.concat('ng'), '隊名距照片', -200, 300), sl(v.concat('es'), '英文字級', 12, 120), sl(v.concat('zs'), '第二行字級', 12, 100), sl(v.concat('lg'), '行距', -50, 200),
      h('div', { class: 'hint', text: '九隊隊名會用同一個字級，太長時一起縮小。' })]);
  }
  function overviewAnim(pane, c, cp, lp) {
    animEditor(pane, lp.concat('anim'), 'overview', [['hd', '標題'], null, ['fr', '外框'], ['ph', '照片'], ['en', '英文隊名'], ['zh', '第二行']]);
    add(pane, sl(lp.concat(['anim', 'stagger']), '每隊間隔 ms', 0, 2000, { step: 10 }));
  }
  function blackBasic(pane, c, cp) { add(pane, [nameField(cp), h('div', { class: 'hint', text: '全黑畫面，適合轉場或暫停。演出模式也可以隨時按 B 切黑畫面。' })]); }

  // ---------- 動畫編輯 ----------
  function animEditor(pane, ap, type, order) {
    var box = h('div');
    add(pane, [h('h3', { text: '整體' }),
      h('div', { class: 'btnrow' }, h('span', { class: 'faint', text: '預設組合：' }), Object.keys(FDM.PRESETS).map(function (k) {
        return h('button', { class: 'small', text: FDM.PRESETS[k].label, onclick: function () {
          var cur = getAt(S, ap), n = FDM.presetAnim(type, k, cur);
          if (cur.stagger != null) n.stagger = cur.stagger;
          setPath(ap, n); renderInspector(); post({ name: type === 'champ' ? 'champReveal' : type === 'top4' ? 'top4auto' : 'entrance', k: 'c' });
        } });
      })),
      sl(ap.concat('duration'), '動畫時間 ms', 100, 5000, { step: 50 }),
      sl(ap.concat('overlap'), '銜接點 %', 10, 150, { step: 5 }),
      h('div', { class: 'hint', text: '動畫時間套用到所有元素；銜接點是下一個元素在前一個跑到幾成時開始（100% = 等前一個跑完）。' }),
      h('h3', { text: '各元素' }), box]);
    order.forEach(function (o) {
      if (!o) { box.appendChild(h('div', { style: 'height:8px' })); return; }
      var sp = ap.concat(['steps', o[0]]);
      box.appendChild(h('div', { class: 'step' },
        h('div', { class: 'sh' }, h('span', { text: o[1] }), selPath(sp.concat('fx'), FDM.FX_IN)),
        sl(sp.concat('dur'), '個別時間 ms', 0, 5000, { step: 50, def: 0 }),
        sl(sp.concat('extra'), '額外延遲 ms', -3000, 5000, { step: 50, def: 0 })));
    });
    add(pane, h('div', { class: 'hint', text: '個別時間為 0 時跟隨整體動畫時間。' }));
  }

  // ---------------------------------------------------------------------------
  // 隊伍頁
  // ---------------------------------------------------------------------------
  function pageTeams(page) {
    var wrap = h('div', { class: 'pagewrap' });
    page.appendChild(wrap);
    if (!FDM.teamById(S, ui.team) && S.teams[0]) ui.team = S.teams[0].id;
    var t = FDM.teamById(S, ui.team);
    var mon = monitor('/output/?preview=' + encodeURIComponent('__team:' + ui.team), '單隊展示預覽', 'prev');
    var right = h('div', { class: 'sticky' }, mon.el, h('div', { class: 'card' }, t ? h('div', { id: 'photoEd' }) : null), t ? h('div', { class: 'card', id: 'memberEd' }) : null);
    if (t) photoEditor(right.querySelector('#photoEd'), t, function () { renderPage(true); });
    if (t) memberEditor(right.querySelector('#memberEd'), t);
    var table = h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['#', '照片', '英文隊名', '中文隊名', '標籤（城市）', '種子', '表演賽', ''].map(function (x) { return h('th', { text: x }); }))),
      h('tbody', null, S.teams.map(function (tm, i) {
        var tr = h('tr', { class: tm.id === ui.team ? 'sel' : '', onclick: function (e) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
          ui.team = tm.id; saveUi(); renderPage(false);
        } },
        h('td', { class: 'faint', text: i + 1 }),
        h('td', null, tm.photo.src ? h('img', { class: 'thumb' + (tm.photo.logo ? ' logo' : ''), src: '/' + (tm.photo.trim || tm.photo.src), alt: '' }) : h('span', { class: 'faint', text: '未上傳' })),
        h('td', null, txtPath(['teams', i, 'en'], 'TEAM NAME')),
        h('td', null, txtPath(['teams', i, 'zh'], '選填')),
        h('td', null, txtPath(['teams', i, 'tag'], '選填')),
        h('td', null, (function () { var c = h('input', { type: 'checkbox', checked: !!tm.seed }); c.addEventListener('change', function () { setPath(['teams', i, 'seed'], c.checked); }); return c; })()),
        h('td', null, (function () { var c = h('input', { type: 'checkbox', checked: !!tm.guest, title: '特別邀請的表演賽隊伍：不列入九隊總覽、四強與頒獎選單' }); c.addEventListener('change', function () { setPath(['teams', i, 'guest'], c.checked); renderPage(false); }); return c; })()),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'ghost', text: '↑', title: '上移', onclick: function () { moveTeam(i, -1); } }),
          h('button', { class: 'ghost', text: '↓', title: '下移', onclick: function () { moveTeam(i, 1); } }),
          h('button', { class: 'ghost', text: '✕', title: '刪除', onclick: function () {
            if (!confirm('刪除隊伍「' + tm.en + '」？使用這隊的 Cue 會變成未選隊伍。')) return;
            var a = clone(S.teams); a.splice(i, 1); setPath(['teams'], a); renderPage(false);
          } })));
        return tr;
      })));
    add(wrap, h('div', { class: 'split' },
      h('div', null,
        h('h2', { text: '隊伍資料', style: 'margin:0 0 4px' }),
        h('div', { class: 'hint', text: '點一列可在右側調整這隊的照片。順序影響「產生 9 隊」與九隊總覽；實際出場順序以 Cue 表為準。勾「表演賽」的特邀隊伍不會列入九隊總覽、四強與頒獎。' }),
        table,
        h('div', { class: 'btnrow', style: 'margin-top:12px' },
          h('button', { text: '＋ 新增隊伍', onclick: function () {
            var id = uid('t');
            var a = clone(S.teams); a.push({ id: id, en: 'NEW TEAM', zh: '', tag: '', seed: false, photo: { src: null, trim: null, fit: 'auto', zoom: 100, x: 0, y: 0 } });
            setPath(['teams'], a); ui.team = id; renderPage(false);
          } })),
        h('h3', { text: '隊名第二行' }),
        fld('顯示', selPath(['event', 'line2'], [['zh', '中文隊名（沒有則顯示標籤）'], ['tag', '只顯示標籤'], ['none', '不顯示']])),
        h('h3', { text: '收照片規範（建議提供給各隊）' }),
        h('div', { class: 'hint', html: '3:2 橫式、全員入鏡、背景單純、寬度至少 1800px。<br>收到後統一去背（Photoshop 或 remove.bg），上傳透明背景 PNG 會自動裁掉四周空白並放大人物。' })),
      right));
  }
  // 成員字卡：每團每個人一張名字字卡（PNG），對戰的出賽名單可以直接選人
  function memberEditor(box, t) {
    var ti = S.teams.indexOf(t), mp = ['teams', ti, 'members'], ms = t.members || [];
    function addFiles(files) {
      var list = clone(getAt(S, mp) || []);
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () { return processPhoto(f); }).then(function (r) {
          var name = f.name.replace(/\.\w+$/, '').replace(/[-_]?trim$/, '').trim();
          // 同名的人：換字卡；沒有就新增
          var hit = list.filter(function (m) { return m.name === name; })[0];
          if (hit) hit.card = { src: r.src, trim: r.trim };
          else list.push({ id: uid('m'), name: name, card: { src: r.src, trim: r.trim } });
        });
      });
      chain.then(function () { setPath(mp, list); toast('已加入 ' + files.length + ' 張字卡'); renderPage(true); }).catch(fail);
    }
    var rows = ms.map(function (m, j) {
      var src = m.card ? (m.card.trim || m.card.src) : '';
      return h('div', { class: 'mrow' },
        src ? h('div', { class: 'mthumb', style: 'background-image:url("/' + src.replace(/^\//, '') + '")' }) : h('div', { class: 'mthumb none', text: '無字卡' }),
        txtPath(mp.concat([j, 'name']), '名字'),
        uploadBtn(src ? '換字卡' : '上傳字卡', 'image/png,image/webp,image/jpeg', false, function (f) {
          processPhoto(f[0]).then(function (r) { setPath(mp.concat([j, 'card']), { src: r.src, trim: r.trim }); renderPage(true); }).catch(fail);
        }),
        h('button', { class: 'ghost', text: '✕', title: '刪除', onclick: function () {
          if (!confirm('刪除成員「' + (m.name || '') + '」？已選這個人的出賽名單會變成不顯示。')) return;
          var a = clone(ms); a.splice(j, 1); setPath(mp, a); renderPage(true);
        } }));
    });
    add(box, [h('h3', { text: '成員字卡（' + (t.en || '') + '）', style: 'margin-top:0' }),
      h('div', { class: 'btnrow' },
        uploadBtn('上傳字卡（可多選）', 'image/png,image/webp,image/jpeg', true, addFiles),
        h('button', { class: 'ghost', text: '＋ 新增成員（只打名字）', onclick: function () { var a = clone(ms); a.push({ id: uid('m'), name: '', card: null }); setPath(mp, a); renderPage(true); } })),
      rows.length ? h('div', { class: 'mlist' }, rows) : h('div', { class: 'faint', text: '還沒有成員' }),
      h('div', { class: 'hint', text: '檔名就是名字，例如「小明.png」會新增成員「小明」，一次可以選這團所有人的字卡；同名的會換成新字卡。透明背景 PNG 會自動裁掉四周空白。對戰 Cue 的出賽名單就能直接選人。' })]);
  }
  function moveTeam(i, d) { var j = i + d; if (j < 0 || j >= S.teams.length) return; var a = clone(S.teams); var t = a[i]; a[i] = a[j]; a[j] = t; setPath(['teams'], a); renderPage(false); }

  // ---------------------------------------------------------------------------
  // 評審／MC／DJ 頁
  // ---------------------------------------------------------------------------
  function newPerson(type) { var k = K(type); return { id: uid(k.prefix), en: 'NEW ' + k.ph, zh: '', tag: '', photo: { src: null, trim: null, fit: 'auto', zoom: 100, x: 0, y: 0 } }; }
  function pageJudges(page) {
    var wrap = h('div', { class: 'pagewrap' });
    page.appendChild(wrap);
    var type = FDM.PEOPLE[ui.pkind] ? ui.pkind : 'judge', k = K(type), lp = [k.list];
    var js = FDM.peopleOf(S, type);
    ui.psel = ui.psel || {};
    if (!FDM.personById(S, type, ui.psel[type]) && js[0]) ui.psel[type] = js[0].id;
    var j = FDM.personById(S, type, ui.psel[type]);
    var mon = monitor('/output/?preview=' + encodeURIComponent('__' + type + ':' + (j ? j.id : '')), FDM.TYPES[type] + '預覽', 'prev');
    var right = h('div', { class: 'sticky' }, mon.el, h('div', { class: 'card' }, j ? h('div', { id: 'photoEd' }) : h('div', { class: 'muted', text: '新增' + k.label + '後可在這裡上傳照片。' })));
    if (j) photoEditor(right.querySelector('#photoEd'), j, function () { renderPage(true); }, [k.list, js.indexOf(j), 'photo']);
    function move(i, d) { var n = i + d; if (n < 0 || n >= js.length) return; var a = clone(js); var t = a[i]; a[i] = a[n]; a[n] = t; setPath(lp, a); renderPage(false); }
    var table = h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['#', '照片', '英文名字', '中文名字', '標籤（Crew／城市）', ''].map(function (x) { return h('th', { text: x }); }))),
      h('tbody', null, js.map(function (jd, i) {
        return h('tr', { class: jd.id === ui.psel[type] ? 'sel' : '', onclick: function (e) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
          ui.psel[type] = jd.id; saveUi(); renderPage(false);
        } },
        h('td', { class: 'faint', text: i + 1 }),
        h('td', null, jd.photo.src ? h('img', { class: 'thumb', src: '/' + (jd.photo.trim || jd.photo.src), alt: '' }) : h('span', { class: 'faint', text: '未上傳' })),
        h('td', null, txtPath([k.list, i, 'en'], k.ph + ' NAME')),
        h('td', null, txtPath([k.list, i, 'zh'], '選填')),
        h('td', null, txtPath([k.list, i, 'tag'], '選填')),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'ghost', text: '↑', title: '上移', onclick: function () { move(i, -1); } }),
          h('button', { class: 'ghost', text: '↓', title: '下移', onclick: function () { move(i, 1); } }),
          h('button', { class: 'ghost', text: '✕', title: '刪除', onclick: function () {
            if (!confirm('刪除' + k.label + '「' + jd.en + '」？使用的 Cue 會變成未選' + k.label + '。')) return;
            var a = clone(js); a.splice(i, 1); setPath(lp, a); renderPage(false);
          } })));
      })));
    add(wrap, h('div', { class: 'split' },
      h('div', null,
        h('div', { class: 'seg', style: 'margin-bottom:14px' }, Object.keys(FDM.PEOPLE).map(function (t) {
          return h('button', { class: t === type ? 'on' : '', text: FDM.PEOPLE[t].label, onclick: function () { ui.pkind = t; saveUi(); renderPage(false); } });
        })),
        h('h2', { text: k.label + '資料', style: 'margin:0 0 4px' }),
        h('div', { class: 'hint', text: '點一列可在右側調整照片。實際出場順序以 Cue 表為準。' }),
        table,
        h('div', { class: 'btnrow', style: 'margin-top:12px' },
          h('button', { text: '＋ 新增' + k.label, onclick: function () {
            var n = newPerson(type), a = clone(js); a.push(n); setPath(lp, a); ui.psel[type] = n.id; renderPage(false);
          } })),
        h('h3', { text: '怎麼排進流程' }),
        h('div', { class: 'hint', html: '到「流程 → 編排」，左下角類型選「' + FDM.TYPES[type] + '」再選人按新增' + (type === 'judge' ? '，或按「產生評審」一次加入全部評審' : '') + '。<br>懸念文字、稱號、照片比例、版面與動畫在點選 Cue 後的右側設定；評審、MC、DJ 各自一套。' }),
        h('h3', { text: '照片建議' }),
        h('div', { class: 'hint', text: '單人照片可以用去背 PNG（會自動裁掉透明邊）。想用直式照片時，在 Cue 的「基本」分頁把照片比例改成 4:5 或 2:3。' })),
      right));
  }

  // ---------------------------------------------------------------------------
  // 贊助商頁
  // ---------------------------------------------------------------------------
  function pageSponsors(page) {
    var wrap = h('div', { class: 'pagewrap' });
    page.appendChild(wrap);
    var sp = ['sponsors'];
    var mon = monitor('/output/?preview=__idle', '主視覺待機預覽', 'prev');
    var list = h('div');
    S.sponsors.logos.forEach(function (l, i) {
      var lp = ['sponsors', 'logos', i];
      list.appendChild(h('div', { class: 'logo-row' },
        h('img', { src: '/' + l.src, alt: '' }),
        (function () { var s = sl(lp.concat('scale'), '', 20, 300, { def: 100 }); s.style.gridTemplateColumns = '0 minmax(0,1fr) 64px 24px'; return s; })(),
        h('span', { class: 'faint', text: '%' }), h('span'),
        h('div', { style: 'white-space:nowrap' },
          h('button', { class: 'ghost', text: '↑', onclick: function () { moveLogo(i, -1); } }),
          h('button', { class: 'ghost', text: '↓', onclick: function () { moveLogo(i, 1); } }),
          h('button', { class: 'ghost', text: '✕', onclick: function () { var a = clone(S.sponsors.logos); a.splice(i, 1); setPath(['sponsors', 'logos'], a); renderPage(false); } }))));
    });
    add(wrap, h('div', { class: 'split' },
      h('div', null,
        h('h2', { text: '贊助商跑馬燈', style: 'margin:0 0 4px' }),
        h('div', { class: 'hint', text: '顯示在「主視覺待機」Cue。建議使用透明背景 PNG。' }),
        h('div', { class: 'btnrow' }, uploadBtn('＋ 上傳 Logo（可多選）', 'image/*', true, function (files) {
          files.reduce(function (p, f) {
            return p.then(function () { return upload(f).then(function (path) { var a = clone(S.sponsors.logos); a.push({ id: uid('s'), src: path, scale: 100 }); setPath(['sponsors', 'logos'], a); }); });
          }, Promise.resolve()).then(function () { renderPage(false); }).catch(fail);
        })),
        h('h3', { text: 'Logo（個別大小）' }),
        S.sponsors.logos.length ? list : h('div', { class: 'faint', text: '尚未上傳 Logo' }),
        h('h3', { text: '跑馬燈設定' }),
        sl(sp.concat('speed'), '速度 px/s', 0, 600), sl(sp.concat('height'), '整體大小', 20, 300), sl(sp.concat('gap'), '間距', 0, 500), sl(sp.concat('y'), '垂直位置', 0, 1080),
        fld('方向', selPath(sp.concat('direction'), [[-1, '向左'], [1, '向右']].map(function (x) { return [String(x[0]), x[1]]; }), null)),
        fld('Logo 顏色', selPath(sp.concat('color'), [['original', '原色'], ['black', '統一墨黑'], ['cream', '統一米白']])),
        fld('底色帶', selPath(sp.concat('band'), [['none', '無'], ['dark', '深色'], ['cream', '米白']]))),
      h('div', { class: 'sticky' }, mon.el, h('div', { class: 'hint', text: '主視覺底圖請在「流程」頁選取主視覺待機 Cue 設定。' }))));
    // 方向存成數字
    var dirSel = wrap.querySelectorAll('select')[0];
    if (dirSel) { dirSel.value = String(S.sponsors.direction); dirSel.onchange = function () { setPath(['sponsors', 'direction'], Number(dirSel.value)); }; }
  }
  function moveLogo(i, d) { var j = i + d; if (j < 0 || j >= S.sponsors.logos.length) return; var a = clone(S.sponsors.logos); var t = a[i]; a[i] = a[j]; a[j] = t; setPath(['sponsors', 'logos'], a); renderPage(false); }

  // ---------------------------------------------------------------------------
  // 素材與字型頁
  // ---------------------------------------------------------------------------
  function pageAssets(page) {
    var wrap = h('div', { class: 'pagewrap' });
    page.appendChild(wrap);
    var fonts = [['Cinzel', 'Cinzel（內建英文）'], ['Noto Serif TC', '思源宋體 Noto Serif TC（內建中文）']].concat((S.event.fonts || []).map(function (f) { return [f.name, f.name + '（上傳）']; }));
    var firstTeamCue = S.cues.filter(function (c) { return c.type === 'team'; })[0];
    var mon = monitor('/output/?preview=' + encodeURIComponent(firstTeamCue ? firstTeamCue.id : '__team:' + (S.teams[0] && S.teams[0].id)), '預覽', 'prev');
    add(wrap, h('div', { class: 'split' },
      h('div', null,
        h('h2', { text: '素材與字型', style: 'margin:0 0 4px' }),
        h('h3', { text: '照片外框' }),
        h('div', { class: 'btnrow', style: 'align-items:center' },
          S.frame ? h('img', { class: 'thumb', src: '/' + S.frame, alt: '' }) : h('span', { class: 'faint', text: '使用內建外框' }),
          uploadBtn('上傳外框 PNG', 'image/png,image/webp,image/svg+xml', false, function (f) { upload(f[0]).then(function (p) { setPath(['frame'], p); renderPage(false); }).catch(fail); }),
          S.frame ? h('button', { class: 'ghost', text: '改回內建外框', onclick: function () { setPath(['frame'], null); renderPage(false); } }) : null),
        h('div', { class: 'hint', text: '外框 PNG 建議 3:2（例如 1560×1040），所有隊伍共用，會拉伸到照片框大小。' }),
        h('h3', { text: '字型' }),
        fld('英文字型', selPath(['event', 'fontEn'], fonts)),
        fld('中文字型', selPath(['event', 'fontZh'], fonts)),
        h('div', { class: 'btnrow', style: 'align-items:center' },
          uploadBtn('上傳字型', '.ttf,.otf,.woff,.woff2', true, function (files) {
            files.reduce(function (p, f) {
              return p.then(function () { return upload(f).then(function (path) {
                var name = f.name.replace(/\.\w+$/, '');
                var a = clone(S.event.fonts || []).filter(function (x) { return x.name !== name; }); a.push({ name: name, url: path });
                setPath(['event', 'fonts'], a);
              }); });
            }, Promise.resolve()).then(function () { renderPage(false); }).catch(fail);
          }),
          h('span', { class: 'faint', text: '商用字型請確認授權涵蓋活動與影像播出' })),
        (S.event.fonts || []).length ? h('div', null, S.event.fonts.map(function (f, i) {
          return h('div', { class: 'btnrow', style: 'align-items:center' }, h('span', { text: f.name }), h('button', { class: 'ghost', text: '移除', onclick: function () {
            var a = clone(S.event.fonts); a.splice(i, 1); setPath(['event', 'fonts'], a); renderPage(false);
          } }));
        })) : null,
        h('h3', { text: '顏色與質感' }),
        fld('文字顏色', colorPath(['event', 'ink'])),
        fld('亮色', colorPath(['event', 'light']), 'Timer 最後幾秒的心跳顏色'),
        fld('印刷質感', chk('文字加上輕微印刷顆粒', ['event', 'grain'])),
        h('h3', { text: '特效' }),
        fld('總開關', chk('啟用所有動畫特效（關閉後元素直接出現）', ['event', 'effectsEnabled'])),
        h('div', { class: 'hint', text: '緊急時關閉特效，所有畫面會改為直接切換。' })),
      h('div', { class: 'sticky' }, mon.el)));
  }

  // ---------------------------------------------------------------------------
  // 設定頁
  // ---------------------------------------------------------------------------
  // 遙控網頁設定：密碼、網址與 QR Code（設定只存在這台電腦，不會同步給其他裝置）
  // 這個區塊不跟著賽事狀態重畫（留在設定頁時重複使用同一個），打字才不會被清掉
  var remoteCache = null;
  function remoteBox() {
    if (remoteCache) return remoteCache;
    var box = h('div', { class: 'card remote' }, h('div', { class: 'faint', text: '讀取中…' }));
    function post(body) {
      return fetch('/api/remote/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); }).then(function (r) { if (!r.ok) throw new Error(r.error); });
    }
    function load() {
      fetch('/api/remote/config').then(function (r) { return r.json(); }).then(function (c) {
        var pw = h('input', { type: 'text', value: c.password || '', placeholder: '至少 4 個字', maxlength: 32, autocomplete: 'off', style: 'width:180px' });
        var tpw = h('input', { type: 'text', value: c.timerPassword || '', placeholder: '選填，留空＝不開放', maxlength: 32, autocomplete: 'off', style: 'width:180px' });
        var mpw = h('input', { type: 'text', value: c.masterPassword || '', placeholder: '選填，至少 6 個字', maxlength: 32, autocomplete: 'off', style: 'width:180px' });
        var en = h('input', { type: 'checkbox', checked: c.enabled });
        function saveCfg(msg) {
          return post({ enabled: en.checked, password: pw.value, timerPassword: tpw.value, masterPassword: mpw.value }).then(function () { toast(msg); load(); })
            .catch(function (e) { toast(e.message, true); if (en.checked && pw.value.trim().length < 4) { en.checked = false; } });
        }
        en.addEventListener('change', function () {
          if (en.checked && pw.value.trim().length < 4) { toast('請先設定至少 4 個字的密碼', true); en.checked = false; pw.focus(); return; }
          saveCfg(en.checked ? '已開啟遙控網頁' : '已關閉遙控網頁，所有手機都已登出');
        });
        function qrItem(svg, url, cap, net) {
          var q = h('div', { class: 'qr' }); q.innerHTML = svg;
          return h('div', { class: 'qritem' }, h('b', { class: 'qcap', text: cap }), q, h('code', { text: url }), net ? h('span', { class: 'faint qnet', text: net }) : null);
        }
        box.dataset.ips = c.urls.map(function (u) { return u.ip; }).join(',');
        box.innerHTML = '';
        add(box, [
          h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:700;cursor:pointer' }, en, '開啟遙控網頁'),
          h('div', { class: 'pwgrid' },
            h('span', { class: 'muted', text: '完整遙控密碼' }), pw,
            h('button', { text: '儲存', onclick: function () {
              if (pw.value.trim().length < 4) { toast('密碼至少 4 個字', true); return; }
              saveCfg('已更新密碼，已登入的手機需要重新輸入');
            } }),
            h('span', { class: 'faint', text: '比分、四強、Timer' }),
            h('span', { class: 'muted', text: 'Timer 專用密碼' }), tpw,
            h('button', { text: '儲存', onclick: function () {
              var v = tpw.value.trim();
              if (v && v.length < 4) { toast('Timer 專用密碼至少 4 個字（不需要就留空）', true); return; }
              saveCfg(v ? '已更新 Timer 專用密碼' : '已關閉 Timer 專用密碼');
            } }),
            h('span', { class: 'faint', text: '只能控制 Timer（給計時人員）' }),
            h('span', { class: 'muted', text: '總控密碼' }), mpw,
            h('button', { text: '儲存', onclick: function () {
              var v = mpw.value.trim();
              if (v && v.length < 6) { toast('總控密碼至少 6 個字（不需要就留空）', true); return; }
              saveCfg(v ? '已更新總控密碼，手機版總控需要重新登入' : '已關閉手機版總控');
            } }),
            h('span', { class: 'faint', text: '手機版控台：切換所有 Cue 與演出操作（只給總控）' })),
          c.urls.length ? h('div', { class: 'qrs' }, c.urls.map(function (u, i) {
            var net = '網路：' + u.name + (u.virtual ? '（虛擬網卡，手機通常連不到）' : '');
            return h('div', { class: 'qrset' + (u.virtual ? ' virtual' : '') },
              c.enabled ? [qrItem(u.qr, u.url, '完整遙控', net), qrItem(u.timerQr, u.timerUrl, 'Timer 專用', net)] : null,
              c.enabled && c.masterPassword ? qrItem(u.masterQr, u.masterUrl, '手機版總控', net) : null,
              qrItem(u.clockQr, u.clockUrl, '倒數顯示（不用密碼）', net));
          })) : h('div', { class: 'err', text: '這台電腦目前沒有連上任何網路，手機無法連線。請先連上 Wi-Fi 或手機熱點（不需要網際網路）。連上後這裡會自動出現 QR Code。' }),
          c.enabled ? [
            null,
            h('div', { class: 'btnrow', style: 'align-items:center' },
              h('span', { class: 'muted', text: '已登入的裝置：' + c.devices + ' 台' + (c.timerDevices || c.masterDevices ? '（' + [c.masterDevices ? '總控 ' + c.masterDevices + ' 台' : '', c.timerDevices ? 'Timer 專用 ' + c.timerDevices + ' 台' : ''].filter(Boolean).join('、') + '）' : '') }),
              h('button', { class: 'small', text: '登出所有裝置', onclick: function () { post({ logoutAll: true }).then(function () { toast('所有手機都已登出'); load(); }).catch(fail); } }),
              h('button', { class: 'small', text: '重新整理', onclick: load }))
          ] : null,
          c.urls.length > 1 ? h('div', { class: 'hint', text: '有好幾組網址時，請用和手機「同一個網路」的那一組（例如連手機熱點時，通常是 172.20.10 或 192.168 開頭）。' }) : null,
          h('div', { class: 'hint', html: '手機連上<b>和這台電腦同一個 Wi-Fi</b>，掃 QR Code 或輸入網址，再輸入密碼即可使用。' +
            '<br><b>倒數顯示</b>：只有大大的倒數數字，不用密碼也不能操作，適合放在舞台邊的平板或螢幕給舞者、MC 看（不用開啟遙控網頁也能用；點畫面可全螢幕）。' +
            '<br><b>完整遙控</b>：加減比分、選四強、控制 Timer。<b>Timer 專用</b>：只有倒數計時（開始／暫停、重置、秒數），用 Timer 專用密碼登入的人改不了比分。' +
            '<br><b>手機版總控</b>：跟演出小面板一樣，GO、切換任何 Cue、回合、印章、Timer、揭曉、頒獎都能操作，畫面會跟著播出中的 Cue 換成對應的按鈕。只把總控密碼給總控本人；不能進入編排與設定。' +
            '<br>回合、印章、晉級與播放仍在控制台。換完整遙控密碼或關閉後，所有手機都要重新登入。' +
            '<br>Windows 第一次開啟時若跳出防火牆詢問，請允許「私人網路」，否則手機連不上。' })]);
      }).catch(function () { box.replaceChildren(h('div', { class: 'faint', text: '無法讀取遙控設定' })); });
    }
    load();
    // 換網路（例如到現場改連手機熱點）時 IP 會變：每 4 秒檢查一次，變了就自動更新網址與 QR Code
    var watch = setInterval(function () {
      if (!document.body.contains(box)) { clearInterval(watch); return; }
      if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      fetch('/api/info').then(function (r) { return r.json(); }).then(function (i) {
        var now = (i.addresses || []).filter(function (a) { return a.indexOf('169.254.') !== 0; }).slice().sort().join(',');
        var was = (box.dataset.ips || '').split(',').filter(Boolean).sort().join(',');
        if (box.dataset.ips != null && now !== was) { load(); toast('網路已變更，遙控網址與 QR Code 已更新，手機請重新掃描'); }
      }).catch(function () {});
    }, 4000);
    remoteCache = box;
    return box;
  }

  // 目前連線中的畫面：每一個輸出畫面都會完整算一次動畫與影片，開太多會搶電腦資源（OBS／Arena 卡頓）
  var KIND_NAMES = { obs: 'OBS 瀏覽器來源', window: '輸出視窗（本程式）', monitor: '控制台 LIVE／NEXT 監看', preview: '編排預覽', browser: '瀏覽器開的輸出畫面', control: '控制台', mini: '演出小面板', phone: '手機版總控', remote: '遙控網頁', timer: 'Timer 專用', clock: '倒數顯示', other: '其他' };
  var OUTPUT_KINDS = ['obs', 'window', 'monitor', 'preview', 'browser'];
  function clientsBox() {
    var box = h('div', { class: 'card clients' }, h('div', { class: 'faint', text: '讀取中…' }));
    function load() {
      if (!document.body.contains(box) && box.dataset.loaded) return;
      fetch('/api/clients').then(function (r) { return r.json(); }).then(function (r) {
        box.dataset.loaded = '1';
        var c = r.counts || {}, rows = [], outputs = 0, obs = 0;
        Object.keys(c).sort().forEach(function (k) {
          var base = k.replace('@lan', ''), lan = k !== base;
          if (OUTPUT_KINDS.indexOf(base) >= 0) outputs += c[k];
          if (base === 'obs') obs += c[k];
          rows.push(h('div', { class: 'crow' }, h('span', { text: (KIND_NAMES[base] || base) + (lan ? '（其他裝置）' : '') }), h('b', { text: c[k] + ' 個' })));
        });
        var tips = [];
        if (obs > 1) tips.push('OBS 裡有 ' + obs + ' 個瀏覽器來源同時在跑。不同場景請用「加入現有來源」共用同一個，不要各自新增，否則會重複運算。');
        if (obs && c.window) tips.push('已經用 OBS 輸出時，「輸出視窗」通常可以關掉（選單「輸出 → 關閉輸出視窗」）。');
        if (obs && c.monitor) tips.push('演出時可以在流程頁按「關閉監看畫面」，或改用「演出小面板」，省下兩個完整畫面的運算。');
        box.innerHTML = '';
        add(box, [h('div', { class: 'crows' }, rows.length ? rows : h('span', { class: 'faint', text: '沒有連線中的畫面' })),
          h('div', { class: outputs > 2 ? 'hint warnline' : 'hint', text: '同時在運算的輸出畫面：' + outputs + ' 個' + (outputs > 2 ? '（偏多，可能造成卡頓）' : '') }),
          tips.length ? h('ul', { class: 'tips' }, tips.map(function (t) { return h('li', { text: t }); })) : null,
          h('div', { class: 'hint', html: '想確認畫面本身有沒有掉格：把 OBS 瀏覽器來源的網址改成 <code>http://localhost:' + (location.port || '80') + '/output/?fps=1</code>，左上角會顯示每秒畫格數與掉格次數（檢查完再改回來）。' })]);
      }).catch(function () {});
    }
    load();
    var t = setInterval(function () { if (!document.body.contains(box)) { clearInterval(t); return; } load(); }, 3000);
    return box;
  }

  function pageSettings(page) {
    var wrap = h('div', { class: 'pagewrap', style: 'max-width:860px' });
    page.appendChild(wrap);
    var host = location.host, port = location.port || '80';
    var outBox = h('div');
    var backups = h('div', { class: 'faint', text: '讀取中…' });
    add(wrap, [
      h('h2', { text: '設定', style: 'margin:0' }),
      h('h3', { text: '輸出畫面' }), outBox,
      h('div', { class: 'card' },
        h('div', null, 'OBS 瀏覽器來源／其他電腦：', h('code', { text: 'http://' + host + '/output/' })),
        h('ol', { class: 'obssteps' },
          h('li', { text: 'OBS「來源」按 ＋ →「瀏覽器」，網址貼上面這個' }),
          h('li', null, h('b', { text: '寬度 1920、高度 1080' }), '（OBS 預設 800×600，沒改畫面會糊）'),
          h('li', { text: '勾選「透過 OBS 控制音訊」可以在 OBS 混音；要透明疊加時把底圖模式設為「透明」' })),
        h('div', { class: 'hint', text: '尺寸沒設對時，OBS 畫面左上角會出現黃色提醒，改好就會自動消失。' }),
        h('div', { id: 'lan', class: 'hint' })),
      h('h3', { text: '目前開著的畫面（卡頓時檢查）' }), clientsBox(),
      h('h3', { text: '遙控網頁（手機加減分、選四強、Timer）' }), remoteBox(),
      h('h3', { text: '備份與還原' }),
      h('div', { class: 'hint', text: '每次修改都會立即存檔，另外每 5 分鐘自動備份一份（保留最近 20 份）。' }),
      h('div', { class: 'btnrow' },
        h('a', { href: '/api/export', download: '' }, h('button', { text: '匯出整個賽事（含素材）' })),
        uploadBtn('匯入賽事壓縮檔', '.zip', false, function (f) {
          if (!confirm('匯入會取代目前的所有資料（會先自動備份）。確定？')) return;
          var fdata = new FormData(); fdata.append('file', f[0]);
          fetch('/api/import', { method: 'POST', body: fdata }).then(function (r) { return r.json(); }).then(function (r) { if (!r.ok) throw new Error(r.error); toast('已匯入'); }).catch(fail);
        }),
        h('button', { text: '立即備份', onclick: function () { fetch('/api/backups/now', { method: 'POST' }).then(function () { toast('已備份'); loadBackups(); }).catch(fail); } })),
      backups,
      h('h3', { text: '重設比賽資料' }),
      h('div', { class: 'hint', text: '彩排後正式開始前使用：清除四強、所有比分、印章、晉級與播出狀態，隊伍與版面設定都會保留。' }),
      h('div', { class: 'btnrow' }, h('button', { class: 'danger', text: '清除比賽結果', onclick: function () {
        if (!confirm('清除四強、所有比分、印章、晉級與播出狀態？（會先自動備份）')) return;
        fetch('/api/backups/now', { method: 'POST' }).then(function () {
          cmd([set(['results'], clone(D.results)), set(['show'], Object.assign(clone(D.show), { seq: (S.show.seq || 0) + 1 }))], null, true);
          toast('已清除比賽結果');
        }).catch(fail);
      } })),
      window.funk && window.funk.checkUpdate ? [
        h('h3', { text: '版本與更新' }),
        h('div', { class: 'btnrow', style: 'align-items:center' },
          h('span', { id: 'appver', class: 'muted', text: '目前版本 …' }),
          h('button', { text: '檢查更新', onclick: function () { toast('正在檢查更新…'); window.funk.checkUpdate(); } })),
        h('div', { class: 'hint', text: '程式啟動時會自動檢查；有新版本時會詢問是否下載並更新。更新不會動到賽事資料。演出進行中請不要更新。' })
      ] : null,
      h('h3', { text: '關於' }),
      h('div', { class: 'faint', html: 'FUNKDATION VOL.4 賽事播出系統<br>內建字型 Cinzel、Noto Serif TC 以 SIL Open Font License 授權。' })
    ]);
    fetch('/api/info').then(function (r) { return r.json(); }).then(function (i) {
      var el = document.getElementById('lan');
      if (el && i.addresses.length) el.textContent = 'OBS 在另一台電腦時（同一網路）可用：' + i.addresses.map(function (a) { return 'http://' + a + ':' + port + '/output/'; }).join('　') + '（只能顯示，不能操作）';
    }).catch(function () {});
    function loadBackups() {
      fetch('/api/backups').then(function (r) { return r.json(); }).then(function (r) {
        backups.innerHTML = '';
        if (!r.backups.length) { backups.textContent = '還沒有備份'; return; }
        add(backups, r.backups.slice(0, 20).map(function (n) {
          return h('div', { class: 'btnrow', style: 'align-items:center' }, h('span', { class: 'muted', text: n.replace(/^state-|\.json$/g, '').replace('_', ' ') }),
            h('button', { class: 'small', text: '還原到這個版本', onclick: function () {
              if (!confirm('還原到 ' + n + '？目前的狀態會先另存一份備份。')) return;
              fetch('/api/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) })
                .then(function (r) { return r.json(); }).then(function (r) { if (!r.ok) throw new Error(r.error); toast('已還原'); }).catch(fail);
            } }));
        }));
      }).catch(fail);
    }
    loadBackups();
    if (window.funk && window.funk.version) window.funk.version().then(function (v) { var el = document.getElementById('appver'); if (el) el.textContent = '目前版本 ' + v; });
    // 桌面版：輸出視窗控制
    if (window.funk) {
      window.funk.displays().then(function (list) {
        outBox.innerHTML = '';
        var dsel = sel(list.map(function (d) { return [String(d.id), d.label]; }), String((list.filter(function (d) { return !d.primary; })[0] || list[0] || {}).id), function () {});
        add(outBox, h('div', { class: 'card' },
          fld('顯示在', dsel),
          h('div', { class: 'btnrow' },
            h('button', { class: 'primary', text: '開啟輸出視窗（全螢幕）', onclick: function () { window.funk.openOutput(Number(dsel.value), true); } }),
            h('button', { text: '開啟輸出視窗（視窗模式）', onclick: function () { window.funk.openOutput(Number(dsel.value), false); } }),
            h('button', { text: '關閉輸出視窗', onclick: function () { window.funk.closeOutput(); } })),
          h('div', { class: 'hint', text: '接上投影機後，選擇投影機的螢幕再開啟。輸出視窗內按 Esc 可退出全螢幕，F 切換全螢幕。' }),
          h('div', { class: 'btnrow' }, h('button', { text: '打開資料夾', onclick: function () { window.funk.openDataFolder(); } }), h('span', { class: 'faint', text: window.funk.dataDir || '' }))));
      });
    } else {
      add(outBox, h('div', { class: 'card' },
        h('div', { class: 'btnrow' }, h('button', { class: 'primary', text: '在新分頁開啟輸出畫面', onclick: function () { window.open('/output/', 'fd-output'); } })),
        h('div', { class: 'hint', text: '把分頁拖到投影螢幕後按 F11 全螢幕。' })));
    }
  }

  // ---------------------------------------------------------------------------
  // Timer 顯示更新
  // ---------------------------------------------------------------------------
  function timerLoop() {
    var el = document.getElementById('timerbig');
    if (el && S) {
      var r = timerLeft(), s = Math.max(0, Math.ceil(r - 1e-6));
      el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      var run = !!S.show.timer.endsAt && r > 0;
      el.className = 'timerbig' + (run ? (s <= 10 ? ' warn' : ' run') : '');
    }
    requestAnimationFrame(timerLoop);
  }
  requestAnimationFrame(timerLoop);
  // Timer 歸零時更新按鈕文字
  setInterval(function () { if (S && ui.mode === 'show') liveUpdaters.forEach(function (f) { try { f(); } catch (e) { /* 忽略 */ } }); }, 500);

  window.addEventListener('beforeunload', flush);

  // 程式更新進度
  if (window.funk && window.funk.onUpdate) {
    window.funk.onUpdate(function (m) {
      var box = document.getElementById('updbox');
      if (!box) {
        box = h('div', { id: 'updbox', class: 'updbox' }, h('div', { class: 'ut' }), h('div', { class: 'ubar' }, h('div')), h('div', { class: 'us faint' }));
        document.body.appendChild(box);
      }
      var t = box.querySelector('.ut'), bar = box.querySelector('.ubar div'), sub = box.querySelector('.us');
      box.style.display = 'block';
      if (m.state === 'downloading') {
        t.textContent = '正在下載新版本' + (m.version ? ' ' + m.version : '') + '…';
        bar.style.width = Math.round((m.progress || 0) * 100) + '%';
        sub.textContent = m.total ? (m.got / 1048576).toFixed(0) + ' / ' + (m.total / 1048576).toFixed(0) + ' MB' : '';
      } else if (m.state === 'installing') {
        t.textContent = '下載完成，正在安裝…';
        bar.style.width = '100%';
        sub.textContent = '程式會自動關閉並重新開啟';
      } else if (m.state === 'error') {
        box.style.display = 'none';
      }
    });
  }
})();
