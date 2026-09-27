/* 動畫引擎：潑墨、毛筆、淡入、滑入、重擊，以及退場
 * 潑墨與毛筆用 clip-path 形狀裁切（每格只改一個字串，不會掉格）
 * 所有登場效果共用同一條平順曲線（ease-in-out sine）
 */
(function (global) {
  'use strict';

  var EASE = function (p) { return -(Math.cos(Math.PI * p) - 1) / 2; };
  var CSS_EASE = 'cubic-bezier(.37,0,.63,1)';
  var seedCounter = 1;

  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 可整批取消的排程：切換畫面或重播時呼叫 kill()
  function Timeline() {
    this.alive = true;
    this.timers = [];
  }
  Timeline.prototype.at = function (ms, fn) {
    var self = this;
    var id = setTimeout(function () { if (self.alive) fn(); }, Math.max(0, ms || 0));
    this.timers.push(id);
    return id;
  };
  Timeline.prototype.kill = function () {
    this.alive = false;
    for (var i = 0; i < this.timers.length; i++) clearTimeout(this.timers[i]);
    this.timers = [];
  };

  function setClip(el, v) { el.style.clipPath = v; el.style.webkitClipPath = v; }

  function cancel(el) {
    if (!el) return;
    if (el.getAnimations) el.getAnimations().forEach(function (a) { a.cancel(); });
    el._fxRun = (el._fxRun || 0) + 1;
    setClip(el, '');
  }

  function hide(el) { if (!el) return; cancel(el); el.style.opacity = '0'; }
  function show(el) { if (!el) return; cancel(el); el.style.opacity = '1'; }

  function poly(cx, cy, r, nz, n) {
    n = nz ? nz.length : (n || 10);
    var d = '';
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, rr = r * (1 + (nz ? nz[i] : 0));
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
    }
    return d + 'Z';
  }

  // type: 'ink' | 'brush'；rev = true 表示反向（退場）
  function clipAnim(el, type, dur, tl, rev, done) {
    var run = el._fxRun = (el._fxRun || 0) + 1;
    var w = el.offsetWidth || 1, h = el.offsetHeight || 1, H = Math.hypot(w, h);
    var rnd = rng(el._fxSeed || (el._fxSeed = (seedCounter++ * 7919) >>> 0));
    var B = [], D = [], R = [];
    if (type === 'ink') {
      var nz = function (amp) { var a = []; for (var i = 0; i < 28; i++) a.push(rnd() * amp - amp / 2); return a; };
      B.push({ cx: w / 2, cy: h / 2, r: H * 0.72, s: 0, n: nz(0.5) });
      for (var i = 0; i < 6; i++) B.push({ cx: rnd() * w, cy: rnd() * h, r: H * (0.1 + rnd() * 0.18), s: rnd() * 0.35, n: nz(0.6) });
      for (var j = 0; j < 30; j++) D.push({ x: rnd() * w, y: rnd() * h, r: (1 + rnd() * rnd() * 5) * H / 400, s: rnd() * 0.6 });
    } else {
      var rows = 36;
      for (var k = 0; k < rows; k++) R.push({ y: k * h / rows, hh: h / rows + 0.6, lag: rnd() * 0.18, j: rnd() * 0.06 });
    }
    function path(e) {
      var d = 'M0 0Z';
      if (type === 'ink') {
        for (var i = 0; i < B.length; i++) {
          var b = B[i], q = Math.max(0, Math.min(1, (e - b.s) / (1 - b.s)));
          if (q > 0) d += poly(b.cx, b.cy, b.r * q, b.n);
        }
        for (var j = 0; j < D.length; j++) {
          var o = D[j];
          if (e > o.s) d += poly(o.x, o.y, o.r * Math.min(1, (e - o.s) * 5), null, 8);
        }
      } else {
        for (var k = 0; k < R.length; k++) {
          var r = R[k], qq = Math.max(0, Math.min(1, (e - r.lag) / 0.82)), x = w * qq * (1.08 + r.j);
          if (x > 0) d += 'M0 ' + r.y.toFixed(1) + 'H' + x.toFixed(1) + 'V' + (r.y + r.hh).toFixed(1) + 'H0Z';
        }
      }
      return "path('" + d + "')";
    }
    el.style.opacity = '1';
    setClip(el, path(rev ? 1 : 0));
    var t0 = performance.now();
    function frame(t) {
      if (el._fxRun !== run || (tl && !tl.alive)) return;
      var p = Math.min(1, (t - t0) / Math.max(1, dur));
      if (p >= 1) {
        setClip(el, '');
        if (rev) el.style.opacity = '0';
        if (done) done();
        return;
      }
      var e = EASE(p);
      setClip(el, path(rev ? 1 - e : e));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  var shakeTarget = null;
  function setShakeTarget(el) { shakeTarget = el; }
  function shake(strength) {
    if (!shakeTarget) return;
    var s = strength || 1;
    shakeTarget.animate([
      { transform: 'none' },
      { transform: 'translate(' + (-7 * s) + 'px,' + (4 * s) + 'px)' },
      { transform: 'translate(' + (5 * s) + 'px,' + (-3 * s) + 'px)' },
      { transform: 'translate(' + (-2 * s) + 'px,' + (1 * s) + 'px)' },
      { transform: 'none' }
    ], { duration: 300 });
  }

  // 登場（位移、縮放用獨立的 translate／scale 屬性，不會蓋掉元素本身置中用的 transform）
  function run(el, fx, dur, tl) {
    if (!el) return;
    cancel(el);
    el.style.opacity = '1';
    if (!dur || fx === 'none') return;
    if (fx === 'ink' || fx === 'brush') { clipAnim(el, fx, dur, tl, false); return; }
    if (fx === 'fade') { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: CSS_EASE }); return; }
    if (fx === 'slide') {
      el.animate([{ translate: '0 50px', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: dur, easing: CSS_EASE });
      return;
    }
    if (fx === 'slam') {
      el.animate([
        { scale: '1.7', opacity: 0 },
        { scale: '.97', opacity: 1, offset: 0.6 },
        { scale: '1', opacity: 1 }
      ], { duration: dur, easing: 'cubic-bezier(.5,0,.75,0)' });
      var id = setTimeout(function () { if (!tl || tl.alive) shake(1); }, dur * 0.6);
      if (tl) tl.timers.push(id);
      return;
    }
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: CSS_EASE });
  }

  // 退場：'fade' | 'inkout' | 'brushout' | 'none'
  function out(el, fx, dur, tl, done) {
    if (!el) { if (done) done(); return; }
    if (getComputedStyle(el).opacity === '0') { hide(el); if (done) done(); return; }
    cancel(el);
    if (!dur || fx === 'none') { el.style.opacity = '0'; if (done) done(); return; }
    if (fx === 'inkout') { clipAnim(el, 'ink', dur, tl, true, done); return; }
    if (fx === 'brushout') { clipAnim(el, 'brush', dur, tl, true, done); return; }
    var a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: CSS_EASE, fill: 'forwards' });
    a.onfinish = function () { el.style.opacity = '0'; a.cancel(); if (done) done(); };
  }

  // 登場效果對應的退場效果（墨跡收回）
  function reverseOf(fx) {
    if (fx === 'ink') return 'inkout';
    if (fx === 'brush') return 'brushout';
    if (fx === 'none') return 'none';
    return 'fade';
  }

  // 紙紋雜訊貼圖（底圖質感、文字印刷顆粒）
  var noiseCache = {};
  function noiseTexture(kind) {
    if (noiseCache[kind]) return noiseCache[kind];
    var c = document.createElement('canvas'), x, r;
    if (kind === 'grain') {
      c.width = c.height = 180;
      x = c.getContext('2d');
      var img = x.createImageData(180, 180), d = img.data;
      r = rng(99);
      for (var i = 0; i < d.length; i += 4) d[i + 3] = r() < 0.16 ? 0 : 255; // 16% 小缺墨點
      x.putImageData(img, 0, 0);
    } else {
      // 整張不重複的紙紋：細顆粒＋不規則墨漬暈染
      var Wd = 960, Ht = 540;
      c.width = Wd; c.height = Ht;
      x = c.getContext('2d');
      r = rng(7);
      var im = x.createImageData(Wd, Ht), dd = im.data;
      for (var j = 0; j < dd.length; j += 4) {
        var g = Math.floor(r() * 255);
        dd[j] = dd[j + 1] = dd[j + 2] = g;
        dd[j + 3] = Math.floor(r() * 26);
      }
      x.putImageData(im, 0, 0);
      for (var k = 0; k < 140; k++) {
        var cx = r() * Wd, cy = r() * Ht, rad = 6 + Math.pow(r(), 2.2) * 160;
        var gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        var a = (0.02 + r() * 0.07).toFixed(3);
        gr.addColorStop(0, 'rgba(30,8,8,' + a + ')');
        gr.addColorStop(0.6, 'rgba(30,8,8,' + (a * 0.5).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(30,8,8,0)');
        x.fillStyle = gr;
        x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
      for (var q = 0; q < 30; q++) {
        x.fillStyle = 'rgba(255,230,210,' + (r() * 0.025).toFixed(3) + ')';
        x.beginPath();
        x.arc(r() * Wd, r() * Ht, 2 + r() * 30, 0, 7);
        x.fill();
      }
    }
    noiseCache[kind] = c.toDataURL('image/png');
    return noiseCache[kind];
  }

  // 印章圖片（實心、斑駁）
  var sealCache = {};
  function sealImage(text, ink, color, fontFamily) {
    var key = [text, ink, color, fontFamily].join('|');
    if (sealCache[key]) return sealCache[key];
    var S = 400, c = document.createElement('canvas');
    c.width = c.height = S;
    var x = c.getContext('2d'), r = rng(31);
    x.fillStyle = ink;
    var m = 14, rad = 22;
    x.beginPath();
    x.moveTo(m + rad, m);
    x.arcTo(S - m, m, S - m, S - m, rad);
    x.arcTo(S - m, S - m, m, S - m, rad);
    x.arcTo(m, S - m, m, m, rad);
    x.arcTo(m, m, S - m, m, rad);
    x.closePath();
    x.fill();
    var chars = Array.from(text || '勝');
    x.fillStyle = color;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    var fs = chars.length === 1 ? 250 : chars.length === 2 ? 150 : chars.length <= 4 ? 130 : 90;
    x.font = '900 ' + fs + 'px "' + (fontFamily || 'Noto Serif TC') + '", serif';
    if (chars.length <= 2) {
      x.fillText(chars.join(''), S / 2, S / 2 + fs * 0.04);
    } else {
      var half = Math.ceil(chars.length / 2);
      x.fillText(chars.slice(0, half).join(''), S / 2, S / 2 - fs * 0.52);
      x.fillText(chars.slice(half).join(''), S / 2, S / 2 + fs * 0.56);
    }
    // 斑駁：擦掉一些細點和大片淡區
    x.globalCompositeOperation = 'destination-out';
    for (var i = 0; i < 2600; i++) {
      x.fillStyle = 'rgba(0,0,0,' + (0.25 + r() * 0.6).toFixed(2) + ')';
      x.fillRect(r() * S, r() * S, 1 + r() * 2.5, 1 + r() * 2.5);
    }
    for (var j = 0; j < 7; j++) {
      var gx = r() * S, gy = r() * S, gr = 30 + r() * 70;
      var g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    // 邊緣不規則缺口
    for (var k = 0; k < 40; k++) {
      var side = Math.floor(r() * 4), p = r() * S, rr = 3 + r() * 9;
      var ex = side === 0 ? p : side === 1 ? S - m : side === 2 ? p : m;
      var ey = side === 0 ? m : side === 1 ? p : side === 2 ? S - m : p;
      x.beginPath();
      x.arc(ex, ey, rr, 0, 7);
      x.fill();
    }
    sealCache[key] = c.toDataURL('image/png');
    return sealCache[key];
  }

  function clearSealCache() { sealCache = {}; }

  global.FX = {
    clearSealCache: clearSealCache,
    Timeline: Timeline, run: run, out: out, hide: hide, show: show, cancel: cancel,
    shake: shake, setShakeTarget: setShakeTarget, reverseOf: reverseOf,
    noiseTexture: noiseTexture, sealImage: sealImage, EASE: EASE, CSS_EASE: CSS_EASE
  };
})(window);
