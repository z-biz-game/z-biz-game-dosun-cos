// 存档解码：两段式，一条坏记录只丢那一条。
//
// 为什么不能一把 `Object.assign(defaults, JSON.parse(raw))`：
//   localStorage 里躺着什么都有可能 —— 半个 JSON、上一个版本的结构、被别的扩展改写的字段、
//   用户在开发者工具里手敲的 null。一把合并的后果是"整局冻死"：解析抛异常 ⇒ 页面停在
//   没有 game 的状态，而玩家看到的是"我打了半天的档没了"。
//   所以这里分两段：
//     第一段（语法）：JSON.parse 失败 ⇒ 当成空档，页面照常起，坏字节留在原地不动。
//     第二段（记录）：每条记录单独验形（best 的每一项、进行中的那一局各自独立），
//                     不合格的那一条丢掉，同层的其它条目照常可用。
// 这个模块**不碰 DOM、不碰 localStorage**：storage 由调用方注入，于是 node 里能直接
// 拿垃圾档样本实测（tools/assets-test.mjs 不管这块，实测脚本走 /tmp harness）。

export const STORE_KEY = 'dosun-cos:v1';
export const STORE_VERSION = 2;

const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** 第一段：语法。返回 {ok, value}，坏 JSON 不抛。 */
export function parseJson(raw) {
  if (typeof raw !== 'string' || !raw.length) return { ok: true, value: {} };
  try {
    const v = JSON.parse(raw);
    // JSON.parse('null') 是合法语法但值是 null —— 那正是 Object.assign(default, null) 不报错
    // 却把默认值整个吞掉的入口。
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, value: null };
    return { ok: true, value: v };
  } catch {
    return { ok: false, value: null };
  }
}

/** best 的一条纪录：只认 {ms,moves,size} 三个字段，越界或类型错 ⇒ 这一条丢（返回 null）。 */
export function decodeBestRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!isNum(rec.ms, 0, 1000 * 60 * 60 * 6)) return null;           // 6 小时封顶：再长就是脏数据
  if (!isInt(rec.moves, 0, 100000)) return null;
  if (!isStr(rec.size, 12)) return null;
  return { ms: rec.ms, moves: rec.moves, size: rec.size };
}

/** 进行中的一局：cells 是 [格号, 状态] 的表；状态只允许 null|'W'|'B'|'E'。 */
export function decodeGameRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!isStr(rec.tier, 24)) return null;
  if (!isInt(rec.seed, 1, 2 ** 31 - 1)) return null;
  if (!isInt(rec.R, 1, 64) || !isInt(rec.C, 1, 64)) return null;
  if (!isNum(rec.elapsedMs, 0, 1000 * 60 * 60 * 6) || !isInt(rec.moves, 0, 100000)) return null;
  if (!Array.isArray(rec.cells) || rec.cells.length > 64 * 64) return null;
  const cells = [];
  const dropped = [];
  for (const pair of rec.cells) {
    // 单格坏 ⇒ 只丢那一格（盘还在，不至于整局作废）；整局坏才由上面的验形返回 null。
    if (!Array.isArray(pair) || pair.length !== 2 || !isInt(pair[0], 0, 64 * 64)) { dropped.push(pair); continue; }
    const v = pair[1];
    if (!(v === null || v === 'W' || v === 'B' || v === 'E')) { dropped.push(pair); continue; }
    cells.push([pair[0], v]);
  }
  return { tier: rec.tier, seed: rec.seed, R: rec.R, C: rec.C, elapsedMs: rec.elapsedMs, moves: rec.moves, cells, dropped: dropped.length };
}

/**
 * 整份档的解码：坏记录逐条丢，好记录逐条留。
 * @param {string|null} raw localStorage 里的原始字符串
 * @returns {{version:number,cursor:number,best:object,game:null|object,dropped:string[]}}
 */
export function decodeStore(raw) {
  const dropped = [];
  const { ok, value } = parseJson(raw);
  if (!ok) return { version: STORE_VERSION, cursor: 1, best: {}, game: null, dropped: ['root:unparseable'] };
  const out = { version: STORE_VERSION, cursor: 1, best: {}, game: null, dropped };

  if (isInt(value.cursor, 1, 2 ** 31 - 1)) out.cursor = value.cursor;
  else if (value.cursor !== undefined) { dropped.push('cursor'); }

  if (value.best && typeof value.best === 'object' && !Array.isArray(value.best)) {
    for (const [id, rec] of Object.entries(value.best)) {
      if (!isStr(id, 24)) { dropped.push('best:' + String(id).slice(0, 8)); continue; }
      const r = decodeBestRecord(rec);
      if (!r) { dropped.push('best:' + id); continue; }
      out.best[id] = r;
    }
  } else if (value.best !== undefined) dropped.push('best');

  if (value.game !== undefined) {
    const g = decodeGameRecord(value.game);
    if (g) out.game = g;
    else dropped.push('game');
  }
  return out;
}

/** 编码：只写这个版本认得的结构（解码端与编码端共用同一套字段名）。 */
export function encodeStore(s) {
  return JSON.stringify({
    version: STORE_VERSION,
    cursor: s.cursor,
    best: s.best,
    game: s.game || null,
  });
}

/** 注入式 storage：浏览器传 localStorage，实测传一个内存假件。 */
export function makeStore(storage) {
  const read = () => {
    let raw = null;
    try { raw = storage ? storage.getItem(STORE_KEY) : null; } catch { return { broken: true, data: empty() }; }
    return { broken: false, data: decodeStore(raw) };
  };
  const empty = () => ({ version: STORE_VERSION, cursor: 1, best: {}, game: null, dropped: [] });
  const write = data => {
    try { storage && storage.setItem(STORE_KEY, encodeStore(data)); return true; } catch { return false; }
  };
  return {
    read,
    write,
    cursor() { return read().data.cursor; },
    setCursor(c) { const { data } = read(); data.cursor = c; write(data); },
    best(id) { return read().data.best[id] || null; },
    allBest() { return read().data.best; },
    game() { return read().data.game; },
    setGame(g) { const { data } = read(); data.game = g; write(data); },
    clearGame() { const { data } = read(); data.game = null; write(data); },
    record(id, r) {
      const { data } = read();
      const prev = data.best[id];
      if (!prev || r.ms < prev.ms) { data.best[id] = r; write(data); return !prev || r.ms < prev.ms; }
      return false;
    },
    reset() { try { storage && storage.removeItem(STORE_KEY); return true; } catch { return false; } },
  };
}
