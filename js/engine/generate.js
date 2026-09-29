// 出题器：**构造**而不是撞运气。三步走，每一步都只造合法的东西，所以起手就一定有解
// （铺下去的那把球本身就是这张盘的一个解）。
//   1. 铺球 layPair —— 每段选 (k 个气球压顶, m 个铁球沉底)，全局 Σ气球 = Σ铁球 = 区数。
//      这一步的产物直接满足 R2/R3，因为气球是段前缀、铁球是段后缀。
//   2. 长区 growPairs —— 从没划走的气球挑一个当种子往外撑，撑到吃进一个铁球就收口。
//      撑的时候只吃空格和铁球、绝不吃别的气球，所以"每区恰好 1 气球 1 铁球"是构造出来的。
//      收口时断言一条必要条件：**剩下的空格每个连通块里 气球数 == 铁球数**。
//      区是连通的、跨不了连通块，哪块不平衡就永远配不完 —— 当场作废、换撑法。
//   3. 挖唯一 dig / digForced —— 作者动作一次挪一条边界（把一格从 X 区划给邻着的 Y 区），
//      按"离唯一解更近没有"打分。区里有没有球、球在哪，是**解**的事，作者不管。
//
// 为什么不是另外两条路（都在原型上量过，两条都是死路，别再试）：
//   随机画区 -> 数解：5x5 黑格4/NR=5 起手 8/10 盘 0 解。判据把"哪个区拿气球"钉在列的
//     前缀上、"哪个区拿铁球"钉在列的后缀上，随机边界几乎必然让某个区两头都够不到 ——
//     盘直接作废，挪边界救不回来（0 解不是"进步空间"，是死盘）。
//   随机铺球 -> 随机生成树切区：NR>=6 时 30 棵树全 DP 无解。切边要求孩子那半边正好
//     1 气球 1 铁球，随机生成树的球序经常凑不出来。
//   还有一条更早的死路："气球必须和紧邻的铁球配对" —— 官方 4x4 例题自己就否掉了：
//     它的 B1 气球四邻里没有铁球，本区铁球在 D1（隔一格）。所以区是"撑出来的一片"。
//
// 确定性：本文件**不读任何墙钟**（Date.now / performance.now 都不许出现），
// 熵只从注入的 rnd 来，比较函数里不掺随机数 —— 同一种子在 node 和 Chrome 长同一张盘。
// 耗时统计是闸的事（tools/generator-probe.mjs 在调用处计时）。

import { mkBoard, W, B, E, neighbors } from './rules.js';
import { segOptions, count as countExhaustive } from './counter.js';
import { pencil, initCand } from './pencil.js';
import { shuffled, pick, mulberry } from './rng.js';

// 计数器在两个挖法里都是热路径；就地薄封装，省掉到处传 opts 对象。
const count_ = (B_, reg, cap, maxSol) => countExhaustive(B_, reg, { cap, maxSol });

/**
 * 第一步：铺一把合法的球。
 * @param {ReturnType<typeof mkBoard>} B_ @param {()=>number} rnd @param {number} NR 区数
 * @param {number} cap DFS 节点预算 @param {number} KCAP 一段最多几个气球 / 几个铁球
 * @returns {Map<number,'W'|'B'>|null} 铺出来的球（这张盘的一个解），铺不出则 null
 */
export function layPair(B_, rnd, NR, cap = 20000, KCAP = 2) {
  // KCAP 这个上限为什么必须有：不设它时 DFS 找到的第一个可行解往往是
  // "整盘 4 个气球全叠在同一段的顶上、4 个铁球全叠在同一段的底下"——那样每对球之间
  // 隔着满列的球，通路怎么走都被别的球堵死（原型实测 NR=4 只有 4/20 长得出区）。
  const opts = B_.segs.map(s => segOptions(s)
    .map(a => ({ a, w: a.filter(([, v]) => v === W).length, b: a.filter(([, v]) => v === B).length }))
    .filter(o => o.w <= KCAP && o.b <= KCAP));
  const acc = [];
  let nodes = 0;
  const go = (i, dw, db) => {
    if (++nodes > cap) return false;
    if (i === opts.length) return dw === 0 && db === 0;
    for (const k of shuffled([...opts[i].keys()], rnd)) {
      const o = opts[i][k];
      if (o.w > dw || o.b > db) continue;
      acc.push(...o.a);
      if (go(i + 1, dw - o.w, db - o.b)) return true;
      for (let n = 0; n < o.a.length; n++) acc.pop();
    }
    return false;
  };
  return go(0, NR, NR) ? new Map(acc) : null;
}

