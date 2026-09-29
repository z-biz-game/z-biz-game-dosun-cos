// 判据闸：官方 4x4 例题伪证 rules.js —— 解答必须 0 错，7 个单条款变异体必须各被**自己那一条**抓到。
// 外加"两个独立读数"的一致性检查：像素粗线洪泛推出的区表 vs 解答反推的区表，逐格相同。
import { mkBoard, W, B } from '../js/engine/rules.js';
import { official, OFFICIAL_PIXEL } from '../js/engine/official.js';
import { mkGate } from './kit.mjs';

const g = mkGate('rule-test');
const { B_, regions, sol, R, C } = official();
const id = (r, c) => r * C + c;

// ---- 读数 1（像素粗线）：只在细线两侧连通，从任意非黑格洪泛出连通块 = 区域划分 ----
// 竖直边界每行 C+1 个字符（左外墙 + C-1 条内部线 + 右外墙），第 k 个字符是
//   "第 k-1 列与第 k 列之间"那条线（洪泛里的键 `${r}|${k-1}` = "c=k-1 与 c=k 之间"）；
// 水平边界共 R+1 行、每行 C 个字符，H[b] 是"第 b 行之上"那条线（H[0] 上外墙、H[R] 下外墙），
//   洪泛里"row r 与 r+1 之间"用的是 H[r+1] 的第 c 个字符（键 `${r}|${c}`）。
// 下面两串读数逐字符抄自像素量取，别和注释里的 r1..r5 混编号（那套是 1 起的打印行号）。
const THIN_V = new Set(), THIN_H = new Set();
OFFICIAL_PIXEL.V.forEach((row, r) => { for (let k = 1; k < row.length - 1; k++) if (row[k] === '.') THIN_V.add(`${r}|${k - 1}`); });
OFFICIAL_PIXEL.H.forEach((row, b) => {
  if (b === 0 || b >= R) return;                       // 上下外墙不参与洪泛
  for (let k = 0; k < row.length; k++) if (row[k] === '.') THIN_H.add(`${b - 1}|${k}`);
});
// 编号约定的回归锁：把上面两套键和"从官方解答反推的区表"手抄出来的那 9 个键逐字对一遍。
// 这条断言专门盯下标偏移 —— 错一位洪泛就会把 5 个区切成 10 个，而判据本身照样 0 错。
g.eq('像素读数 -> 细线键（竖直）', [...THIN_V].sort().join(','), '0|0,0|2,3|1');
g.eq('像素读数 -> 细线键（水平）', [...THIN_H].sort().join(','), '0|2,1|0,1|2,1|3,2|0,2|1');
const nbrsThin = i => {
  const [r, c] = B_.rc(i), out = [];
  if (c + 1 < C && THIN_V.has(`${r}|${c}`)) out.push(id(r, c + 1));
  if (c - 1 >= 0 && THIN_V.has(`${r}|${c - 1}`)) out.push(id(r, c - 1));
  if (r + 1 < R && THIN_H.has(`${r}|${c}`)) out.push(id(r + 1, c));
  if (r - 1 >= 0 && THIN_H.has(`${r - 1}|${c}`)) out.push(id(r - 1, c));
  return out.filter(j => !B_.black.has(j));
};
const seen = new Set(); const flooded = [];
for (const i of B_.cells) {
  if (seen.has(i)) continue;
  const comp = [i]; seen.add(i);
  for (let p = 0; p < comp.length; p++) for (const y of nbrsThin(comp[p])) if (!seen.has(y)) { seen.add(y); comp.push(y); }
  flooded.push(comp);
}
g.eq('像素洪泛出的区数', flooded.length, 5);
let agree = flooded.length === 5;
for (const list of flooded) {
  const k = regions.get(list[0]);
  if (k === undefined || !list.every(i => regions.get(i) === k)) agree = false;
  if (list.filter(i => sol.get(i) === W).length !== 1 || list.filter(i => sol.get(i) === B).length !== 1) agree = false;
}
g.ok('像素粗线洪泛 与 解答反推的区表 逐格一致', agree, `${flooded.map(l => l.length).join('/')} 格`);

// ---- 官方解答过判据 ----
const errs0 = B_.check(regions, sol);
g.ok('官方 4x4 解答 0 错', errs0.length === 0, `${errs0.length} 条：${errs0.join(' / ') || '无'}`);

// ---- 7 个单条款变异体：每个都必须被自己那一条抓到 ----
const mv = (s, from, to) => { const m = new Map(s); const v = m.get(from); m.delete(from); m.set(to, v); return m; };
const set = (s, i, v) => { const m = new Map(s); m.set(i, v); return m; };
const muts = [
  ['R1 区里少了气球', regions, new Map([...sol].filter(([i]) => i !== id(1, 0))), 'R1'],
  ['R1 区不连通', new Map([...regions].map(([i, k]) => [i, i === id(2, 0) ? 0 : k])), sol, 'R1'],
  ['R1 球放在题面黑格上', regions, mv(sol, id(2, 1), id(1, 1)), 'R1'],
  ['R1 一个区两个铁球', regions, set(sol, id(1, 3), B), 'R1'],
  ['R2 气球悬在段中间', regions, mv(sol, id(2, 1), id(3, 1)), 'R2'],
  ['R2 气球躲在铁球下面（整区上下交换）', regions, new Map([...sol].map(([i, v]) => i === id(1, 3) ? [i, B] : i === id(2, 3) ? [i, W] : [i, v])), 'R2'],
  ['R3 铁球压在气球上（整区上下交换）', regions, new Map([...sol].map(([i, v]) => i === id(0, 0) ? [i, B] : i === id(0, 1) ? [i, W] : [i, v])), 'R3'],
];
g.eq('变异体条数', muts.length, 7);
let hit = 0;
for (const [label, reg, s, want] of muts) {
  const e = B_.check(reg, s);
  const mine = e.filter(x => x.startsWith(want));
  const other = e.filter(x => !x.startsWith(want));
  const okOne = e.length > 0 && mine.length > 0;
  hit += okOne ? 1 : 0;
  g.ok(`${label} -> 被 ${want} 抓到`, okOne, `${mine.length} 条${other.length ? `，另有 ${other.length} 条别的：${other.join(' / ')}` : '，没有别条'}`);
}
// "被自己那一条抓到"才算数：错抓（R1 的变异只被 R2 抓到）等于没有这条判据。
g.eq('7 个单条款变异体各被自己那一条抓到', hit, 7);
// 三条判据都得有人盯：每条至少要被一个条款专属的变异体验证过，不然改坏了也没人知道。
for (const p of ['R1', 'R2', 'R3']) {
  g.ok(`${p} 有条款专属的变异体`, muts.some(([, , , w]) => w === p), `共 ${muts.filter(([, , , w]) => w === p).length} 个`);
}

g.finish();
