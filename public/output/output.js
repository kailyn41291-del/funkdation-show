/* FUNKDATION 輸出畫面
 * 網址參數：
 *   (無)                 正式輸出：跟著控制面板播出中的 Cue
 *   ?monitor=1           控制面板裡的監看畫面（靜音）
 *   ?preview=<cueId>     預覽某個 Cue（編排模式），不受演出指令影響
 *   ?preview=__team:<id> 預覽某隊的單隊展示（隊伍頁）
 *   ?preview=__idle      預覽主視覺待機（贊助商頁）
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var PREVIEW = params.get('preview');
  var IS_PREVIEW_FRAME = !!PREVIEW;
  var MONITOR = params.get('monitor') === '1' || !!PREVIEW;
  var STILL = params.get('still') === '1'; // 只顯示影片第一格（NEXT 監看畫面，省效能）
  if (MONITOR) document.body.classList.add('monitor');

  var W = 1920, H = 1080;
  var stage = document.getElementById('stage');
  var scenesEl = document.getElementById('scenes');
  var vig = document.getElementById('vig');
  var guides = document.getElementById('guides');
  FX.setShakeTarget(document.getElementById('shake'));

  // ---------- 縮放到視窗大小 ----------
  function fit() {
    var k = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = 'translate(' + ((innerWidth - W * k) / 2) + 'px,' + ((innerHeight - H * k) / 2) + 'px) scale(' + k + ')';
  }
  addEventListener('resize', fit);
  fit();

  // ---------- OBS 尺寸檢查 ----------
  // OBS 瀏覽器來源預設 800×600，會先畫小再放大成 1920×1080，整個畫面變糊。
  // 在 OBS 裡偵測到尺寸不足時，角落顯示提醒（尺寸改對就自動消失）。
  var obsWarn = null;
  function checkObs() {
    if (!window.obsstudio || MONITOR) return;
    var dpr = window.devicePixelRatio || 1;
    var rw = Math.round(innerWidth * dpr), rh = Math.round(innerHeight * dpr);
    var bad = rw < W - 2 || rh < H - 2;
    if (bad && !obsWarn) {
      obsWarn = mk('div', 'obswarn', document.body);
    }
    if (obsWarn) {
      obsWarn.style.display = bad ? '' : 'none';
      obsWarn.innerHTML = '<b class="h">畫質不足：OBS 來源尺寸 ' + rw + '×' + rh + '</b>' +
        '在 OBS 對這個瀏覽器來源按右鍵 →「屬性」，把<b>寬度設 1920、高度設 1080</b>，畫面才會清楚。<br>改好後這個提醒會自動消失。';
    }
  }
  addEventListener('resize', checkObs);
  setTimeout(checkObs, 0);

  // ---------- 小工具 ----------
  function mk(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function px(el, props) { for (var k in props) el.style[k] = typeof props[k] === 'number' ? props[k] + 'px' : props[k]; }
  function asset(p) { return p ? (/^(data:|https?:|\/)/.test(p) ? p : '/' + p) : ''; }

  // 文字：外層定位、內層做動畫
  function Txt(parent, cls) {
    var wrap = mk('div', 'txt ' + cls, parent);
    var t = mk('span', 't', wrap);
    return {
      wrap: wrap, t: t,
      text: function (s) { if (t.textContent !== s) t.textContent = s; },
      // maxW：文字超過這個寬度時自動縮小字級（長隊名不會撞到隔壁）
      at: function (x, y, size, maxW) {
        px(wrap, { left: x, top: y, fontSize: size });
        if (maxW > 0 && t.textContent) {
          var w = t.offsetWidth;
          if (w > maxW) wrap.style.fontSize = (size * maxW / w).toFixed(2) + 'px';
        }
        return parseFloat(wrap.style.fontSize) || size;
      }
    };
  }

  // 同一組文字用同一個字級：先用設定字級量寬度，取最需要縮小的比例套用到全部
  // items: [{ txt, x, y, maxW }]，回傳實際字級
  function fitGroup(items, size) {
    var key = [size, lookSig].concat(items.map(function (it) { return it.txt.t.textContent + '|' + Math.round(it.maxW); })).join('\n');
    var memo = items[0] && items[0].txt;
    if (memo && memo._fitKey === key) {
      items.forEach(function (it) { px(it.txt.wrap, { left: it.x, top: it.y, fontSize: memo._fitSize }); });
      return memo._fitSize;
    }
    var k = 1;
    items.forEach(function (it) {
      px(it.txt.wrap, { fontSize: size });
      var w = it.txt.t.offsetWidth;
      if (it.txt.t.textContent && it.maxW > 0 && w > it.maxW) k = Math.min(k, it.maxW / w);
    });
    var fs = +(size * k).toFixed(2);
    items.forEach(function (it) { px(it.txt.wrap, { left: it.x, top: it.y, fontSize: fs }); });
    if (memo) { memo._fitKey = key; memo._fitSize = fs; }
    return fs;
  }

  var FRAME_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 520" preserveAspectRatio="none">' +
    '<rect x="7" y="7" width="766" height="506" fill="none" stroke="#140707" stroke-width="14"/>' +
    '<rect x="28" y="28" width="724" height="464" fill="none" stroke="#140707" stroke-width="3"/>' +
    '<rect width="44" height="44" fill="#140707"/><rect x="736" width="44" height="44" fill="#140707"/>' +
    '<rect y="476" width="44" height="44" fill="#140707"/><rect x="736" y="476" width="44" height="44" fill="#140707"/></svg>');

  var PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1560" height="1040" viewBox="0 0 780 520">' +
    (function () {
      var s = '';
      for (var i = 0; i < 7; i++) {
        var x = 150 + i * 80, y = 190 + (i % 2) * 14;
        s += '<circle cx="' + x + '" cy="' + y + '" r="30" fill="#2a0d0c"/><rect x="' + (x - 38) + '" y="' + (y + 34) + '" width="76" height="300" rx="34" fill="#2a0d0c"/>';
      }
      return s;
    })() + '</svg>');

  // 隊伍照片＋外框
  function PhotoBox(parent) {
    var root = mk('div', 'pbox', parent);
    var ph = mk('div', 'ph', root);
    var img = mk('img', '', ph);
    img.alt = '';
    img.draggable = false;
    var fr = mk('img', 'fr', root);
    fr.alt = '';
    fr.draggable = false;
    return {
      root: root, ph: ph, fr: fr, img: img,
      set: function (team, x, y, w, h, pad, placeholder) {
        px(root, { left: x, top: y, width: w, height: h });
        var k = w / 840;
        var p = pad * k;
        px(ph, { left: p, top: p, width: w - 2 * p, height: h - 2 * p });
        var fu = asset(S.frame) || FRAME_SVG;
        if (fr.getAttribute('src') !== fu) fr.src = fu;
        var photo = team && team.photo;
        var src = photo ? (photo.fit === 'auto' && photo.trim ? photo.trim : photo.src) : null;
        src = src ? asset(src) : (placeholder ? PLACEHOLDER : '');
        if (src) {
          if (img.getAttribute('src') !== src) img.src = src;
          img.style.display = '';
        } else {
          img.removeAttribute('src');
          img.style.display = 'none';
        }
        var fitMode = photo ? photo.fit : 'contain';
        img.style.objectFit = fitMode === 'cover' ? 'cover' : 'contain';
        ph.classList.toggle('free', !!(photo && photo.free));
        var zoom = photo ? photo.zoom : 100, ox = photo ? photo.x * k : 0, oy = photo ? photo.y * k : 0;
        img.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + zoom / 100 + ')';
      }
    };
  }

  // ---------- 狀態 ----------
  var S = null;           // 目前狀態
  var current = null;     // { key, cueId, seq, scene }
  var effectsOn = true;
  var previewView = 'solo-c';

  function findCue(id) {
    if (!S || !id) return null;
    if (id.indexOf('__team:') === 0) return { id: id, type: 'team', team: id.slice(7) };
    if (id.indexOf('__judge:') === 0) return { id: id, type: 'judge', judge: id.slice(8) };
    if (id === '__idle') return { id: id, type: 'idle' };
    for (var i = 0; i < S.cues.length; i++) if (S.cues[i].id === id) return S.cues[i];
    return null;
  }

  function targetCue() {
    if (PREVIEW) return findCue(PREVIEW);
    if (S.show.blackout) return { id: '__black', type: 'black' };
    return findCue(S.show.cueId) || null;
  }

  function ctxFor(cue) {
    return { state: S, cue: cue, layout: cue ? FDM.layoutFor(S, cue) : {}, preview: !!PREVIEW, effects: effectsOn };
  }

  // ---------- 字型與全域外觀 ----------
  var fontStyle = mk('style', '', document.head);
  var appliedFonts = '';
  var lookSig = '';
  function applyLook() {
    var ev = S.event;
    effectsOn = ev.effectsEnabled !== false;
    var ls = [ev.ink, ev.light, ev.fontEn, ev.fontZh, ev.grain, JSON.stringify(ev.fonts || [])].join('|');
    if (ls === lookSig) return;
    lookSig = ls;
    var sig = JSON.stringify(ev.fonts || []);
    if (sig !== appliedFonts) {
      appliedFonts = sig;
      fontStyle.textContent = (ev.fonts || []).map(function (f) {
        return "@font-face{font-family:'" + f.name.replace(/'/g, '') + "';src:url('" + asset(f.url) + "');font-display:block;}";
      }).join('\n') + '\n.grain .t:not(.nomask),.grain .gm{-webkit-mask-image:url(' + FX.noiseTexture('grain') + ');mask-image:url(' + FX.noiseTexture('grain') + ');}';
    }
    stage.style.setProperty('--ink', ev.ink || '#140707');
    stage.style.setProperty('--light', ev.light || '#ece0c8');
    stage.style.setProperty('--fen', "'" + (ev.fontEn || 'Cinzel') + "', '" + (ev.fontZh || 'Noto Serif TC') + "', serif");
    stage.style.setProperty('--fzh', "'" + (ev.fontZh || 'Noto Serif TC') + "', serif");
    stage.classList.toggle('grain', !!ev.grain);
    effectsOn = ev.effectsEnabled !== false;
  }

  // ---------- 底圖（兩層交替淡入） ----------
  var bgLayers = [document.getElementById('bgA'), document.getElementById('bgB')];
  var bgFront = 0, bgSig = null;
  function bgSignature(bg) { return bg ? [bg.mode, bg.src, bg.color, bg.texture ? 1 : 0].join('|') : 'none'; }
  function applyBg(bg, instant) {
    bg = bg || { mode: 'color', color: '#000' };
    var sig = bgSignature(bg);
    document.body.classList.toggle('transparent', bg.mode === 'transparent');
    var front = bgLayers[bgFront];
    var v = front.querySelector('video');
    if (sig === bgSig) {
      if (v && bg.mode === 'video') v.muted = MONITOR || !bg.sound;
      return;
    }
    bgSig = sig;
    bgFront = 1 - bgFront;
    var layer = bgLayers[bgFront], old = front;
    var video = layer.querySelector('video');
    var tex = layer.querySelector('.tex') || mk('div', 'tex', layer);
    layer.style.backgroundColor = '';
    layer.style.backgroundImage = '';
    tex.style.display = 'none';
    if (bg.mode === 'video' && bg.src) {
      video.style.display = 'block';
      if (video.getAttribute('src') !== asset(bg.src)) video.src = asset(bg.src);
      video.muted = MONITOR || !bg.sound;
      if (STILL) { video.pause(); video.currentTime = 0.1; }
      else video.play().catch(function () { video.muted = true; video.play().catch(function () {}); });
    } else {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.style.display = 'none';
      if (bg.mode === 'image' && bg.src) layer.style.backgroundImage = 'url("' + asset(bg.src) + '")';
      else if (bg.mode === 'transparent') layer.style.backgroundColor = 'transparent';
      else {
        layer.style.backgroundColor = bg.color || '#8b2420';
        if (bg.texture !== false && bg.mode !== 'black') {
          tex.style.display = 'block';
          tex.style.backgroundImage = 'url(' + FX.noiseTexture('paper') + ')';
        }
      }
    }
    layer.style.transition = instant ? 'none' : '';
    old.style.transition = instant ? 'none' : '';
    layer.classList.add('on');
    old.classList.remove('on');
    var ov = old.querySelector('video');
    setTimeout(function () { if (!old.classList.contains('on')) { ov.pause(); } }, 600);
  }

  // =====================================================================
  //  場景
  // =====================================================================
  var SCENES = {};

  function baseScene(ctx) {
    var root = mk('div', 'scene', scenesEl);
    return {
      root: root, ctx: ctx, tl: new FX.Timeline(),
      restart: function () { this.tl.kill(); this.tl = new FX.Timeline(); return this.tl; },
      exit: function (done) {
        var r = this.root, tl = this.restart();
        if (!effectsOn) { done(); return; }
        r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: FX.CSS_EASE, fill: 'forwards' });
        tl.at(360, done);
      },
      destroy: function () { this.tl.kill(); if (this.loop) cancelAnimationFrame(this.loop); this.root.remove(); },
      update: function () {}, enter: function () {}, showStatic: function () {}, event: function () {}
    };
  }

  // ---------- 主視覺待機：贊助商跑馬燈 ----------
  SCENES.idle = function (ctx) {
    var sc = baseScene(ctx);
    var band = mk('div', 'band', sc.root);
    var track = mk('div', 'track', band);
    var sig = null, half = 0, off = 0, last = performance.now();
    function measure() { half = track.scrollWidth / 3; }
    function build() {
      var sp = S.sponsors;
      var s = JSON.stringify([sp.logos, sp.height, sp.gap, sp.color]);
      if (s === sig) return;
      sig = s;
      track.innerHTML = '';
      var filt = sp.color === 'black' ? 'brightness(0)' : sp.color === 'cream' ? 'brightness(0) invert(0.9) sepia(0.25)' : 'none';
      for (var r = 0; r < 3; r++) {
        sp.logos.forEach(function (l) {
          var im = mk('img', '', track);
          im.src = asset(l.src);
          im.alt = '';
          im.style.height = (sp.height * (l.scale || 100) / 100) + 'px';
          im.style.marginRight = sp.gap + 'px';
          im.style.filter = filt;
          im.onload = measure;
        });
      }
      requestAnimationFrame(measure);
    }
    sc.update = function (c) {
      sc.ctx = c;
      var sp = S.sponsors, show = c.layout.marquee !== false && sp.logos.length > 0;
      band.style.display = show ? 'flex' : 'none';
      var bh = sp.height * 1.7;
      px(band, { height: bh, top: sp.y - bh / 2 });
      band.style.background = sp.band === 'dark' ? 'rgba(20,7,7,.85)' : sp.band === 'cream' ? 'rgba(236,224,200,.92)' : 'transparent';
      build();
    };
    function tick(t) {
      var dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (half > 0) {
        off += (S.sponsors.direction || -1) * S.sponsors.speed * dt;
        if (off <= -half) off += half;
        if (off > 0) off -= half;
        track.style.transform = 'translate3d(' + off.toFixed(2) + 'px,0,0)';
      }
      sc.loop = requestAnimationFrame(tick);
    }
    sc.loop = requestAnimationFrame(tick);
    sc.showStatic = function () { FX.show(band); };
    sc.enter = function () { FX.run(band, effectsOn ? 'fade' : 'none', 600, sc.tl); };
    sc.update(ctx);
    return sc;
  };

  SCENES.overview = function (ctx) { return baseScene(ctx); };
  SCENES.black = function (ctx) { return baseScene(ctx); };

  // ---------- 單隊展示 ----------
  SCENES.team = function (ctx) {
    var sc = baseScene(ctx);
    var box = PhotoBox(sc.root);
    var en = Txt(sc.root, 'en'), zh = Txt(sc.root, 'zh');
    en.t.classList.add('ls-name');
    zh.t.classList.add('ls-zh');
    var EL = { fr: box.fr, ph: box.ph, en: en.t, zh: zh.t };
    var ORDER = ['fr', 'ph', 'en', 'zh'];
    var visible = true;
    function team() { return FDM.teamById(S, sc.ctx.cue.team); }
    sc.update = function (c) {
      sc.ctx = c;
      var v = c.layout.v, t = team();
      var w = v.pw, h = Math.round(w * 2 / 3), x = (W - w) / 2 + v.px, y = v.pt, cx = W / 2 + v.px;
      box.set(t, x, y, w, h, v.pad, c.preview && !t);
      en.text(t ? t.en : (c.preview ? '（未選隊伍）' : ''));
      zh.text(FDM.line2(S, t));
      var es = en.at(cx, y + h + v.ng, v.es, W - 160);
      zh.at(cx, y + h + v.ng + es + v.lg, v.zs, W - 160);
      if (!c.preview) {
        var out = !!S.show.teamOut;
        if (out && visible) { ORDER.forEach(function (k) { FX.hide(EL[k]); }); visible = false; }
      }
    };
    sc.showStatic = function () {
      var out = !sc.ctx.preview && S.show.teamOut;
      ORDER.forEach(function (k) { if (out) FX.hide(EL[k]); else FX.show(EL[k]); });
      visible = !out;
    };
    sc.enter = function () {
      var tl = sc.restart();
      ORDER.forEach(function (k) { FX.hide(EL[k]); });
      visible = true;
      var a = FDM.chain(ORDER, sc.ctx.layout.anim, 0, effectsOn);
      ORDER.forEach(function (k) { tl.at(a[k].start, function () { FX.run(EL[k], a[k].fx, a[k].dur, tl); }); });
    };
    function exitAnim(done) {
      var tl = sc.restart();
      if (!visible) { done(); return; }
      visible = false;
      var anim = sc.ctx.layout.anim;
      var rev = ORDER.slice().reverse();
      var a = FDM.chain(rev, anim, 0, effectsOn);
      rev.forEach(function (k) {
        tl.at(a[k].start, function () { FX.out(EL[k], FX.reverseOf(anim.steps[k].fx), a[k].dur, tl); });
      });
      tl.at(a._end + 30, done);
    }
    sc.exit = exitAnim;
    sc.event = function (ev) {
      if (ev.name === 'entrance') sc.enter();
      else if (ev.name === 'teamExit') exitAnim(function () {});
    };
    sc.update(ctx);
    return sc;
  };

  // ---------- 評審表演 ----------
  // 流程：懸念文字（NEXT JUDGE IS...）→ 淡出 → 外框、照片、名字、第二行、稱號依序出場；X 退場
  function ratioOf(L) {
    var r = String(L.ratio || '3:2').split(':');
    return (Number(r[1]) || 2) / (Number(r[0]) || 3);
  }
  SCENES.judge = function (ctx) {
    var sc = baseScene(ctx);
    function T(cls, ls) { var x = Txt(sc.root, cls); x.t.classList.add(ls); return x; }
    var leadA = T('en', 'ls-lead'), leadB = T('zh', 'ls-zh');
    var tt = T('en', 'ls-title');
    var box = PhotoBox(sc.root);
    var en = T('en', 'ls-name'), zh = T('zh', 'ls-zh');
    var EL = { fr: box.fr, ph: box.ph, en: en.t, zh: zh.t, tt: tt.t };
    var ORDER = ['fr', 'ph', 'en', 'zh', 'tt'];
    var LEAD = [leadA.t, leadB.t];
    var visible = true;
    function judge() {
      var j = FDM.judgeById(S, sc.ctx.cue.judge);
      if (!j && sc.ctx.preview) j = { en: '（未選評審）', photo: null, _ph: true };
      return j;
    }
    sc.update = function (c) {
      sc.ctx = c;
      var L = c.layout, v = L.v, tx = L.text || {}, j = judge();
      leadA.text(tx.lead || '');
      leadB.text(tx.leadZh || '');
      var ls = leadA.at(W / 2, v.lY, v.lEs, W - 160);
      leadB.at(W / 2, v.lY + ls + v.lG, v.lZs, W - 160);
      var w = v.pw, h = Math.round(w * ratioOf(L)), x = (W - w) / 2 + v.px, y = v.pt, cx = W / 2 + v.px;
      box.set(j, x, y, w, h, v.pad, c.preview && (!j || j._ph));
      tt.text(tx.title || '');
      tt.at(cx, y - v.tG - v.tS, v.tS, W - 160);
      en.text(j ? j.en : '');
      zh.text(j ? (j.zh || j.tag || '') : '');
      var es = en.at(cx, y + h + v.ng, v.es, W - 160);
      zh.at(cx, y + h + v.ng + es + v.lg, v.zs, W - 160);
      if (!c.preview && S.show.teamOut && visible) { hideAll(); visible = false; }
    };
    function hideAll() { ORDER.forEach(function (k) { FX.hide(EL[k]); }); LEAD.forEach(FX.hide); }
    sc.showStatic = function () {
      var out = !sc.ctx.preview && S.show.teamOut;
      LEAD.forEach(FX.hide);
      ORDER.forEach(function (k) { if (out) FX.hide(EL[k]); else FX.show(EL[k]); });
      visible = !out;
    };
    function reveal(withLead) {
      var tl = sc.restart(), L = sc.ctx.layout, tx = L.text || {};
      hideAll();
      visible = true;
      var base = 0;
      if (withLead && L.intro !== false && (tx.lead || tx.leadZh)) {
        var A = FDM.chain(['lt', 'lz'], L.anim, 0, effectsOn);
        tl.at(A.lt.start, function () { FX.run(leadA.t, A.lt.fx, A.lt.dur, tl); });
        tl.at(A.lz.start, function () { FX.run(leadB.t, A.lz.fx, A.lz.dur, tl); });
        var d = effectsOn ? L.anim.duration : 0;
        var outS = A._end + (effectsOn ? L.pause : 0);
        tl.at(outS, function () { LEAD.forEach(function (el) { FX.out(el, L.leadOut, d, tl); }); });
        base = L.leadOut === 'none' ? outS : outS + d * (L.anim.overlap / 100);
      }
      var a = FDM.chain(ORDER, L.anim, base, effectsOn);
      ORDER.forEach(function (k) { tl.at(a[k].start, function () { FX.run(EL[k], a[k].fx, a[k].dur, tl); }); });
    }
    function exitAnim(done) {
      var tl = sc.restart();
      if (!visible) { done(); return; }
      visible = false;
      var anim = sc.ctx.layout.anim;
      LEAD.forEach(function (el) { FX.out(el, 'fade', effectsOn ? 300 : 0, tl); });
      var rev = ORDER.slice().reverse();
      var a = FDM.chain(rev, anim, 0, effectsOn);
      rev.forEach(function (k) {
        tl.at(a[k].start, function () { FX.out(EL[k], FX.reverseOf(anim.steps[k].fx), a[k].dur, tl); });
      });
      tl.at(a._end + 30, done);
    }
    sc.enter = function () { reveal(true); };
    sc.exit = exitAnim;
    sc.event = function (ev) {
      if (ev.name === 'entrance') reveal(true);
      else if (ev.name === 'judgeDirect') reveal(false);
      else if (ev.name === 'teamExit') exitAnim(function () {});
    };
    sc.update(ctx);
    return sc;
  };

  // ---------- 四強公布 ----------
  SCENES.top4 = function (ctx) {
    var sc = baseScene(ctx);
    var slots = [], vs = [];
    for (var i = 0; i < 4; i++) {
      var s = mk('div', 'slot', sc.root);
      var b = PhotoBox(s);
      var en = Txt(s, 'en'), zh = Txt(s, 'zh');
      en.t.classList.add('ls-name');
      zh.t.classList.add('ls-zh');
      slots.push({ el: s, box: b, en: en, zh: zh, EL: { fr: b.fr, ph: b.ph, en: en.t, zh: zh.t } });
    }
    for (var j = 0; j < 2; j++) { var e = mk('div', 'vs', sc.root); e.textContent = 'VS'; vs.push(e); }
    var ORDER = ['fr', 'ph', 'en', 'zh'];
    var open = [false, false], shown = 0;
    function mode() { return sc.ctx.layout.mode || 'step'; }
    function teamAt(i) {
      var t = FDM.teamById(S, S.results.top4[i]);
      if (!t && sc.ctx.preview) {
        var others = S.teams.filter(function (x) { return S.results.top4.indexOf(x.id) < 0; });
        t = others[i] || null;
      }
      return t;
    }
    function positions() {
      var v = sc.ctx.layout.v, w = v.w, m = mode(), xs = [], vsx = [0, 0], close = Math.max(12, v.close);
      if (m === 'row') {
        var tot = 4 * w + 3 * close, x0 = (W - tot) / 2;
        for (var i = 0; i < 4; i++) xs.push(x0 + i * (w + close));
      } else {
        var pw = 2 * w + v.vsg, pc = [W / 2 - (pw + v.pg) / 2, W / 2 + (pw + v.pg) / 2];
        for (var p = 0; p < 2; p++) {
          var g = (m === 'pair' || open[p]) ? v.vsg : close;
          xs[p * 2] = pc[p] - g / 2 - w;
          xs[p * 2 + 1] = pc[p] + g / 2;
          vsx[p] = pc[p];
        }
      }
      return { xs: xs, vsx: vsx };
    }
    function place(animatePair, dur) {
      var v = sc.ctx.layout.v, w = v.w, h = Math.round(w * 2 / 3), P = positions();
      slots.forEach(function (s, i) {
        var moving = animatePair !== undefined && Math.floor(i / 2) === animatePair;
        s.el.style.transition = moving ? 'left ' + dur + 'ms cubic-bezier(.65,0,.25,1)' : 'none';
        px(s.el, { left: P.xs[i], top: v.top, width: w, height: h });
        var t = teamAt(i);
        s.box.set(t, 0, 0, w, h, v.pad, sc.ctx.preview);
        s.en.text(t ? t.en : '');
        s.zh.text(FDM.line2(S, t));
      });
      // 四隊隊名用同一個字級（以最長的隊名為準縮小）
      var gap = Math.max(12, mode() === 'row' ? v.close : Math.min(v.close, v.vsg));
      var maxW = w + gap - 12;
      var es = fitGroup(slots.map(function (s) { return { txt: s.en, x: w / 2, y: h + v.ng, maxW: maxW }; }), v.ens);
      fitGroup(slots.map(function (s) { return { txt: s.zh, x: w / 2, y: h + v.ng + es + 10, maxW: maxW }; }), v.zhs);
      vs.forEach(function (e, p) {
        px(e, { left: P.vsx[p], top: v.top + h / 2, fontSize: v.vss });
        if (mode() === 'row') FX.hide(e);
      });
    }
    function hideAll() {
      sc.restart();
      open = [false, false];
      shown = 0;
      slots.forEach(function (s) { ORDER.forEach(function (k) { FX.hide(s.EL[k]); }); });
      vs.forEach(FX.hide);
      place();
    }
    function staticShow(n) {
      sc.restart();
      shown = n;
      var m = mode();
      open = [m !== 'step' || n >= 2, m !== 'step' || n >= 4];
      place();
      slots.forEach(function (s, i) { ORDER.forEach(function (k) { if (i < n) FX.show(s.EL[k]); else FX.hide(s.EL[k]); }); });
      vs.forEach(function (e, p) { if (m !== 'row' && (m === 'pair' ? n > p * 2 : open[p])) FX.show(e); else FX.hide(e); });
    }
    function reveal(i, tl) {
      var a = FDM.chain(ORDER, sc.ctx.layout.anim, 0, effectsOn);
      var s = slots[i];
      ORDER.forEach(function (k) { tl.at(a[k].start, function () { FX.run(s.EL[k], a[k].fx, a[k].dur, tl); }); });
      if (mode() === 'pair' && i % 2 === 0) tl.at(a._end * 0.5, function () { FX.run(vs[i / 2], effectsOn ? 'fade' : 'none', 500, tl); });
      return a._end;
    }
    function split(p, tl) {
      var L = sc.ctx.layout, dur = effectsOn ? L.split : 0;
      open[p] = true;
      place(p, dur);
      tl.at(dur * 0.75, function () { FX.run(vs[p], effectsOn ? L.vsFx : 'none', effectsOn ? Math.max(350, sc.ctx.layout.anim.duration) : 0, tl); });
    }
    function next(i) {
      var tl = sc.tl;
      shown = Math.max(shown, i + 1);
      var end = reveal(i, tl);
      if (mode() === 'step' && i % 2 === 1) tl.at(end + (effectsOn ? sc.ctx.layout.wait : 0), function () { split((i - 1) / 2, tl); });
    }
    function auto() {
      hideAll();
      var tl = sc.tl, L = sc.ctx.layout, t = 0, itv = effectsOn ? L.itv : 0;
      var one = FDM.chain(ORDER, L.anim, 0, effectsOn)._end;
      for (var i = 0; i < 4; i++) {
        (function (i, t) { tl.at(t, function () { shown = i + 1; reveal(i, tl); }); })(i, t);
        if (mode() === 'step' && i % 2 === 1) {
          (function (p, t2) { tl.at(t2, function () { split(p, tl); }); })((i - 1) / 2, t + one + L.wait);
          t += one + L.wait + L.split + 300;
        } else t += itv;
      }
    }
    sc.update = function (c) {
      sc.ctx = c;
      place();
      if (!c.preview && S.show.top4Shown < shown) staticShow(S.show.top4Shown);
    };
    sc.showStatic = function () { staticShow(sc.ctx.preview ? 4 : (S.show.top4Shown || 0)); };
    sc.enter = function () { staticShow(sc.ctx.preview ? 4 : (S.show.top4Shown || 0)); };
    sc.event = function (ev) {
      if (ev.name === 'top4next') next(ev.index);
      else if (ev.name === 'top4auto') auto();
      else if (ev.name === 'top4reset') hideAll();
      else if (ev.name === 'top4view') {
        // 編排時調整間距：顯示併排（尚未拉開）或拉開後的樣子
        sc.restart();
        shown = 4;
        open = [!!ev.open, !!ev.open];
        place();
        slots.forEach(function (s) { ORDER.forEach(function (k) { FX.show(s.EL[k]); }); });
        vs.forEach(function (e) { if (mode() !== 'row' && (mode() === 'pair' || ev.open)) FX.show(e); else FX.hide(e); });
      }
      else if (ev.name === 'entrance') auto();
    };
    place();
    return sc;
  };

  // ---------- 對戰計分 ----------
  var measureCanvas = document.createElement('canvas').getContext('2d');
  function digitTop(size) {
    // 以數字實際筆畫的中心對齊，不是文字框中心
    measureCanvas.font = '900 ' + size + 'px ' + getComputedStyle(stage).getPropertyValue('--fen');
    var m = measureCanvas.measureText('0123456789');
    var A = m.fontBoundingBoxAscent || size * 0.95, D = m.fontBoundingBoxDescent || size * 0.3;
    var a = m.actualBoundingBoxAscent || size * 0.7, d = m.actualBoundingBoxDescent || 0;
    return (size - (A + D)) / 2 + A - (a - d) / 2;
  }

  SCENES.battle = function (ctx) {
    var sc = baseScene(ctx);
    var hdr = mk('div', 'txt', sc.root);
    var hIn = mk('div', 't', hdr);
    hIn.style.display = 'block';
    var h1 = mk('div', 'en ls-h1', hIn), h2 = mk('div', 'en ls-h2', hIn), h3 = mk('div', 'zh', hIn);
    h1.style.display = h2.style.display = 'block';
    var h3a = mk('span', 'ls-h1', h3), h3g = mk('span', '', h3), h3b = mk('span', 'ls-h1', h3);
    h3g.style.display = 'inline-block';
    h3.style.opacity = '.85';
    var pL = PhotoBox(sc.root), pR = PhotoBox(sc.root);
    var enL = Txt(sc.root, 'en'), zhL = Txt(sc.root, 'zh'), enR = Txt(sc.root, 'en'), zhR = Txt(sc.root, 'zh');
    [enL, enR].forEach(function (x) { x.t.classList.add('ls-name'); });
    [zhL, zhR].forEach(function (x) { x.t.classList.add('ls-zh'); });
    var scL = mk('div', 'score', sc.root), scR = mk('div', 'score', sc.root);
    var sL = mk('span', '', scL), sR = mk('span', '', scR);
    var dv = mk('div', 'divider', sc.root);
    var tmB = mk('div', 'txt', sc.root);
    var tmIn = mk('div', 't nomask', tmB);
    tmIn.style.display = 'block';
    var tlab = mk('div', 'en ls-lab gm', tmIn), tm = mk('div', 'en ls-tm gm', tmIn);
    tlab.textContent = 'TIME';
    tm.style.display = 'inline-block';
    var sealL = mk('div', 'seal', sc.root), sealR = mk('div', 'seal', sc.root);
    var sealImgL = mk('img', '', sealL), sealImgR = mk('img', '', sealR);
    var SEAL = { l: sealL, r: sealR };
    var shownScore = { l: null, r: null }, shownSeal = null, shownRound = null;
    var GROUPS = {
      fr: [[pL.fr], [pR.fr]], ph: [[pL.ph], [pR.ph]],
      nm: [[enL.t, zhL.t], [enR.t, zhR.t]], info: [[hIn, sL, sR, dv, tmIn]]
    };
    var ORDER = ['fr', 'ph', 'nm', 'info'];

    function B() { return S.results.battles[sc.ctx.cue.battle] || { l: 0, r: 0, round: 1, seal: null }; }
    function side(src) {
      var t = FDM.resolve(S, src);
      if (!t && sc.ctx.preview) return { en: '（' + FDM.sourceLabel(src) + '）', zh: '', tag: '決定後自動帶入', photo: null, _ph: true };
      return t;
    }
    function headers(round) {
      var c = sc.ctx.cue;
      h1.textContent = c.title || '';
      h2.textContent = 'ROUND ' + round;
      h3a.textContent = c.zh || '';
      h3b.textContent = '第' + FDM.zhNum(round) + '回合';
    }
    function sealSrc() {
      var s = sc.ctx.layout.seal;
      if (s.img) return asset(s.img);
      var txt = s.text || '勝', font = '900 250px "' + (S.event.fontZh || 'Noto Serif TC') + '"';
      if (document.fonts && document.fonts.check && !document.fonts.check(font, txt)) {
        document.fonts.load(font, txt).then(function () {
          FX.clearSealCache();
          if (current && current.scene) current.scene.update(ctxFor(targetCue()), null);
        }).catch(function () {});
      }
      return FX.sealImage(txt, s.ink, s.color, S.event.fontZh);
    }
    sc.update = function (c, meta) {
      sc.ctx = c;
      var v = c.layout.v, cue = c.cue;
      var w = v.pw, h = Math.round(w * 2 / 3), xl = W / 2 - v.pd - w, xr = W / 2 + v.pd, T = v.pt;
      var tL = side(cue.left), tR = side(cue.right);
      pL.set(tL, xl, T, w, h, v.pad, c.preview && (!tL || tL._ph));
      pR.set(tR, xr, T, w, h, v.pad, c.preview && (!tR || tR._ph));
      var nameMax = Math.min(w + Math.max(0, v.pd * 2 - 40), W / 2 - 40);
      [[enL, zhL, tL], [enR, zhR, tR]].forEach(function (a) {
        var t = a[2];
        a[0].text(t ? t.en : '');
        a[1].text(t && t._ph ? t.tag : FDM.line2(S, t));
      });
      // 左右隊名用同一個字級
      var es = fitGroup([{ txt: enL, x: xl + w / 2, y: T + h + v.ng, maxW: nameMax }, { txt: enR, x: xr + w / 2, y: T + h + v.ng, maxW: nameMax }], v.es);
      fitGroup([{ txt: zhL, x: xl + w / 2, y: T + h + v.ng + es + 14, maxW: nameMax }, { txt: zhR, x: xr + w / 2, y: T + h + v.ng + es + 14, maxW: nameMax }], v.zs);
      px(hdr, { left: W / 2, top: v.hy });
      h1.style.fontSize = v.hs + 'px';
      h2.style.fontSize = Math.round(v.hs * 0.65) + 'px';
      h2.style.marginTop = h3.style.marginTop = '10px';
      h3.style.fontSize = Math.round(v.hs * 0.47) + 'px';
      h3g.style.width = v.hg + 'px';
      var top = digitTop(v.ss);
      [[scL, W / 2 - v.sd], [scR, W / 2 + v.sd]].forEach(function (a) {
        px(a[0], { left: a[1], top: v.sy - top, fontSize: v.ss, lineHeight: v.ss });
      });
      dv.style.display = c.layout.divider === false ? 'none' : '';
      px(dv, { left: W / 2 - 1.5, top: v.sy - v.ss * 0.7, height: v.ss * 1.4 });
      px(tmB, { left: W / 2, top: v.ty });
      tlab.style.fontSize = Math.round(v.ts * 0.3) + 'px';
      tm.style.fontSize = v.ts + 'px';
      tm.style.marginTop = Math.round(v.ts * 0.12) + 'px';
      var src = sealSrc();
      [[sealL, sealImgL, xl + w + v.gx, v.ga], [sealR, sealImgR, xr - v.gx, -v.ga]].forEach(function (a) {
        if (a[1].getAttribute('src') !== src) a[1].src = src;
        px(a[0], { left: a[2] - v.gs / 2, top: T + h + v.gy - v.gs / 2, width: v.gs, height: v.gs });
        a[0].style.transform = 'rotate(' + a[3] + 'deg)';
        a[0].dataset.rot = a[3];
      });
      var b = B();
      if (shownRound !== b.round) { shownRound = b.round; headers(b.round); }
      ['l', 'r'].forEach(function (k) {
        if (shownScore[k] !== b[k]) { shownScore[k] = b[k]; (k === 'l' ? sL : sR).textContent = b[k]; }
      });
      if (shownSeal !== b.seal) {
        if (shownSeal) FX.hide(SEAL[shownSeal]);
        if (b.seal) FX.show(SEAL[b.seal]);
        shownSeal = b.seal;
      }
    };
    function all(fn) { ORDER.forEach(function (g) { GROUPS[g].forEach(function (sd) { sd.forEach(fn); }); }); }
    sc.showStatic = function () { all(FX.show); };
    sc.enter = function () {
      var tl = sc.restart(), L = sc.ctx.layout;
      all(FX.hide);
      var a = FDM.chain(ORDER, L.anim, 0, effectsOn);
      var stg = effectsOn ? (L.anim.stagger || 0) : 0;
      ORDER.forEach(function (g) {
        GROUPS[g].forEach(function (sd, si) {
          sd.forEach(function (el, qi) {
            var t = a[g].start + si * stg + qi * a[g].dur * 0.4;
            tl.at(t, function () { FX.run(el, a[g].fx, a[g].dur, tl); });
          });
        });
      });
    };
    function animScore(k, value) {
      var sp = k === 'l' ? sL : sR, fx = sc.ctx.layout.scoreFx;
      shownScore[k] = value;
      FX.cancel(sp);
      sp.style.opacity = '1';
      if (!effectsOn) { sp.textContent = value; return; }
      if (fx === 'flip') {
        sp.animate([{ transform: 'rotateX(0)' }, { transform: 'rotateX(90deg)' }], { duration: 180 }).onfinish = function () {
          sp.textContent = value;
          sp.animate([{ transform: 'rotateX(-90deg)' }, { transform: 'rotateX(0)' }], { duration: 240 });
        };
      } else if (fx === 'pop') {
        sp.textContent = value;
        sp.animate([{ transform: 'scale(2)', opacity: 0 }, { transform: 'scale(.9)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 450 });
      } else {
        var a = sp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
        a.onfinish = function () {
          sp.textContent = value;
          a.cancel();
          sp.animate([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
        };
      }
    }
    function stamp(k) {
      var s = sc.ctx.layout.seal, el = SEAL[k], other = SEAL[k === 'l' ? 'r' : 'l'];
      FX.hide(other);
      FX.cancel(el);
      el.style.opacity = '1';
      shownSeal = k;
      if (!effectsOn) return;
      var a = +el.dataset.rot, rit = s.anim === 'ritual';
      el.animate(rit ? [
        { transform: 'rotate(' + (a - 3) + 'deg) scale(1.9)', opacity: 0 },
        { transform: 'rotate(' + (a - 1) + 'deg) scale(1.6)', opacity: 0.35, offset: 0.72 },
        { transform: 'rotate(' + (a - 1) + 'deg) scale(1.62)', opacity: 0.35, offset: 0.84 },
        { transform: 'rotate(' + a + 'deg) scale(.95)', opacity: 1, offset: 0.95 },
        { transform: 'rotate(' + a + 'deg) scale(1)', opacity: 1 }
      ] : [
        { transform: 'rotate(' + (a - 8) + 'deg) scale(2.6)', opacity: 0 },
        { transform: 'rotate(' + a + 'deg) scale(.94)', opacity: 1, offset: 0.6 },
        { transform: 'rotate(' + a + 'deg) scale(1)', opacity: 1 }
      ], { duration: rit ? 2000 : 450, easing: rit ? 'linear' : 'cubic-bezier(.55,0,.8,.2)' });
      var id = setTimeout(function () { FX.shake(1); }, rit ? 1880 : 270);
      sc.tl.timers.push(id);
    }
    function fadeSeal() {
      var s = sc.ctx.layout.seal;
      ['l', 'r'].forEach(function (k) {
        var el = SEAL[k];
        if (getComputedStyle(el).opacity === '0') return;
        var a = +el.dataset.rot, to = s.fadeMode === 'shrink' ? ' scale(.6)' : s.fadeMode === 'sink' ? ' translateY(40px)' : '';
        FX.cancel(el);
        el.style.opacity = '0';
        if (effectsOn) el.animate([{ opacity: 1, transform: 'rotate(' + a + 'deg)' }, { opacity: 0, transform: 'rotate(' + a + 'deg)' + to }], { duration: s.fadeMs, easing: FX.CSS_EASE });
      });
      shownSeal = null;
    }
    sc.event = function (ev) {
      if (ev.battle && ev.battle !== sc.ctx.cue.battle) return;
      if (ev.name === 'entrance') sc.enter();
      else if (ev.name === 'score') animScore(ev.side, ev.value);
      else if (ev.name === 'seal') stamp(ev.side);
      else if (ev.name === 'sealFade') fadeSeal();
      else if (ev.name === 'round') {
        shownRound = ev.round;
        headers(ev.round);
        // 只有回合數淡入，FINAL／SEMI FINAL 等標題不動
        if (effectsOn) [h2, h3b].forEach(function (el) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600 }); });
        if (shownSeal) { if (sc.ctx.layout.seal.autoFade) fadeSeal(); else { FX.hide(SEAL.l); FX.hide(SEAL.r); shownSeal = null; } }
      } else if (ev.name === 'testTimer') testUntil = Date.now() + (sc.ctx.layout.timer.warn + 2) * 1000;
      else if (ev.name === 'testScore') animScore('l', (shownScore.l || 0) + 1);
    };
    // 計時器
    var lastSec = null, testUntil = 0;
    function remaining() {
      if (testUntil) {
        var r = (testUntil - Date.now()) / 1000;
        if (r > -2.5) return Math.max(0, r);
        testUntil = 0;
      }
      var t = S.show.timer;
      if (t.endsAt) return Math.max(0, (t.endsAt - fd.now()) / 1000);
      return t.pausedLeft != null ? t.pausedLeft : t.duration;
    }
    function fmt(s) { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function tick() {
      var r = remaining(), s = Math.max(0, Math.ceil(r - 1e-6)), cfg = sc.ctx.layout.timer;
      var running = testUntil || S.show.timer.endsAt;
      var txt = fmt(r);
      if (tm.textContent !== txt) tm.textContent = txt;
      var warn = cfg.fx === 'heartbeat' && running && s <= cfg.warn && s > 0;
      var col = warn ? 'var(--light)' : '';
      if (tm.style.color !== col) { tm.style.color = col; tlab.style.color = col; }
      if (s !== lastSec) {
        var prev = lastSec;
        lastSec = s;
        if (warn && prev !== null && effectsOn) {
          var fin = s <= 3 && cfg.shake, k = fin ? 1.5 : 1;
          tm.animate([{ transform: 'scale(' + (1 + 0.28 * k) + ')' }, { transform: 'scale(1)' }], { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' });
          if (fin) { tm.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.5 }, { opacity: 1 }], { duration: 500, delay: 500 }); FX.shake(0.8); }
          if (cfg.vignette) vig.animate([{ opacity: fin ? 0.95 : 0.6 }, { opacity: fin ? 0.55 : 0.25 }], { duration: 900, fill: 'forwards' });
        }
        if (s === 0 && prev === 1 && running) {
          if (effectsOn) tm.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }], { duration: 1200 });
          vig.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 1500, fill: 'forwards' });
        }
        if (!warn && s > 0) { vig.getAnimations().forEach(function (a) { a.cancel(); }); }
      }
      sc.loop = requestAnimationFrame(tick);
    }
    var baseDestroy = sc.destroy;
    sc.destroy = function () { vig.getAnimations().forEach(function (a) { a.cancel(); }); baseDestroy.call(sc); };
    sc.update(ctx);
    sc.loop = requestAnimationFrame(tick);
    return sc;
  };

  // ---------- 頒獎：c = Battle 冠軍、r = 排舞賽冠軍 ----------
  SCENES.champ = function (ctx) {
    var sc = baseScene(ctx);
    function T(cls, ls) { var x = Txt(sc.root, cls); x.t.classList.add(ls); return x; }
    var leadA = T('en', 'ls-lead'), leadB = T('zh', 'ls-zh');
    var sT = T('en', 'ls-title'), sB = PhotoBox(sc.root), sN = T('en', 'ls-name'), sZ = T('zh', 'ls-zh');
    var cT = T('en', 'ls-title'), cB = PhotoBox(sc.root), cN = T('en', 'ls-name');
    var rT = T('en', 'ls-title'), rB = PhotoBox(sc.root), rN = T('en', 'ls-name');
    var GROUP = {
      lead: [leadA.t, leadB.t],
      solo: [sB.fr, sB.ph, sN.t, sZ.t, sT.t],
      duo: [cB.fr, cB.ph, cN.t, cT.t, rB.fr, rB.ph, rN.t, rT.t]
    };
    var view = 'none', soloK = 'c', pendingView = null;
    function teams() {
      var c = FDM.resolve(S, sc.ctx.cue.champ), r = FDM.resolve(S, sc.ctx.cue.runner);
      if (sc.ctx.preview) {
        if (!c) c = { en: '（決賽勝方）', photo: null, _ph: true };
        if (!r) r = { en: '（排舞賽冠軍）', photo: null, _ph: true };
      }
      return { c: c, r: r };
    }
    function texts(k) {
      var tx = sc.ctx.layout.text, tm = teams(), t = k === 'c' ? tm.c : tm.r;
      leadA.text(k === 'c' ? tx.lc : tx.lr);
      leadB.text(k === 'c' ? tx.lcz : tx.lrz);
      sT.text(k === 'c' ? tx.tc : tx.trr);
      sN.text(t ? t.en : '');
      sZ.text(k === 'c' ? tx.cz : tx.rz);
      return t;
    }
    // 只排版與更新文字，不改變目前顯示的是哪個畫面
    function layout() {
      var c = sc.ctx, v = c.layout.v, tx = c.layout.text, tm = teams();
      var soloTeam = texts(soloK);
      var les = leadA.at(W / 2, v.lY, v.lEs, W - 160);
      leadB.at(W / 2, v.lY + les + v.lG, v.lZs, W - 160);
      var w = v.sw, h = Math.round(w * 2 / 3), y = v.sy;
      sB.set(soloTeam, (W - w) / 2, y, w, h, v.pad, c.preview && (!soloTeam || soloTeam._ph));
      sT.at(W / 2, y - v.sTg - v.sTs, v.sTs, W - 160);
      var sns = sN.at(W / 2, y + h + v.sNg, v.sNs, W - 160);
      sZ.at(W / 2, y + h + v.sNg + sns + v.sZg, v.sZs);
      var cw = v.cw, ch = Math.round(cw * 2 / 3), rw = v.rw, rh = Math.round(rw * 2 / 3);
      var tot = cw + v.gap + rw, rx = W / 2 - tot / 2, cx = rx + rw + v.gap, ty = v.dy, ry = ty + (ch - rh); // 排舞賽冠軍在左、Battle 冠軍在右
      cB.set(tm.c, cx, ty, cw, ch, v.pad, c.preview && (!tm.c || tm.c._ph));
      rB.set(tm.r, rx, ry, rw, rh, v.pad, c.preview && (!tm.r || tm.r._ph));
      cT.text(tx.tc); rT.text(tx.trr);
      cN.text(tm.c ? tm.c.en : ''); rN.text(tm.r ? tm.r.en : '');
      cT.at(cx + cw / 2, ty - v.dTg - v.cTs, v.cTs, cw + Math.max(0, v.gap) - 20);
      cN.at(cx + cw / 2, ty + ch + v.dNg, v.cNs, cw + Math.max(0, v.gap) - 20);
      rT.at(rx + rw / 2, ry - v.dTg - v.rTs, v.rTs, rw + Math.max(0, v.gap) - 20);
      rN.at(rx + rw / 2, ry + rh + v.dNg, v.rNs, rw + Math.max(0, v.gap) - 20);
    }
    sc.update = function (c) {
      sc.ctx = c;
      layout();
      var want = c.preview ? previewView : (S.show.champView || 'none');
      // 揭曉動畫進行中：等狀態追上動畫後才恢復同步
      if (pendingView) { if (want === pendingView) pendingView = null; return; }
      if (want !== view) setView(want, true);
    };
    function groupOf(vw) { return vw === 'duo' ? 'duo' : vw.indexOf('solo') === 0 ? 'solo' : vw.indexOf('lead') === 0 ? 'lead' : null; }
    function setView(vw, fade) {
      var tl = sc.restart();
      view = vw;
      pendingView = null;
      if (vw.indexOf('-') > 0) { soloK = vw.split('-')[1]; layout(); }
      var g = groupOf(vw);
      ['lead', 'solo', 'duo'].forEach(function (k) {
        GROUP[k].forEach(function (el) {
          if (k === g) FX.run(el, fade && effectsOn ? 'fade' : 'none', 400, tl);
          else FX.hide(el);
        });
      });
    }
    function reveal(k) {
      var tl = sc.restart(), L = sc.ctx.layout;
      view = 'solo-' + k;
      soloK = k;
      pendingView = sc.ctx.preview ? null : view;
      if (sc.ctx.preview) previewView = view;
      layout();
      ['lead', 'solo', 'duo'].forEach(function (g) { GROUP[g].forEach(FX.hide); });
      var A = FDM.chain(['lt', 'lz'], L.anim, 0, effectsOn);
      tl.at(A.lt.start, function () { FX.run(leadA.t, A.lt.fx, A.lt.dur, tl); });
      tl.at(A.lz.start, function () { FX.run(leadB.t, A.lz.fx, A.lz.dur, tl); });
      var d = effectsOn ? L.anim.duration : 0;
      var outS = A._end + (effectsOn ? L.pause : 0);
      tl.at(outS, function () { GROUP.lead.forEach(function (el) { FX.out(el, L.leadOut, d, tl); }); });
      var base = L.leadOut === 'none' ? outS : outS + d * (L.anim.overlap / 100);
      var ord = ['sf', 'sp', 'sn', 'sz', 'st'], els = { sf: sB.fr, sp: sB.ph, sn: sN.t, sz: sZ.t, st: sT.t };
      var Sx = FDM.chain(ord, L.anim, base, effectsOn);
      ord.forEach(function (x) { tl.at(Sx[x].start, function () { FX.run(els[x], Sx[x].fx, Sx[x].dur, tl); }); });
    }
    function duo() {
      var tl = sc.restart(), L = sc.ctx.layout;
      view = 'duo';
      pendingView = sc.ctx.preview ? null : 'duo';
      if (sc.ctx.preview) previewView = 'duo';
      layout();
      ['lead', 'solo', 'duo'].forEach(function (g) { GROUP[g].forEach(FX.hide); });
      var ord = ['df', 'dp', 'dn', 'dt'];
      var D = FDM.chain(ord, L.anim, 0, effectsOn);
      var stg = effectsOn ? L.stg : 0;
      var oC = L.duoOrder === 'rc' ? stg : 0, oR = L.duoOrder === 'cr' ? stg : 0;
      var map = { df: [cB.fr, rB.fr], dp: [cB.ph, rB.ph], dn: [cN.t, rN.t], dt: [cT.t, rT.t] };
      ord.forEach(function (x) {
        tl.at(D[x].start + oC, function () { FX.run(map[x][0], D[x].fx, D[x].dur, tl); });
        tl.at(D[x].start + oR, function () { FX.run(map[x][1], D[x].fx, D[x].dur, tl); });
      });
    }
    sc.showStatic = function () { var want = sc.ctx.preview ? previewView : (S.show.champView || 'none'); setView(want, false); };
    sc.enter = sc.showStatic;
    sc.event = function (ev) {
      if (ev.name === 'champReveal') reveal(ev.k);
      else if (ev.name === 'champDuo') duo();
      else if (ev.name === 'champView') { previewView = ev.view; setView(ev.view, true); }
    };
    sc.update(ctx);
    return sc;
  };

  // =====================================================================
  //  場景切換
  // =====================================================================
  function mountScene(cue, animated) {
    var ctx = ctxFor(cue);
    var make = SCENES[cue ? cue.type : 'black'] || SCENES.black;
    var sc = make(ctx);
    applyBg(cue ? (cue.type === 'black' ? { mode: 'color', color: '#000', texture: false } : ctx.layout.bg) : { mode: 'color', color: '#000', texture: false }, !animated);
    if (animated) {
      // 等新畫面排版、圖片上傳到顯示卡後再開始動畫，第一格不會掉格
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (sc.root.isConnected) sc.enter(); }); });
    } else sc.showStatic();
    return sc;
  }

  function sceneKey(cue) { return cue ? cue.id + '#' + cue.type + '#' + FDM.layoutKey(cue) : 'none'; }

  // 預先載入並解碼所有照片、外框、印章、底圖，切換畫面時不會因為解碼大圖而卡一下
  var preloaded = {}, preloadSig = '';
  function preloadAssets() {
    var list = [S.frame];
    S.teams.concat(S.judges || []).forEach(function (t) { if (t.photo) list.push(t.photo.trim || t.photo.src); });
    S.sponsors.logos.forEach(function (l) { list.push(l.src); });
    for (var k in S.layouts) {
      var L = S.layouts[k];
      if (!L) continue;
      if (L.bg && L.bg.mode === 'image') list.push(L.bg.src);
      if (L.seal && L.seal.img) list.push(L.seal.img);
    }
    list = list.filter(Boolean);
    var sig = list.join('|');
    if (sig === preloadSig) return;
    preloadSig = sig;
    list.forEach(function (p) {
      var u = asset(p);
      if (preloaded[u]) return;
      var im = new Image();
      im.decoding = 'async';
      im.src = u;
      if (im.decode) im.decode().catch(function () {});
      preloaded[u] = im;
    });
  }

  var transitioning = null;
  function render(meta) {
    applyLook();
    preloadAssets();
    var cue = targetCue();
    var key = sceneKey(cue);
    var seq = PREVIEW ? 0 : S.show.seq;
    if (!current) {
      current = { key: key, seq: seq, scene: mountScene(cue, false) };
      drawGuides();
      return;
    }
    if (key !== current.key || seq !== current.seq) {
      var old = current.scene || current.old;
      var sameCue = key === current.key;
      current = { key: key, seq: seq, scene: null, old: old };
      if (transitioning) transitioning.kill();
      var tl = transitioning = new FX.Timeline();
      var go = function () {
        if (!tl.alive) return;
        old.destroy();
        current.old = null;
        current.scene = mountScene(targetCue(), true);
        drawGuides();
      };
      if (PREVIEW) { old.destroy(); current.old = null; current.scene = mountScene(targetCue(), false); drawGuides(); }
      else if (sameCue && PREVIEW) go();
      else old.exit(go);
      // 退場中若又切換，先暫存新場景的更新
      return;
    }
    if (current.scene) {
      var c = ctxFor(cue);
      current.scene.update(c, meta);
      applyBg(cue ? (cue.type === 'black' ? { mode: 'color', color: '#000', texture: false } : c.layout.bg) : null, false);
      drawGuides();
    }
  }

  // ---------- 對齊線（編排模式） ----------
  var guideOpts = { safe: false, lines: false };
  function drawGuides() {
    guides.innerHTML = '';
    if (!PREVIEW) return;
    if (guideOpts.safe) mk('div', 'safe', guides);
    if (!guideOpts.lines) return;
    var cue = targetCue(), L = cue ? FDM.layoutFor(S, cue) : null;
    var v = function (x, b) { var e = mk('div', 'v' + (b ? ' b' : ''), guides); e.style.left = (x - 1) + 'px'; };
    var h = function (y, b) { var e = mk('div', 'h' + (b ? ' b' : ''), guides); e.style.top = (y - 1) + 'px'; };
    v(W / 2);
    if (cue && cue.type === 'battle' && L) {
      var q = L.v, pw = q.pw, ph = Math.round(pw * 2 / 3);
      v(W / 2 - q.pd - pw / 2); v(W / 2 + q.pd + pw / 2);
      h(q.pt + ph / 2);
      v(W / 2 - q.sd, true); v(W / 2 + q.sd, true); h(q.sy, true);
    } else if (cue && cue.type === 'team' && L) {
      var t = L.v; h(t.pt + Math.round(t.pw * 2 / 3) / 2);
    } else if (cue && cue.type === 'judge' && L) {
      var jv = L.v; h(jv.pt + Math.round(jv.pw * ratioOf(L)) / 2);
    }
  }

  // ---------- 預先準備（空閒時做，切換畫面時就不用臨時產生） ----------
  var warmSig = '';
  function prewarm() {
    if (!S) return;
    var ev = S.event, texts = [], sig;
    S.teams.concat(S.judges || []).forEach(function (t) { texts.push(t.en, t.zh, t.tag); });
    S.cues.forEach(function (c) { texts.push(c.title, c.zh); });
    for (var k in S.layouts) {
      var L = S.layouts[k];
      if (L && L.text) for (var x in L.text) texts.push(L.text[x]);
      if (L && L.seal) texts.push(L.seal.text);
    }
    texts.push('TIME ROUND VS 0123456789: 第一二三四五六七八九十回合');
    var all = texts.filter(Boolean).join(' ');
    sig = all + '|' + ev.fontEn + '|' + ev.fontZh;
    if (sig === warmSig) return;
    warmSig = sig;
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
    idle(function () {
      // 產生紙紋並先解碼，第一次顯示時不會卡
      ['paper', 'grain'].forEach(function (k) {
        var im = new Image();
        im.src = FX.noiseTexture(k);
        if (im.decode) im.decode().catch(function () {});
        preloaded['tex:' + k] = im;
      });
    });
    if (document.fonts && document.fonts.load) {
      document.fonts.load('900 64px "' + (ev.fontEn || 'Cinzel') + '"', all).catch(function () {});
      document.fonts.load('900 64px "' + (ev.fontZh || 'Noto Serif TC') + '"', all).catch(function () {});
      document.fonts.load('700 64px "' + (ev.fontEn || 'Cinzel') + '"', all).catch(function () {});
    }
    idle(function () {
      for (var k in S.layouts) {
        var L = S.layouts[k];
        if (L && L.seal && !L.seal.img) FX.sealImage(L.seal.text || '勝', L.seal.ink, L.seal.color, ev.fontZh);
      }
    });
  }

  // ---------- 連線 ----------
  var fd = window.fd = FD.connect({
    onState: function (state, rev, reason, meta) {
      S = state;
      document.getElementById('offline').style.display = 'none';
      render(meta);
      prewarm();
    },
    onEvent: function (ev) {
      if (PREVIEW || !current || !current.scene) return;
      current.scene.event(ev);
    },
    onStatus: function (s) {
      // 觀眾看得到輸出畫面，斷線時不顯示任何文字，保持最後的畫面；只在網址加 ?debug=1 時提示
      document.getElementById('offline').style.display = s === 'offline' && params.get('debug') === '1' ? 'block' : 'none';
    }
  });

  // 編排模式的測試按鈕（控制面板以 postMessage 傳入）
  addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.fd !== 'preview') return;
    if (m.guides) { guideOpts = m.guides; if (S) drawGuides(); }
    if (m.setCue && IS_PREVIEW_FRAME) { PREVIEW = m.setCue; if (m.view) previewView = m.view; if (S) render(null); }
    if (m.event && current && current.scene) {
      if (m.event.name === 'entrance' && current.scene.enter) current.scene.enter();
      else current.scene.event(m.event);
    }
  });

  // 字型載入後重新排版（比分置中需要量測字形）
  if (document.fonts) {
    var refont = function () { if (S && current && current.scene) current.scene.update(ctxFor(targetCue()), null); };
    document.fonts.ready.then(refont);
    document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', refont);
  }
})();