/**
 * 第二步：把铺好的球圈成"每区恰 1 气球 1 铁球"的连通区。
 * @returns {Map<number,number>|null} cell -> 区号（0..NR-1，区号在生长过程中直接发）
 */
export function growPairs(B_, sol, rnd, { tries = 300, maxGrow = 7 } = {}) {
  const cells = B_.cells;
  const v = i => sol.get(i);
  for (let a = 0; a < tries; a++) {
    const reg = new Map();
    let k = 0, ok = true;
    const un = () => cells.filter(i => !reg.has(i));
    // 收口断言：剩下的空格每块连通域里 气球数 == 铁球数（区跨不了连通块）
    const balanced = () => {
      const left = new Set(un()), vis = new Set();
      for (const s of left) {
        if (vis.has(s)) continue;
        const comp = [s]; vis.add(s);
        for (let p = 0; p < comp.length; p++) for (const j of neighbors(B_, comp[p])) if (left.has(j) && !vis.has(j)) { vis.add(j); comp.push(j); }
        if (comp.filter(i => v(i) === W).length !== comp.filter(i => v(i) === B).length) return false;
      }
      return true;
    };
    for (const w of shuffled(cells.filter(i => v(i) === W), rnd)) {
      if (reg.has(w)) { ok = false; break; }
      reg.set(w, k);
      const inR = new Set([w]);
      let hasB = false;
      for (let g = 0; g < maxGrow; g++) {
        if (hasB && rnd() < 0.5) break;
        const fr = [...new Set([...inR].flatMap(i => neighbors(B_, i)))].filter(i => !reg.has(i));
        const bs = hasB ? [] : fr.filter(i => v(i) === B);
        const empt = fr.filter(i => !v(i));
        const take = bs.length && (g >= 1 || rnd() < 0.4) ? pick(bs, rnd) : empt.length ? pick(empt, rnd) : null;
        if (take === undefined || take === null) { if (!hasB) ok = false; break; }
        reg.set(take, k); inR.add(take);
        if (v(take) === B) hasB = true;
      }
      if (!ok || !hasB || !balanced()) { ok = false; break; }
      k++;
    }
    if (!ok) continue;
    // 剩下的"无球格"随机划给紧挨着的区：每划一格都保证该区仍连通，且不会动到球数
    for (let guard = 0; guard <= cells.length; guard++) {
      const opts = [];
      for (const i of un()) for (const j of neighbors(B_, i)) if (reg.has(j)) opts.push([i, reg.get(j)]);
      if (!opts.length) break;
      const [i, kk] = pick(opts, rnd);
      reg.set(i, kk);
    }
    if (un().length) continue;
    if (B_.check(reg, sol).length) continue;   // DP 说合法不等于真合法：再过一遍判据当最后一道
    return reg;
  }
  return null;
}

/** 第 1~2 步合起来 = 造一个起手就有解的盘。铺不出/长不出就换种子重开（最多 60 次）。 */
export function makeBoard(R, C, NB, NR, rnd) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const black = shuffled([...Array(R * C).keys()], rnd).slice(0, NB);
    const B_ = mkBoard(R, C, black);
    const sol = layPair(B_, rnd, NR);
    if (!sol) continue;
    const reg = growPairs(B_, sol, rnd);
    if (!reg) continue;
    return { B_, sol, reg, black };
  }
  return null;
}

// ---------- 第三步：挖唯一 ----------
/** 所有"合法的一刀"：把 e 从 X 区划给邻着的 Y 区，只要 X\{e} 还连通非空（Y 邻着 e，并进去必然连通）。 */
function* movesOf(B_, reg) {
  const byReg = new Map();
  for (const [i, k] of reg) { if (!byReg.has(k)) byReg.set(k, []); byReg.get(k).push(i); }
  for (const e of B_.cells) {
    const X = reg.get(e);
    const rest = byReg.get(X).filter(i => i !== e);
    if (!rest.length || !B_.connected(rest)) continue;
    for (const nb of neighbors(B_, e)) { const Y = reg.get(nb); if (Y !== undefined && Y !== X) yield { e, to: Y }; }
  }
}
const applyMove = (reg, m) => new Map([...reg].map(([i, k]) => [i, i === m.e ? m.to : k]));

/**
 * 读数 -> 这一刀值不值。
 * 0 解 = 题面直接作废，和"没数完"一样不能算进步（原型第一版把 0 当成最好，
 * 结果 greedy 一路朝无解挖，台阶 21→0→0→… 看着像收敛，其实盘已经死了）。
 */
