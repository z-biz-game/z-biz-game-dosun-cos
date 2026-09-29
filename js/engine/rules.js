// Dosun-Fuwari（どすんふわり / Nikoli）规则判据，尺寸无关。
// 两条源，逐字对齐后没有分歧：
//   源 A Nikoli EN  https://www.nikoli.co.jp/en/puzzles/dosun_fuwari/
//     "Place one balloon and one iron ball in each of the areas surrounded by bold lines."
//     "Balloons are light and float, so they must be placed in one of the cells at the top,
//      or in a cell right under a black cell or under other balloons."
//     "Iron balls are heavy and sink, so they must be placed in one of the cells at the bottom,
//      or in a cell right over a black cell or over other iron balls."
//   源 B Cross+A  https://www.cross-plus-a.com/puzzles.htm#DosunFuwari
//     同样三条，且明说 "black cells do not belong to any region"。
// 关键读法（两源一致，且被官方例题钉死 —— 见 tools/rule-test.mjs）：
//   "under other balloons" 只认气球，不认铁球 —— 气球不能停在铁球下面。
//   "black cell" 是题面给的涂黑格，和放上去的 "black circle（铁球）" 是两种东西。
// 由此结构自现：把每列按黑格切成若干"段"（segment = 不含黑格的最长竖连），
//   气球必是段的一个**前缀**，铁球必是段的**后缀**，两者不重叠，中间是空格。
//   计数器 js/engine/counter.js 就是按这个结构枚举的，铅笔 js/engine/pencil.js 的
//   N1/N2 两条也是它的直接翻译 —— 判据与两者不是三套规则，是同一套的三种读法。

export const W = 'W';   // 气球 balloon（白圈）
export const B = 'B';   // 铁球 iron ball（黑圈）
export const E = 'E';   // 铅笔里的第三态："空"（不是球，也不留球）

/**
 * @param {number} R 行数 @param {number} C 列数 @param {number[]} black 题面黑格索引列表
 * 索引 i = r * C + c，r 从上往下 0 起。
 */
export function mkBoard(R, C, black) {
  const id = (r, c) => r * C + c;
  const rc = i => [Math.floor(i / C), i % C];
  const inb = (r, c) => r >= 0 && r < R && c >= 0 && c < C;
  const name = i => { const [r, c] = rc(i); return `r${r + 1}c${c + 1}`; };
  const blk = new Set(black);
  const cells = []; for (let i = 0; i < R * C; i++) if (!blk.has(i)) cells.push(i);
  const up = i => { const [r, c] = rc(i); return r > 0 ? id(r - 1, c) : null; };
  const down = i => { const [r, c] = rc(i); return r < R - 1 ? id(r + 1, c) : null; };
  const isBlk = i => i < 0 || i >= R * C || blk.has(i);
  // 段：每列从上往下扫，遇到黑格就断，黑格以下的空格开新段
  const segOf = new Map(); const segs = [];
  for (let c = 0; c < C; c++) {
    let cur = null;
    for (let r = 0; r < R; r++) {
      const i = id(r, c);
      if (blk.has(i)) { cur = null; continue; }
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(i);
      segOf.set(i, cur);
    }
  }
  const topOf = i => segOf.get(i)[0];
  const bottomOf = i => segOf.get(i)[segOf.get(i).length - 1];
  // regions: Map(cell -> regionIndex)；每个非黑格必须属于且仅属于一个区。
  // 比较函数只做数值比较，不掺随机数（见 rng.js 顶部）。
  function regionList(regions) {
    const g = new Map();
    for (const [i, k] of regions) { if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
    return [...g.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => [k, v.sort((a, b) => a - b)]);
  }
  function connected(list) {
    const s = new Set(list); const seen = new Set([list[0]]); const q = [list[0]];
    while (q.length) {
      const [r, c] = rc(q.pop());
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const a = r + dr, b = c + dc;
        if (!inb(a, b)) continue;
        const j = id(a, b);
        if (!s.has(j) || seen.has(j)) continue;
        seen.add(j); q.push(j);
      }
    }
    return seen.size === list.length;
  }

  /**
   * @param {Map<number,number>} regions @param {Map<number,'W'|'B'>} sol
   * @returns {string[]} 违反的条款（0 条 = 合法）。每条自带条款号前缀 R1/R2/R3，
   *   所以"这一条错是哪一条判据抓的"是读数本身，不用再看代码。
   */
  function check(regions, sol) {
    const errs = [];
    // R1 题面合法性：球只能落在属于某个区的格子上，且每个区恰好 1 气球 1 铁球、区连通
    for (const i of sol.keys()) {
      if (blk.has(i)) errs.push(`R1 ${name(i)} 是题面黑格，不能放球`);
      else if (!regions.has(i)) errs.push(`R1 ${name(i)} 放了球却不在任何区里`);
    }
    for (const i of cells) if (!regions.has(i)) errs.push(`R1 ${name(i)} 不在任何区里`);
    for (const [k, list] of regionList(regions)) {
      if (!connected(list)) errs.push(`R1 区 ${k}（${list.map(name).join(',')}）不连通`);
      const w = list.filter(i => sol.get(i) === W), b = list.filter(i => sol.get(i) === B);
      if (w.length !== 1) errs.push(`R1 区 ${k} 要恰好 1 个气球，实际 ${w.length}（${list.map(name).join(' ')}）`);
      if (b.length !== 1) errs.push(`R1 区 ${k} 要恰好 1 个铁球，实际 ${b.length}（${list.map(name).join(' ')}）`);
    }
    // R2 浮：气球上面（同段）必须是气球 / 黑格 / 段顶
    // R3 沉：铁球下面（同段）必须是铁球 / 黑格 / 段底
    for (const [i, v] of sol) {
      if (blk.has(i) || !segOf.has(i)) continue;
      const msg = j => j === null ? '边界' : blk.has(j) ? '题面黑格' : name(j);
      if (v === W) {
        const a = up(i);
        if (a !== null && !blk.has(a) && sol.get(a) !== W) errs.push(`R2 ${name(i)} 是气球，但它上面 ${msg(a)} 既不是气球也不是黑格/顶`);
      } else if (v === B) {
        const z = down(i);
        if (z !== null && !blk.has(z) && sol.get(z) !== B) errs.push(`R3 ${name(i)} 是铁球，但它下面 ${msg(z)} 既不是铁球也不是黑格/底`);
      }
    }
    return errs;
  }

  return { R, C, id, rc, inb, name, cells, black: blk, up, down, isBlk, segs, segOf, topOf, bottomOf, regionList, connected, check };
}

/** 邻格（不含题面黑格）。判据里"区必须连通"和出题器生长区域用的是同一个邻接。 */
export const neighbors = (B_, i) => {
  const [r, c] = B_.rc(i), o = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const a = r + dr, b = c + dc;
    if (B_.inb(a, b)) o.push(B_.id(a, b));
  }
  return o.filter(j => !B_.black.has(j));
};
