// 铅笔求解器：玩家真能用的那五条**有名字**的规则，零猜测。
// 这个模块是"这局能不能玩"的判据，不是解题捷径 —— 计数器（counter.js）能穷尽整盘，
// 但它不代表人能推出来。判据 1 就是一条等式：
//     计数器证到唯一解  <=>  铅笔能推到 100% 钉满
// 单向（铅笔推满 => 盘唯一）是被实测的（generator-probe 每盘都跑）；
// 反向（唯一 => 铅笔推满）在 800+120 张盘上成立，不成立的盘在出题阶段就被刷掉、不出货。
//
// N1   浮：气球在段里贴着段顶连成前缀 —— 上面不是气球，自己就不能是气球。
// N1c  浮(撞区)：自己若是气球，**整条前缀链**都得是气球；链上两格同区 / 链上有格已不可能是气球 /
//      链外某区已经钉好气球 —— 这三种情况都让这格当不成气球。人眼看盘子形状就会说这句话。
// N2   沉：铁球对称，段底往上连成后缀。      N2c 沉(撞区)：N1c 的镜像。
// N3   配对：一个区恰好 1 气球 1 铁球 —— 候选唯一就钉死，钉死了就把同区别处的同类候选抹掉；
//      区里两类都钉齐了，剩下每格既不是气球也不是铁球。
// N4   三态：一格只能有一个身份（气球 / 铁球 / 空），三个都被抹掉就是矛盾。
// N1 浮(倒推) / N2 沉(倒推)：自己钉死是气球 => 上面那格必须钉死是气球（前缀性反用）。
//
// 注意 cand 的初值必须是"每格 {W,B,E}"（initCand），否则"钉满"的含义会漂。

import { W, B, E } from './rules.js';

const cloneBlk = m => new Map([...m].map(([k, v]) => [k, new Set(v)]));

/** 全空候选：每格三种身份都可能。判据 1 的读数以此为唯一起点。 */
export const initCand = B_ => new Map(B_.cells.map(i => [i, new Set([W, B, E])]));

/** 两个解（Map(cell -> W|B)）是否逐格一致。 */
export const sameSol = (a, b) => a.size === b.size && [...a].every(([i, v]) => b.get(i) === v);

/**
 * @param {ReturnType<import('./rules.js').mkBoard>} B_
 * @param {Map<number,number>} regions
 * @param {Map<number,Set<string>>} candIn 每格的候选身份集
 * @param {{maxRounds?:number}} opts
 * @returns {{cand,cells,log:string[],rounds,contradiction:string|null,solved:boolean,
 *   forced:number,total:number,sol:Map,cellsTotal:number}}
 *   solved 的含义：没有矛盾 **且** 每格都被钉成唯一身份。
 */