export const keyOf = r => !r || r.bounded ? Infinity : r.solutions === 1 ? 1 : r.solutions === 0 ? Infinity : r.solutions;

/** 按**解数**挖：每刀都要把整盘穷尽一次。 */
export function dig(B_, reg0, rnd, { ARM = 'greedy', MAXMUT = 20, cap = 200000, maxSol = 40, deepen = false } = {}) {
  let reg = new Map(reg0), probes = 0;
  const ladder = [];
  const stop = r => !r.bounded && r.solutions === 1 && (!deepen || pencil(B_, reg, initCand(B_)).solved);
  for (let step = 0; ; step++) {
    const r = count_(B_, reg, cap, maxSol);
    ladder.push(r.read);
    if (stop(r)) return { reg, r, step, ladder, probes, state: '达成' };
    if (step > MAXMUT) return { reg, r, step, ladder, probes, state: '步数用完' };
    const ms = [...movesOf(B_, reg)];
    if (!ms.length) return { reg, r, step, ladder, probes, state: '无路可挪' };
    let chosen = null;
    if (ARM === 'greedy') {
      let best = null;
      for (const m of shuffled(ms, rnd)) {
        const rr = count_(B_, applyMove(reg, m), cap, maxSol); probes++;
        const key = keyOf(rr);
        if (best === null || key < best.key) best = { m, key };
        if (key === 1) break;
      }
      if (!best || best.key === Infinity) return { reg, r, step, ladder, probes, state: '挪不动' };
      chosen = best.m;
    } else {
      const legal = ms.filter(m => keyOf(count_(B_, applyMove(reg, m), cap, maxSol)) !== Infinity);
      if (!legal.length) return { reg, r, step, ladder, probes, state: '没有不作废的挪法' };
      chosen = pick(legal, rnd);
    }
    reg = applyMove(reg, chosen);
  }
}

/**
 * 按**推理进度**挖：每刀只跑一次铅笔（多项式），推得动 = 这一刀在把盘收紧；
 * 等铅笔**推满**了再数一遍计数器（那是整盘唯一一次穷尽），数出 1 就出货。
 * 为什么不是按解数（上面的 dig）：解数是一把"全局穷尽"的读数，为了知道"这一刀有没有
 * 让盘更接近唯一"，每一刀都要把整盘数完 —— 代价付在搜索里，而且读数在 maxSol 就饱和，
 * 梯度直接是平的。
 * @param {{MAXMUT?:number,cap?:number,maxSol?:number}} o
 */
export function digForced(B_, reg0, rnd, { MAXMUT = 40, cap = 400000, maxSol = 400 } = {}) {
  let reg = new Map(reg0), probes = 0;
  const ladder = [];
  let p = pencil(B_, reg, initCand(B_));
  for (let step = 0; ; step++) {
    ladder.push(p.forced);
    if (p.solved) {
      const r = count_(B_, reg, cap, maxSol);
      if (!r.bounded && r.solutions === 1) return { reg, r, p, step, ladder, probes, state: '达成' };
      if (r.bounded) return { reg, r, p, step, ladder, probes, state: '推满但没数完' };
      // 推满却不唯一 = 铅笔在不该推满的盘上推满了（有规则在猜）。这不是"再挖一刀"的事，要红。
      return { reg, r, p, step, ladder, probes, state: '**推满却多解**' };
    }
    if (step > MAXMUT) return { reg, r: null, p, step, ladder, probes, state: '步数用完' };
    const ms = [...movesOf(B_, reg)];
    if (!ms.length) return { reg, r: null, p, step, ladder, probes, state: '无路可挪' };
    let best = null;
    for (const m of shuffled(ms, rnd)) {
      const cand = applyMove(reg, m);
      const pp = pencil(B_, cand, initCand(B_)); probes++;
      // 死盘（铅笔报矛盾）当然不要；但"盘还活着却一刀都推不动"（forced 归零）也是死路：
      // 原型第一版把它当成"和上一刀一样差"就地止步，台阶卡在 6/21 再也上不去。
      const key = pp.contradiction ? -Infinity : pp.forced;
      if (best === null || key > best.key) best = { m, key, p: pp };
      if (pp.solved) break;
    }
    if (!best || best.key === -Infinity) return { reg, r: null, p, step, ladder, probes, state: '挪不动' };
    if (best.key < p.forced) return { reg, r: null, p, step, ladder, probes, state: '挖不上去' };
    reg = applyMove(reg, best.m); p = best.p;
  }
}

