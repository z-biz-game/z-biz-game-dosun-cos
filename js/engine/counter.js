// 穷尽计数器：一张盘到底有几个解。按"段"枚举，不走 3^n 的全格枚举。
// 依据是判据 R2/R3 的直接推论（见 rules.js 顶部）：把每列按题面黑格切成段之后，
//   气球必是段的一个**前缀**（贴着段顶往下连），铁球必是段的**后缀**（贴着段底往上连），
//   两者不重叠、中间留空。所以一段的可行形状只有 (前缀长 k, 后缀长 m) 且 k+m<=段长，
//   枚举量从 3^格数 掉到 每段 O(L^2) 的组合。
// 三段剪枝：
//   1) 同区内同类球超过 1 颗立刻回退（R1 的"恰好一个"）
//   2) suf[i] = 第 i 段往后还能碰到哪些区；某个区的气球/铁球名额还没满、
//      而后面所有段都碰不到它了 —— 直接回退（这个区再也补不齐）
//   3) 两个出口：解数到 maxSol 就"饱和"（stopped），节点数到 cap 就"预算耗尽"（capped）
// 三种终读**必须互相区分得开**，这是闸要盯的（tools/counter-test.mjs）：
//   "3"      穷尽，恰好 3 解
//   "0"      穷尽，**死盘**（题面自相矛盾，一个解都没有）—— 绝不许当成"唯一"
//   "≥60"    饱和：只说明"至少 60 解"，这张盘没被证唯一，也没被证死
//   "≥2(预算耗尽)" 没数完：同上，什么结论都不给
// 出题器的判据 keyOf 因此把 bounded 和 solutions===0 一起打成 Infinity（不能算进步）。

import { W, B } from './rules.js';

/** 一段的全部可行 (前缀气球, 后缀铁球) 形状，每种是 [cell, 身份] 列表。 */
export function segOptions(seg) {
  const L = seg.length, out = [];
  for (let k = 0; k <= L; k++) for (let m = 0; k + m <= L; m++) {
    const assign = [];
    for (let p = 0; p < k; p++) assign.push([seg[p], W]);
    for (let q = 0; q < m; q++) assign.push([seg[L - 1 - q], B]);
    out.push(assign);
  }
  return out;
}

/**
 * @param {ReturnType<import('./rules.js').mkBoard>} B_
 * @param {Map<number,number>} regions cell -> 区号（区号须是 0..n-1，出题器就是这么发的）
 * @param {{cap?:number,maxSol?:number}} opts cap = 节点预算，maxSol = 解数饱和阈值
 * @returns {{solutions:number,capped:boolean,stopped:boolean,bounded:boolean,dead:boolean,
 *   unique:boolean,read:string,nodes:number,sols:Map[],maxSol:number,cap:number}}
 */
export function count(B_, regions, { cap = 400000, maxSol = 60 } = {}) {
  const nReg = Math.max(...regions.values()) + 1;
  const opts = B_.segs.map(s => segOptions(s));
  const touch = opts.map(o => { const t = new Set(); for (const a of o) for (const [i] of a) t.add(regions.get(i)); return t; });
  // suf[i] = 从第 i 段起还能覆盖到哪些区（用于"这个区再也拿不到气球"的剪枝）
  const suf = Array.from({ length: opts.length + 1 }, () => new Set());
  for (let i = opts.length - 1; i >= 0; i--) { suf[i] = new Set(suf[i + 1]); for (const k of touch[i]) suf[i].add(k); }
  const w = new Int8Array(nReg), b = new Int8Array(nReg);
  let nodes = 0, solutions = 0, capped = false, stopped = false;
  const sols = [];
  const cur = new Map();
  function dfs(i) {
    if (solutions >= maxSol) { stopped = true; return; }
    if (i === opts.length) {
      for (let k = 0; k < nReg; k++) if (w[k] !== 1 || b[k] !== 1) return;
      solutions++; if (sols.length < maxSol) sols.push(new Map(cur)); return;
    }
    for (const assign of opts[i]) {
      if (++nodes > cap) { capped = true; return; }
      const undo = [];
      let ok = true;
      for (const [cell, v] of assign) {
        const k = regions.get(cell);
        if (v === W) { if (w[k] >= 1) { ok = false; break; } w[k]++; } else { if (b[k] >= 1) { ok = false; break; } b[k]++; }
        undo.push([k, v]); cur.set(cell, v);
      }
      if (ok) {
        for (let k = 0; k < nReg; k++) if ((w[k] === 0 || b[k] === 0) && !suf[i + 1].has(k)) { ok = false; break; }
      }
      if (ok) dfs(i + 1);
      for (let u = undo.length - 1; u >= 0; u--) { const [k, v] = undo[u]; if (v === W) w[k]--; else b[k]--; }
      for (const [cell] of assign) cur.delete(cell);
      if (capped || stopped) return;
    }
  }
  dfs(0);
  const bounded = capped || stopped;
  const read = stopped ? `≥${maxSol}` : capped ? `≥${solutions}(预算耗尽)` : String(solutions);
  const dead = !bounded && solutions === 0;
  const unique = !bounded && solutions === 1;
  return { solutions, capped, stopped, bounded, dead, unique, read, nodes, sols, maxSol, cap };
}
