'use strict';
// M1：賽事狀態管理與自動存檔
// - 所有修改都透過 apply(ops) 進行，全部成功才生效（不會只改一半）
// - 每次修改後 250ms 內寫入硬碟（先寫暫存檔再改名，避免斷電寫壞）
// - 每 5 分鐘另存備份，保留最近 20 份
// - 啟動時若主檔損壞，自動從最新的備份恢復

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { defaultState } = require('./default-state');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 只補上缺少的欄位，不覆蓋已存在的值（讓舊存檔升級到新版欄位）
function fillDefaults(target, defaults) {
  for (const key of Object.keys(defaults)) {
    if (!(key in target)) target[key] = structuredClone(defaults[key]);
    else if (isPlainObject(target[key]) && isPlainObject(defaults[key])) fillDefaults(target[key], defaults[key]);
  }
  return target;
}

function validatePath(p) {
  if (!Array.isArray(p)) throw new Error('path 必須是陣列');
  for (const k of p) {
    if (typeof k === 'number') {
      if (!Number.isInteger(k) || k < 0) throw new Error('陣列索引必須是非負整數');
    } else if (typeof k === 'string') {
      if (FORBIDDEN_KEYS.has(k)) throw new Error('不允許的欄位名稱：' + k);
    } else {
      throw new Error('path 只能包含字串或整數');
    }
  }
}

function getParent(root, p, create) {
  let node = root;
  for (let i = 0; i < p.length - 1; i++) {
    const k = p[i];
    if (node[k] === undefined || node[k] === null) {
      if (!create) throw new Error('找不到路徑：' + p.slice(0, i + 1).join('.'));
      node[k] = typeof p[i + 1] === 'number' ? [] : {};
    }
    node = node[k];
    if (typeof node !== 'object') throw new Error('路徑中間不是物件：' + p.slice(0, i + 1).join('.'));
  }
  return node;
}

function getAt(root, p) {
  let node = root;
  for (const k of p) {
    if (node === undefined || node === null) return undefined;
    node = node[k];
  }
  return node;
}

function applyOne(state, op) {
  if (!op || typeof op !== 'object') throw new Error('op 格式錯誤');
  const p = op.path;
  validatePath(p);
  switch (op.op) {
    case 'set': {
      if (p.length === 0) throw new Error('set 需要路徑');
      const parent = getParent(state, p, true);
      parent[p[p.length - 1]] = structuredClone(op.value);
      break;
    }
    case 'delete': {
      if (p.length === 0) throw new Error('delete 需要路徑');
      const parent = getParent(state, p, false);
      const k = p[p.length - 1];
      if (Array.isArray(parent)) parent.splice(k, 1);
      else delete parent[k];
      break;
    }
    case 'push': {
      const arr = p.length ? getAt(state, p) : state;
      if (!Array.isArray(arr)) throw new Error('push 的目標不是陣列');
      arr.push(structuredClone(op.value));
      break;
    }
    case 'insert': {
      const arr = getAt(state, p);
      if (!Array.isArray(arr)) throw new Error('insert 的目標不是陣列');
      const i = op.index;
      if (!Number.isInteger(i) || i < 0 || i > arr.length) throw new Error('insert 位置超出範圍');
      arr.splice(i, 0, structuredClone(op.value));
      break;
    }
    case 'move': {
      const arr = getAt(state, p);
      if (!Array.isArray(arr)) throw new Error('move 的目標不是陣列');
      const { from, to } = op;
      if (![from, to].every(n => Number.isInteger(n) && n >= 0 && n < arr.length)) throw new Error('move 位置超出範圍');
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      break;
    }
    default:
      throw new Error('未知的 op：' + op.op);
  }
}

function writeFileAtomic(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Windows 上防毒軟體偶爾會暫時鎖住檔案，重試幾次
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i === 4) {
        fs.copyFileSync(tmp, file);
        fs.unlinkSync(tmp);
        return;
      }
      const until = Date.now() + 30;
      while (Date.now() < until) { /* 短暫等待 */ }
    }
  }
}

