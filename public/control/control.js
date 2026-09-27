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
  var ui = Object.assign({ page: 'flow', mode: 'edit', sel: null, tabs: {}, photoSide: 'L', team: 't1', guides: { safe: false, lines: false } },
    (function () { try { return JSON.parse(localStorage.getItem('fd-ui') || '{}'); } catch (e) { return {}; } })());
  function saveUi() { try { localStorage.setItem('fd-ui', JSON.stringify(ui)); } catch (e) { /* 忽略 */ } }

  var status = { conn: 'connecting', saved: true };
  var fd = FD.connect({
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
  var PAGES = [['flow', '流程'], ['teams', '隊伍'], ['sponsors', '贊助商'], ['assets', '素材與字型'], ['settings', '設定']];
  function renderHeader() {
    headerEl.innerHTML = '';
    add(headerEl, [
      h('div', { class: 'brand', text: 'FUNKDATION' }, h('small', { text: '控制台' })),
      h('nav', null, PAGES.map(function (p) {
        return h('button', { class: ui.page === p[0] ? 'on' : '', text: p[1], onclick: function () { ui.page = p[0]; saveUi(); renderHeader(); renderPage(false); } });
      })),
      ui.page === 'flow' ? h('div', { class: 'seg' },
        h('button', { class: ui.mode === 'edit' ? 'on' : '', text: '編排', onclick: function () { setMode('edit'); } }),
        h('button', { class: ui.mode === 'show' ? 'on' : '', text: '演出', onclick: function () { setMode('show'); } })) : null,
      h('div', { class: 'spacer' }),
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
  function renderPage(partial) {
    if (!S || !D) return;
    liveUpdaters = [];
    if (ui.page === 'flow') {
      if (!partial || !flowView || flowView.mode !== ui.mode) buildFlow();
      else { renderCueList(); renderInspector(); syncMonitors(); }
    } else {
      flowView = null;
      var y = mainEl.firstChild ? mainEl.firstChild.scrollTop : 0;
      mainEl.innerHTML = '';
      monitors = [];
      var page = h('div', { class: 'page' });
      mainEl.appendChild(page);
      ({ teams: pageTeams, sponsors: pageSponsors, assets: pageAssets, settings: pageSettings })[ui.page](page);
      page.scrollTop = y;
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
    } else {
      var nx = nextCue();
      flowView.liveMon = monitor('/output/?monitor=1', 'LIVE 播出中', 'live');
      flowView.nextMon = monitor('/output/?still=1&preview=' + encodeURIComponent(nx ? nx.id : ''), 'NEXT 下一個', 'next');
      flowView.nextId = nx ? nx.id : null;
      add(center, [flowView.liveMon.el, h('div', { class: 'monrow' }, h('div', { class: 'hint', html: shortcutHelp() }), flowView.nextMon.el)]);
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
      add(col, h('div', { class: 'gobox' },
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
    if (type === 'battle') Object.assign(c, { battle: 'semi1', name: '四強對戰 1', left: { source: 'top4', index: 0 }, right: { source: 'top4', index: 1 }, title: 'SEMI FINAL', zh: '四強賽', rounds: 4, seconds: 60, own: false });
    if (type === 'champ') Object.assign(c, { name: '冠亞軍公布', champ: { source: 'winner', battle: 'final' }, runner: { source: 'loser', battle: 'final' } });
    if (['idle', 'overview', 'top4', 'black'].indexOf(type) >= 0) c.name = FDM.TYPES[type];
    return c;
  }
  var addState = { type: 'team', team: 't1', after: true };
  function addBar() {
    var teamSel = sel(S.teams.map(function (t, i) { return [t.id, (i + 1) + '. ' + t.en]; }), addState.team, function (v) { addState.team = v; });
    teamSel.style.display = addState.type === 'team' ? '' : 'none';
    var typeSel = sel(Object.keys(FDM.TYPES).map(function (k) { return [k, FDM.TYPES[k]]; }), addState.type, function (v) {
      addState.type = v; teamSel.style.display = v === 'team' ? '' : 'none';
    });
    function insertAt() {
      if (ui.mode === 'show') return addState.after && S.show.cueId ? cueIndex(S.show.cueId) + 1 : S.cues.length;
      var i = cueIndex(ui.sel);
      return i >= 0 ? i + 1 : S.cues.length;
    }
    return h('div', { class: 'addbar' },
      h('div', { class: 'row' }, typeSel, teamSel),
      h('div', { class: 'row' },
        h('button', { class: 'primary', text: '＋ 新增 Cue', style: 'flex:1', onclick: function () {
          var a = clone(S.cues), c = newCue(addState.type, addState.team); a.splice(insertAt(), 0, c);
          if (ui.mode === 'edit') ui.sel = c.id;
          setCues(a); renderInspector();
        } }),
        h('button', { text: '產生 9 隊', title: '依隊伍順序一次新增所有單隊展示 Cue', onclick: function () {
          var a = clone(S.cues), at = insertAt();
          a.splice.apply(a, [at, 0].concat(S.teams.map(function (t) { return newCue('team', t.id); })));
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

  // ---------- 冠亞軍 ----------
  function champReveal(k) { cmd([set(['show', 'champView'], 'solo-' + k)], { name: 'champReveal', k: k }); }
  function champDuo() { cmd([set(['show', 'champView'], 'duo')], { name: 'champDuo' }); }
  function champView(v) { cmd([set(['show', 'champView'], v)]); }

  // ---------- 快捷鍵 ----------
  function shortcutHelp() {
    return '<b>快捷鍵</b>　<span class="kbd">空白</span> GO　<span class="kbd">B</span> 黑畫面<br>' +
      '單隊：<span class="kbd">X</span> 退場<br>' +
      '對戰：<span class="kbd">T</span> 計時開始／暫停　<span class="kbd">R</span> 重置　<span class="kbd">←</span><span class="kbd">→</span> 印章　<span class="kbd">↓</span> 印章淡出<br>' +
      '冠亞軍：<span class="kbd">1</span><span class="kbd">2</span><span class="kbd">3</span> 揭曉　<span class="kbd">Q</span><span class="kbd">W</span><span class="kbd">E</span> 直接切換　<span class="kbd">Esc</span> 回底圖';
  }
  document.addEventListener('keydown', function (e) {
    if (!S || ui.page !== 'flow' || ui.mode !== 'show') return;
    var tg = e.target.tagName;
    if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    var c = liveCue(), k = e.key.toLowerCase(), handled = true;
    if (e.code === 'Space') go();
    else if (k === 'b') toggleBlack();
    else if (c && c.type === 'team' && k === 'x') teamExit();
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
    liveUpdaters = [];
    insp.innerHTML = '';
    if (ui.mode === 'edit') editPanel(insp);
    else showPanel(insp);
    insp.scrollTop = y;
    if (ui.mode === 'edit') renderTestbar();
  }

  // ========== 演出控制 ==========
  function showPanel(insp) {
    var c = liveCue();
    if (!c) {
      add(insp, h('div', { class: 'live-head' }, h('h2', { text: '尚未開始播出' }), h('div', { class: 'muted', text: '按 GO 或空白鍵播出第一個 Cue，或在左側 Cue 上點兩下直接跳過去。' })));
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
    } else if (c.type === 'top4') top4Panel(pane);
    else if (c.type === 'battle') battlePanel(pane, c);
    else if (c.type === 'champ') champPanel(pane, c);
    else add(pane, [h('h3', { text: FDM.TYPES[c.type] }), h('div', { class: 'btnrow' }, h('button', { text: '重播登場', onclick: replay }))]);
  }

  function teamOptions(withEmpty) {
    var o = S.teams.map(function (t, i) { return [t.id, (i + 1) + '. ' + t.en + (t.seed ? '（種子）' : '')]; });
    return withEmpty ? [['', '（未選）']].concat(o) : o;
  }

  function top4Panel(pane) {
    var err = h('div', { class: 'err' });
    var picks = h('div');
    for (var i = 0; i < 4; i++) {
      (function (i) {
        var s = sel(teamOptions(true), S.results.top4[i] || '', function (v, el) {
          if (v && S.results.top4.indexOf(v) >= 0 && S.results.top4.indexOf(v) !== i) { err.textContent = '這隊已經選過了'; el.value = S.results.top4[i] || ''; return; }
          err.textContent = '';
          var a = clone(S.results.top4); a[i] = v || null; setPath(['results', 'top4'], a);
          renderCueList();
        });
        picks.appendChild(fld('第 ' + (i + 1) + ' 隊', s, i % 2 === 0 ? '對 ' + (i + 2) : ''));
      })(i);
    }
    var cnt = h('span', { class: 'muted' });
    onLive(function () { cnt.textContent = '已揭曉 ' + (S.show.top4Shown || 0) + ' / 4'; });
    add(pane, [h('h3', { text: '晉級隊伍（依揭曉順序）' }), picks, err,
      h('div', { class: 'hint', text: '第 1、2 隊為四強對戰 1，第 3、4 隊為四強對戰 2，後面的對戰 Cue 會自動帶入。' }),
      h('h3', { text: '揭曉' }), h('div', { class: 'btnrow' },
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
        h('div', { class: 'btns', style: 'margin-top:4px' }, h('button', { class: 'winbtn', 'data-side': k, text: '確認晉級', onclick: function () {
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
        wb.textContent = b.winner === k ? '已晉級（再按取消）' : '確認晉級';
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
    var champ = FDM.resolve(S, c.champ), runner = FDM.resolve(S, c.runner);
    var viewTx = h('span', { class: 'muted' });
    var NAMES = { none: '底圖', 'lead-c': '冠軍懸念文字', 'lead-r': '亞軍懸念文字', 'solo-c': '單獨冠軍', 'solo-r': '單獨亞軍', duo: '冠亞軍同框' };
    onLive(function () { viewTx.textContent = '目前：' + (NAMES[S.show.champView] || S.show.champView); });
    add(pane, [
      h('div', { class: 'card' },
        h('div', null, '冠軍：', h('b', { text: champ ? champ.en : '（未決定）' })),
        h('div', null, '亞軍：', h('b', { text: runner ? runner.en : '（未決定）' })),
        (!champ || !runner) ? h('div', { class: 'err', text: '請先在決賽按「確認晉級」，或在編排模式指定隊伍。' }) : null),
      h('h3', { text: '揭曉（含懸念文字）' }),
      h('div', { class: 'btnrow' },
        h('button', { class: 'primary', text: '1. 亞軍揭曉', onclick: function () { champReveal('r'); } }),
        h('button', { class: 'primary', text: '2. 冠軍揭曉', onclick: function () { champReveal('c'); } }),
        h('button', { class: 'primary', text: '3. 冠亞軍同框', onclick: champDuo })),
      h('h3', { text: '直接切換（拍得獎照用）' }),
      h('div', { class: 'btnrow' },
        h('button', { text: '單獨亞軍（Q）', onclick: function () { champView('solo-r'); } }),
        h('button', { text: '單獨冠軍（W）', onclick: function () { champView('solo-c'); } }),
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
      if (c.type === 'top4') btns = [['自動揭曉', { name: 'top4auto' }], ['重置', { name: 'top4reset' }]];
      if (c.type === 'battle') btns = [['登場', { name: 'entrance' }], ['左方印章', { name: 'seal', side: 'l' }], ['右方印章', { name: 'seal', side: 'r' }], ['印章淡出', { name: 'sealFade' }], ['最後 10 秒', { name: 'testTimer' }], ['比分變化', { name: 'testScore' }]];
      if (c.type === 'champ') btns = [['亞軍揭曉', { name: 'champReveal', k: 'r' }], ['冠軍揭曉', { name: 'champReveal', k: 'c' }], ['同框揭曉', { name: 'champDuo' }], null,
        ['懸念文字', { name: 'champView', view: 'lead-c' }], ['單獨亞軍', { name: 'champView', view: 'solo-r' }], ['單獨冠軍', { name: 'champView', view: 'solo-c' }], ['同框', { name: 'champView', view: 'duo' }]];
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
    top4: [['basic', '基本'], ['layout', '版面'], ['anim', '動畫']],
    battle: [['basic', '基本'], ['photo', '照片'], ['layout', '版面'], ['anim', '動畫'], ['seal', '印章與計時']],
    champ: [['basic', '基本'], ['text', '內容'], ['layout', '版面'], ['anim', '動畫']],
    idle: [['basic', '基本']], overview: [['basic', '基本']], black: [['basic', '基本']]
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
      top4: { basic: top4Basic, layout: top4Layout, anim: top4Anim },
      battle: { basic: battleBasic, photo: battlePhoto, layout: battleLayout, anim: battleAnim, seal: battleSeal },
      champ: { basic: champBasic, text: champText, layout: champLayout, anim: champAnim },
      idle: { basic: idleBasic }, overview: { basic: plainBasic }, black: { basic: blackBasic }
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

  function sourceSelect(value, onchange) {
    var opts = [
      { group: '指定隊伍', items: S.teams.map(function (t, i) { return ['team:' + t.id, (i + 1) + '. ' + t.en + (t.seed ? '（種子）' : '')]; }) },
      { group: '自動帶入', items: [['top4:0', '四強第 1 隊'], ['top4:1', '四強第 2 隊'], ['top4:2', '四強第 3 隊'], ['top4:3', '四強第 4 隊'],
        ['winner:semi1', '四強對戰 1 勝方'], ['winner:semi2', '四強對戰 2 勝方'], ['winner:final', '決賽勝方'],
        ['loser:semi1', '四強對戰 1 敗方'], ['loser:semi2', '四強對戰 2 敗方'], ['loser:final', '決賽敗方']] }
    ];
    var enc = value ? (value.source === 'team' ? 'team:' + value.team : value.source === 'top4' ? 'top4:' + value.index : value.source + ':' + value.battle) : '';
    return sel(opts, enc, function (v) {
      var p = v.split(':'), o;
      if (p[0] === 'team') o = { source: 'team', team: p[1] };
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
    add(pane, h('div', { class: 'hint', text: '照片設定存在隊伍資料上，單隊展示、四強、對戰、冠亞軍都會沿用。' }));
  }
  function photoEditor(pane, t, redraw) {
    var ti = S.teams.indexOf(t), pp = ['teams', ti, 'photo'];
    var ph = t.photo;
    add(pane, [h('h3', { text: t.en + ' 的照片' }),
      h('div', { class: 'btnrow', style: 'align-items:center' },
        ph.src ? h('img', { class: 'thumb', src: '/' + (ph.trim || ph.src), alt: '' }) : null,
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
      ph.fit === 'auto' && ph.src && !ph.trim ? h('div', { class: 'hint', text: '這張照片沒有透明背景，自動 Fit 會以完整顯示處理。' }) : null]);
  }

  // ---------- 四強 ----------
  function top4Basic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '排列方式' }),
      fld('模式', selPath(lp.concat('mode'), [['step', '逐組揭曉（兩隊出現後拉開、VS 落下）'], ['pair', '對戰組合（直接兩兩一組）'], ['row', '一排四隊']])),
      h('div', { class: 'hint', text: '晉級隊伍在演出模式選擇：第 1、2 隊一組，第 3、4 隊一組。' })]);
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
      fld('場次', sel([['semi1', '四強對戰 1'], ['semi2', '四強對戰 2'], ['final', '決賽']], c.battle, function (v) {
        var m = { semi1: ['SEMI FINAL', '四強賽', 4, { source: 'top4', index: 0 }, { source: 'top4', index: 1 }, '四強對戰 1'],
          semi2: ['SEMI FINAL', '四強賽', 4, { source: 'top4', index: 2 }, { source: 'top4', index: 3 }, '四強對戰 2'],
          final: ['FINAL', '決賽', 5, { source: 'winner', battle: 'semi1' }, { source: 'winner', battle: 'semi2' }, '決賽'] }[v];
        var n = Object.assign(clone(c), { battle: v, title: m[0], zh: m[1], rounds: m[2], left: m[3], right: m[4], name: m[5] });
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
    animEditor(pane, lp.concat('anim'), 'battle', [['fr', '外框'], ['ph', '照片'], ['nm', '隊名'], ['info', '標題、比分、Timer']]);
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

  // ---------- 冠亞軍 ----------
  function champBasic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '隊伍' }),
      fld('冠軍', sourceSelect(c.champ, function (o) { setPath(cp.concat('champ'), o); renderCueList(); })),
      fld('亞軍', sourceSelect(c.runner, function (o) { setPath(cp.concat('runner'), o); })),
      h('div', { class: 'hint', text: '預設自動帶入決賽的勝方與敗方（在決賽按「確認晉級」後決定）。' })]);
    bgEditor(pane, lp.concat('bg'));
  }
  function champText(pane, c, cp, lp) {
    var t = lp.concat('text');
    add(pane, [h('h3', { text: '冠軍' }),
      fld('懸念英文', txtPath(t.concat('lc'))), fld('懸念中文', txtPath(t.concat('lcz'))), fld('稱號', txtPath(t.concat('tc'))), fld('中文', txtPath(t.concat('cz'))),
      h('h3', { text: '亞軍' }),
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
      sl(v.concat('cw'), '冠軍照片寬度', 200, 1100), sl(v.concat('rw'), '亞軍照片寬度', 200, 1100), sl(v.concat('gap'), '兩隊間距', -200, 800), sl(v.concat('dy'), '垂直位置', -200, 900),
      sl(v.concat('cTs'), '冠軍稱號字級', 12, 200), sl(v.concat('cNs'), '冠軍隊名字級', 12, 200), sl(v.concat('rTs'), '亞軍稱號字級', 12, 200), sl(v.concat('rNs'), '亞軍隊名字級', 12, 200),
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
      fld('同框順序', selPath(lp.concat('duoOrder'), [['rc', '亞軍先、冠軍後'], ['cr', '冠軍先、亞軍後'], ['same', '兩隊同時']])),
      sl(lp.concat('stg'), '兩隊間隔 ms', 0, 5000, { step: 50 })]);
  }

  function idleBasic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('h3', { text: '贊助商跑馬燈' }),
      fld('跑馬燈', chk('在主視覺上顯示贊助商跑馬燈', lp.concat('marquee'))),
      h('div', { class: 'btnrow' }, h('button', { text: '編輯贊助商 Logo →', onclick: function () { ui.page = 'sponsors'; saveUi(); renderHeader(); renderPage(false); } }))]);
    bgEditor(pane, lp.concat('bg'));
  }
  function plainBasic(pane, c, cp, lp) {
    add(pane, [nameField(cp), h('div', { class: 'hint', text: '九隊總覽的動態由你自行製作，請把影片設為底圖。' })]);
    bgEditor(pane, lp.concat('bg'));
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
    var right = h('div', { class: 'sticky' }, mon.el, h('div', { class: 'card' }, t ? h('div', { id: 'photoEd' }) : null));
    if (t) photoEditor(right.querySelector('#photoEd'), t, function () { renderPage(true); });
    var table = h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['#', '照片', '英文隊名', '中文隊名', '標籤（城市）', '種子', ''].map(function (x) { return h('th', { text: x }); }))),
      h('tbody', null, S.teams.map(function (tm, i) {
        var tr = h('tr', { class: tm.id === ui.team ? 'sel' : '', onclick: function (e) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
          ui.team = tm.id; saveUi(); renderPage(false);
        } },
        h('td', { class: 'faint', text: i + 1 }),
        h('td', null, tm.photo.src ? h('img', { class: 'thumb', src: '/' + (tm.photo.trim || tm.photo.src), alt: '' }) : h('span', { class: 'faint', text: '未上傳' })),
        h('td', null, txtPath(['teams', i, 'en'], 'TEAM NAME')),
        h('td', null, txtPath(['teams', i, 'zh'], '選填')),
        h('td', null, txtPath(['teams', i, 'tag'], '選填')),
        h('td', null, (function () { var c = h('input', { type: 'checkbox', checked: !!tm.seed }); c.addEventListener('change', function () { setPath(['teams', i, 'seed'], c.checked); }); return c; })()),
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
        h('div', { class: 'hint', text: '點一列可在右側調整這隊的照片。順序只影響「產生 9 隊」；實際出場順序以 Cue 表為準。' }),
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
  function moveTeam(i, d) { var j = i + d; if (j < 0 || j >= S.teams.length) return; var a = clone(S.teams); var t = a[i]; a[i] = a[j]; a[j] = t; setPath(['teams'], a); renderPage(false); }

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
      if (el && i.addresses.length) el.textContent = '同一網路的平板或手機可開：' + i.addresses.map(function (a) { return 'http://' + a + ':' + port + '/control/'; }).join('　');
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