// ---------- 独立裁判：3^n 全枚举 + 判据 check() ----------
/**
 * 计数器按"段前缀/后缀"走了捷径，判据按三条规则逐格验 —— 两条路对不上就是计数器写坏了。
 * 只在格数 <= LIMIT 的盘上跑（3^16 = 4300 万，秒级；再大就是分钟级，闸不能这么慢）。
 */
export const BRUTE_LIMIT = 16;
export function bruteCount(B_, reg, { limit = BRUTE_LIMIT } = {}) {
  const cells = B_.cells;
  if (cells.length > limit) return null;      // null = "这个盘太大，不派独立裁判"，不是"0 解"
  const assign = new Map();
  let n = 0;
  const rec = i => {
    if (i === cells.length) { if (!B_.check(reg, assign).length) n++; return; }
    for (const v of [W, B, E]) { if (v === E) assign.delete(cells[i]); else assign.set(cells[i], v); rec(i + 1); }
    assign.delete(cells[i]);
  };
  rec(0);
  return n;
}

// ---------- 一次尝试 = 造盘 + 挖唯一 + 铅笔复核 ----------
/**
 * 与原型同式的种子派生（SEED*100003 + att*7919 + NR*31 + NB*17），
 * 刻意不改成 hash，为了迁移期的读数能和原型逐项对齐。
 */
export const seedFor = (SEED, att, NR, NB) => SEED * 100003 + att * 7919 + NR * 31 + NB * 17;

/**
 * @param {{R:number,C:number,NB:number,NR:number,seed:number,att:number,
 *   ARM?:'greedy'|'random',MAXMUT?:number,cap?:number,maxSol?:number,deepen?:boolean,
 *   arm?:'forced',brute?:boolean}} cfg
 * @returns {{shipped:boolean,reason:string,B_:null|Map,reg:null|Map,r:null|object,p:null|object,
 *   att:number,step:number,probes:number,ladder:string[]}}
 */
export function shipAttempt(cfg) {
  const { R, C, NB, NR, seed, att = 0, ARM = 'greedy', MAXMUT = 40, cap = 400000, maxSol = 400, deepen = false, arm, brute = false } = cfg;
  const rnd = mulberry(seedFor(seed, att, NR, NB));
  const m = makeBoard(R, C, NB, NR, rnd);
  if (!m) return { shipped: false, made: false, reason: '造不出盘', B_: null, reg: null, r: null, p: null, att, step: 0, probes: 0, ladder: [] };
  const d = arm === 'forced'
    ? digForced(m.B_, m.reg, rnd, { MAXMUT, cap, maxSol })
    : dig(m.B_, m.reg, rnd, { ARM, MAXMUT, cap, maxSol, deepen });
  const p = d.p || pencil(m.B_, d.reg, initCand(m.B_));
  // 读数一并带出去：闸要在"没出货"的盘上统计 liar（不唯一的盘铅笔也不许推满）
  const base = { made: true, B_: m.B_, reg: d.reg, r: d.r, p, att, step: d.step, probes: d.probes, ladder: d.ladder };
  if (!d.r) return { ...base, shipped: false, reason: `挖不出唯一（${d.state}）` };
  if (d.state !== '达成') return { ...base, shipped: false, reason: d.state };
  if (!p.solved) return { ...base, shipped: false, reason: '唯一但铅笔推不满' };
  if (brute) {
    const bf = bruteCount(m.B_, d.reg);
    if (bf !== null && bf !== 1) return { ...base, shipped: false, reason: `计数器 1 解 vs 3^n 全枚举 ${bf} 解` };
  }
  return { ...base, shipped: true, reason: '出货' };
}

/**
 * 出货：从 seed 起逐次尝试，直到有一张"唯一解 且 铅笔推满"的盘（这是"换一局"按下去的路径）。
 * @returns {ReturnType<typeof shipAttempt>|null} 全刷光返回 null
 */
export function shipOne(cfg) {
  const { seed = 1, attempts = 200 } = cfg;
  for (let att = 0; att < attempts; att++) {
    const s = shipAttempt({ ...cfg, att });
    if (s.shipped) return s;
  }
  return null;
}


/** 盘面指纹（区表 + 黑格），给"同种子重放必须同一张盘"的闸用。 */
export function boardKey(B_, reg) {
  const black = [...B_.black].sort((a, b) => a - b).join(',');
  const cells = B_.cells.map(i => `${i}:${reg === undefined ? '-' : reg.get(i)}`).join(',');
  return `${B_.R}x${B_.C}|${B_.cells.length}|黑[${black}]|${cells}`;
}
