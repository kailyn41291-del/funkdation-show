/* FUNKDATION 共用連線函式庫（控制面板與輸出畫面都會載入）
 *
 *   const fd = FD.connect({
 *     onState(state, rev, reason) {},   // 每次狀態改變
 *     onStatus(status) {},              // 'connecting' | 'online' | 'offline'
 *     onSaved(savedRev) {}              // 伺服器寫入硬碟後
 *   });
 *   fd.set(['event','title'], '新標題');   // 修改單一欄位
 *   fd.send([{op:'set', path:[...], value}]);  // 一次送多個修改（全部成功才生效）
 *   fd.now();   // 與伺服器同步的時間（ms），Timer 請一律用這個
 */
(function (global) {
  'use strict';

  var FORBIDDEN = ['__proto__', 'constructor', 'prototype'];

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function getAt(root, p) {
    var n = root;
    for (var i = 0; i < p.length; i++) {
      if (n === undefined || n === null) return undefined;
      n = n[p[i]];
    }
    return n;
  }

  function parentOf(root, p, create) {
    var n = root;
    for (var i = 0; i < p.length - 1; i++) {
      var k = p[i];
      if (FORBIDDEN.indexOf(k) >= 0) throw new Error('bad key');
      if (n[k] === undefined || n[k] === null) {
        if (!create) throw new Error('missing path');
        n[k] = typeof p[i + 1] === 'number' ? [] : {};
      }
      n = n[k];
    }
    return n;
  }

  // 與伺服器 store.js 的 applyOne 行為一致
  function applyOne(s, op) {
    var p = op.path || [];
    var arr, last;
    switch (op.op) {
      case 'set':
        parentOf(s, p, true)[p[p.length - 1]] = clone(op.value);
        break;
      case 'delete':
        var par = parentOf(s, p, false);
        last = p[p.length - 1];
        if (Array.isArray(par)) par.splice(last, 1); else delete par[last];
        break;
      case 'push':
        arr = p.length ? getAt(s, p) : s;
        arr.push(clone(op.value));
        break;
      case 'insert':
        getAt(s, p).splice(op.index, 0, clone(op.value));
        break;
      case 'move':
        arr = getAt(s, p);
        var item = arr.splice(op.from, 1)[0];
        arr.splice(op.to, 0, item);
        break;
    }
  }

  function connect(opts) {
    opts = opts || {};
    var api = {
      state: null,
      rev: -1,
      savedRev: -1,
      status: 'connecting',
      offset: 0,
      get: function (p) { return getAt(api.state, p); },
      now: function () { return Date.now() + api.offset; },
      id: Math.random().toString(36).slice(2, 10),
      send: send,
      set: function (p, value, extra) { return send([{ op: 'set', path: p, value: value }], extra); },
      cmd: function (ops, extra) { return send(ops || [], extra); },
      upload: upload,
      assetUrl: function (p) { return p ? '/' + String(p).replace(/^\/+/, '') : ''; }
    };
    var ws = null, seq = 0, pending = {}, retry = 0, bestRtt = Infinity, closedByUser = false;
    var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

    function setStatus(s) {
      if (api.status === s) return;
      api.status = s;
      if (opts.onStatus) opts.onStatus(s);
    }

    function emit(reason, meta) {
      if (opts.onState) opts.onState(api.state, api.rev, reason, meta || null);
    }

    function syncTime() {
      bestRtt = Infinity;
      for (var i = 0; i < 4; i++) {
        setTimeout(function () {
          if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'time', t0: Date.now() }));
        }, i * 150);
      }
    }

    function open() {
      setStatus('connecting');
      ws = new WebSocket(wsUrl);
      ws.onopen = function () { retry = 0; syncTime(); };
      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'hello' || m.type === 'state') {
          api.state = m.state;
          api.rev = m.rev;
          if (m.savedRev !== undefined) api.savedRev = m.savedRev;
          if (m.serverTime && bestRtt === Infinity) api.offset = m.serverTime - Date.now();
          setStatus('online');
          emit(m.type);
        } else if (m.type === 'ops') {
          if (m.rev !== api.rev + 1) {
            ws.send(JSON.stringify({ type: 'resync' }));
            return;
          }
          try {
            for (var i = 0; i < m.ops.length; i++) applyOne(api.state, m.ops[i]);
            api.rev = m.rev;
            emit('ops', m.meta);
          } catch (e) {
            ws.send(JSON.stringify({ type: 'resync' }));
          }
        } else if (m.type === 'event') {
          if (opts.onEvent) opts.onEvent(m.event, m.origin);
        } else if (m.type === 'saved') {
          api.savedRev = m.rev;
          if (opts.onSaved) opts.onSaved(m.rev);
        } else if (m.type === 'ack' || m.type === 'nack') {
          var p = pending[m.id];
          if (p) {
            delete pending[m.id];
            if (m.type === 'ack') p.resolve(m.rev); else p.reject(new Error(m.error));
          }
        } else if (m.type === 'time') {
          var t1 = Date.now(), rtt = t1 - m.t0;
          if (rtt < bestRtt) {
            bestRtt = rtt;
            api.offset = m.serverTime + rtt / 2 - t1;
          }
        }
      };
      ws.onclose = function () {
        setStatus('offline');
        for (var id in pending) { pending[id].reject(new Error('連線中斷')); delete pending[id]; }
        if (closedByUser) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(open, Math.min(2000, 150 * retry));
      };
      ws.onerror = function () { /* onclose 會處理重連 */ };
    }

    // extra: { event: {name, ...}, quiet: true }
    function send(ops, extra) {
      extra = extra || {};
      return new Promise(function (resolve, reject) {
        if (!ws || ws.readyState !== 1) { reject(new Error('尚未連線到伺服器')); return; }
        var id = ++seq;
        pending[id] = { resolve: resolve, reject: reject };
        ws.send(JSON.stringify({ type: 'ops', id: id, ops: ops, origin: api.id, event: extra.event || null, quiet: !!extra.quiet }));
      });
    }

    function upload(file, onProgress) {
      return new Promise(function (resolve, reject) {
        var fdata = new FormData();
        fdata.append('file', file);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.upload.onprogress = function (e) { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = function () {
          var r;
          try { r = JSON.parse(xhr.responseText); } catch (e) { reject(new Error('上傳失敗')); return; }
          if (r.ok) resolve(r); else reject(new Error(r.error || '上傳失敗'));
        };
        xhr.onerror = function () { reject(new Error('上傳失敗，請確認伺服器仍在執行')); };
        xhr.send(fdata);
      });
    }

    api.close = function () { closedByUser = true; if (ws) ws.close(); };
    open();
    // 每 30 秒重新校正一次時間
    setInterval(function () { if (api.status === 'online') syncTime(); }, 30000);
    return api;
  }

  global.FD = { connect: connect, applyOne: applyOne, getAt: getAt };
})(window);