export function pencil(B_, regions, candIn, { maxRounds = 300 } = {}) {
  const cand = cloneBlk(candIn);
  const cells = B_.cells.filter(i => cand.has(i));
  const chainW = new Map(), chainB = new Map();
  for (const i of cells) {
    const s = B_.segOf.get(i), p = s.indexOf(i);
    chainW.set(i, s.slice(0, p + 1));
    chainB.set(i, s.slice(p));
  }
  const regOf = i => regions.get(i);
  const regCells = new Map(B_.regionList(regions));
  function chainConflict(i, v, chain) {
    const seen = new Set();
    for (const j of chain) {
      const k = regOf(j);
      if (seen.has(k)) return `链上 ${B_.name(i)}..${B_.name(j)} 两格同属区 ${k}`;
      seen.add(k);
      if (j !== i && !cand.get(j).has(v)) return `链上的 ${B_.name(j)} 已经不可能是 ${v}`;
    }
    for (const k of seen) for (const j of regCells.get(k)) {
      if (!chain.includes(j) && cand.get(j).size === 1 && cand.get(j).has(v)) return `区 ${k} 已在链外钉好 ${B_.name(j)}`;
    }
    return null;
  }
  const log = [];
  let contradiction = null;
  const say = s => { if (!log.includes(s)) log.push(s); };
  const del = (i, v, why) => { if (cand.get(i).delete(v)) { say(why); return true; } return false; };
  const pin = (i, v, why) => {
    const s = cand.get(i);
    if (s.size === 1 && s.has(v)) return false;
    if (!s.has(v)) { contradiction = contradiction || `${why}：${B_.name(i)} 本来就不可能是 ${v}`; return false; }
    cand.set(i, new Set([v])); say(why); return true;
  };
  let rounds = 0, mutated = true;
  while (mutated && !contradiction) {
    if (++rounds > maxRounds) { contradiction = contradiction || '铅笔转不动了（轮数上限）'; break; }
    mutated = false;
    for (const i of cells) {
      if (cand.get(i).size === 0) { contradiction = contradiction || `N4 三态：${B_.name(i)} 三个身份全被抹掉`; break; }
    }
    if (contradiction) break;
    for (const i of cells) {
      if (cand.get(i).has(W)) {
        const why = chainConflict(i, W, chainW.get(i));
        if (why) { del(i, W, 'N1c 浮(撞区)'); mutated = true; }
        else if (i !== B_.topOf(i) && !cand.get(B_.up(i)).has(W)) { del(i, W, 'N1 浮'); mutated = true; }
      }
      if (cand.get(i).has(B)) {
        const why = chainConflict(i, B, chainB.get(i));
        if (why) { del(i, B, 'N2c 沉(撞区)'); mutated = true; }
        else if (i !== B_.bottomOf(i) && !cand.get(B_.down(i)).has(B)) { del(i, B, 'N2 沉'); mutated = true; }
      }
      const t = cand.get(i);
      if (t.size === 1 && t.has(W) && i !== B_.topOf(i)) { if (pin(B_.up(i), W, 'N1 浮(倒推)')) mutated = true; }
      const u = cand.get(i);
      if (u.size === 1 && u.has(B) && i !== B_.bottomOf(i)) { if (pin(B_.down(i), B, 'N2 沉(倒推)')) mutated = true; }
    }
    if (contradiction) break;
    for (const [k, list] of B_.regionList(regions)) {
      const mine = list.filter(i => cand.has(i));
      for (const [v, why] of [[W, 'N3 配对(气球)'], [B, 'N3 配对(铁球)']]) {
        const can = mine.filter(i => cand.get(i).has(v));
        if (!can.length) { contradiction = contradiction || `${why}：区 ${k} 没有一格还能是 ${v}`; break; }
        if (can.length === 1) { if (pin(can[0], v, why)) mutated = true; }
        const fixed = can.filter(i => cand.get(i).size === 1 && cand.get(i).has(v));
        if (fixed.length === 1) for (const i of can) if (i !== fixed[0]) { if (del(i, v, `${why} 同区排斥`)) mutated = true; }
        else if (fixed.length > 1) { contradiction = contradiction || `${why}：区 ${k} 有 2 格被钉成 ${v}`; }
      }
      if (contradiction) break;
    }
    if (contradiction) break;
    for (const [k, list] of B_.regionList(regions)) {
      const mine = list.filter(i => cand.has(i));
      const pw = mine.find(i => cand.get(i).size === 1 && cand.get(i).has(W));
      const pb = mine.find(i => cand.get(i).size === 1 && cand.get(i).has(B));
      if (pw !== undefined && pb !== undefined) for (const i of mine) if (i !== pw && i !== pb) { if (del(i, W, 'N3 配对(已满)') | del(i, B, 'N3 配对(已满)')) mutated = true; }
    }
  }
  const pinned = cells.filter(i => cand.get(i).size === 1);
  const sol = new Map();
  for (const i of cells) { const s = [...cand.get(i)]; if (s.length === 1 && s[0] !== E) sol.set(i, s[0]); }
  return { cand, cells, log, rounds, contradiction, solved: !contradiction && pinned.length === cells.length, forced: pinned.length, total: cells.length, sol, cellsTotal: B_.cells.length };
}