function stamp(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

class Store extends EventEmitter {
  constructor(dataDir, opts = {}) {
    super();
    this.dataDir = dataDir;
    this.assetsDir = path.join(dataDir, 'assets');
    this.backupsDir = path.join(dataDir, 'backups');
    this.file = path.join(dataDir, 'state.json');
    this.saveDelay = opts.saveDelay ?? 250;
    this.backupEvery = opts.backupEvery ?? 5 * 60 * 1000;
    this.keepBackups = opts.keepBackups ?? 20;
    this.rev = 0;
    this.savedRev = 0;
    this.backedUpRev = -1;
    this.saveTimer = null;
    this.backupTimer = null;
    this.loadedFrom = null;
    for (const d of [dataDir, this.assetsDir, this.backupsDir]) fs.mkdirSync(d, { recursive: true });
    this.load();
  }

  load() {
    const tryRead = file => {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!isPlainObject(parsed) || !isPlainObject(parsed.state)) return null;
        return parsed;
      } catch {
        return null;
      }
    };
    let loaded = fs.existsSync(this.file) ? tryRead(this.file) : null;
    if (loaded) this.loadedFrom = 'state';
    else {
      for (const name of this.listBackups()) {
        loaded = tryRead(path.join(this.backupsDir, name));
        if (loaded) {
          this.loadedFrom = 'backup:' + name;
          if (fs.existsSync(this.file)) {
            try { fs.copyFileSync(this.file, this.file + '.broken-' + stamp()); } catch { /* 保留損壞檔供檢查 */ }
          }
          break;
        }
      }
    }
    if (loaded) {
      this.state = fillDefaults(loaded.state, defaultState());
      this.rev = Number.isInteger(loaded.rev) ? loaded.rev : 0;
    } else {
      this.state = defaultState();
      this.rev = 0;
      this.loadedFrom = 'default';
    }
    this.savedRev = this.rev;
    if (this.loadedFrom !== 'state') this.saveNow();
  }

  snapshot() {
    return { rev: this.rev, state: this.state };
  }

  apply(ops) {
    if (!Array.isArray(ops) || ops.length === 0) throw new Error('ops 必須是非空陣列');
    const next = structuredClone(this.state);
    for (const op of ops) applyOne(next, op);
    this.state = next;
    this.rev++;
    this.emit('change', this.rev, ops);
    this.scheduleSave();
    return this.rev;
  }

  replaceState(state) {
    if (!isPlainObject(state)) throw new Error('state 格式錯誤');
    this.state = fillDefaults(structuredClone(state), defaultState());
    this.rev++;
    this.emit('replace', this.rev);
    this.saveNow();
    return this.rev;
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, this.saveDelay);
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const payload = JSON.stringify({ rev: this.rev, savedAt: new Date().toISOString(), state: this.state }, null, 2);
    writeFileAtomic(this.file, payload);
    this.savedRev = this.rev;
    this.emit('saved', this.rev);
  }

  listBackups() {
    try {
      return fs.readdirSync(this.backupsDir).filter(n => /^state-.*\.json$/.test(n)).sort().reverse();
    } catch {
      return [];
    }
  }

  backupNow(force = false) {
    if (!force && this.backedUpRev === this.rev) return null;
    if (this.savedRev !== this.rev) this.saveNow();
    let name = `state-${stamp()}.json`;
    let n = 1;
    while (fs.existsSync(path.join(this.backupsDir, name))) name = `state-${stamp()}-${n++}.json`;
    fs.copyFileSync(this.file, path.join(this.backupsDir, name));
    this.backedUpRev = this.rev;
    for (const old of this.listBackups().slice(this.keepBackups)) {
      try { fs.unlinkSync(path.join(this.backupsDir, old)); } catch { /* 忽略 */ }
    }
    this.emit('backup', name);
    return name;
  }

  restoreBackup(name) {
    if (!/^state-[\w-]+\.json$/.test(name)) throw new Error('備份名稱不正確');
    const file = path.join(this.backupsDir, name);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isPlainObject(parsed) || !isPlainObject(parsed.state)) throw new Error('備份檔內容不正確');
    this.backupNow(true);
    return this.replaceState(parsed.state);
  }

  startBackups() {
    this.backupNow(true);
    this.backupTimer = setInterval(() => {
      try { this.backupNow(); } catch (e) { this.emit('error-log', e); }
    }, this.backupEvery);
    this.backupTimer.unref?.();
  }

  close() {
    if (this.backupTimer) clearInterval(this.backupTimer);
    if (this.saveTimer || this.savedRev !== this.rev) this.saveNow();
  }
}

module.exports = { Store, applyOne, fillDefaults };
