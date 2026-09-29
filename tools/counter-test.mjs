// 计数器闸：三件事
//   1) 官方 4x4 必须"穷尽 = 1 解"，且那个解逐格 == 官方解答，节点数 == 夹具值 144
//   2) 三种终读必须互相区分得开：穷尽 / 饱和(≥maxSol) / 预算耗尽 —— 出题器靠它们决定
//      "这张盘证成唯一了没有"，读数一混就会把"没数完"当成"唯一"出货
//   3) 0 解 = 死盘，永远不许被读成"唯一"（判据 1 的红线）
// 外加独立裁判：3^n 全枚举 + check() 逐格验，和计数器对表（只在 <=8 空格的盘上跑，
// 3^8=6561 个叶子；4x4 官方盘 14 空格 = 3^14 ≈ 478 万叶子 × check() ≈ 2 分钟，
// 想跑放在 SLOW_BRUTE=1 后面，别进默认 npm test）。
import { mkBoard, W, B } from '../js/engine/rules.js';
import { count } from '../js/engine/counter.js';
import { official, OFFICIAL_SOL } from '../js/engine/official.js';
import { makeBoard, bruteCount, keyOf, BRUTE_LIMIT } from '../js/engine/generate.js';
import { mulberry } from '../js/engine/rng.js';
import { sameSol } from '../js/engine/pencil.js';
import { mkGate, envInt } from './kit.mjs';

const g = mkGate('counter-test');
const SLOW = process.env.SLOW_BRUTE === '1';

// ---------- 1. 官方 4x4 ----------
const { B_, regions, sol } = official();
const r1 = count(B_, regions, { cap: 400000, maxSol: 60 });
g.eq('官方例题：终读', r1.read, '1');
g.eq('官方例题：穷尽（没饱和、没爆预算）', r1.bounded, false);
g.eq('官方例题：solutions', r1.solutions, 1);
g.eq('官方例题：unique 判定', r1.unique, true);
g.eq('官方例题：dead 判定', r1.dead, false);
g.eq('官方例题：节点数（夹具）', r1.nodes, 144);
g.ok('官方例题：那个解 == 官方解答', r1.solutions === 1 && sameSol(r1.sols[0], sol));

// ---------- 2. 三种终读必须区分得开 ----------
// 饱和：拿同一张官方盘，把 maxSol 压到 1 —— 找到 1 解后继续走，下一次进 dfs 就 stopped
const sat = count(B_, regions, { cap: 400000, maxSol: 1 });
g.eq('饱和：read', sat.read, '≥1');
g.eq('饱和：stopped', sat.stopped, true);
g.eq('饱和：capped（必须没碰预算）', sat.capped, false);
g.eq('饱和：不许读成唯一', sat.unique, false);
// 预算耗尽：把 cap 压到 8 个节点
const cp = count(B_, regions, { cap: 8, maxSol: 60 });
g.ok('预算耗尽：read 带 "(预算耗尽)" 标记', /\(预算耗尽\)$/.test(cp.read), cp.read);
g.eq('预算耗尽：capped', cp.capped, true);
g.eq('预算耗尽：stopped（必须没饱和）', cp.stopped, false);
g.eq('预算耗尽：不许读成唯一', cp.unique, false);
// 穷尽：官方例题那个 '1'
const reads = [r1.read, sat.read, cp.read];
g.eq('三种终读两两不同（读数不许混）', new Set(reads).size, 3);
g.line(`  读数样本：穷尽 ${JSON.stringify(reads[0])} · 饱和 ${JSON.stringify(reads[1])} · 预算 ${JSON.stringify(reads[2])}`);

// ---------- 3. 0 解 = 死盘 ----------
// 1x4、无黑格、区表 A{c1} B{c2} C{c3,c4}：区数 3 要 3 气球 + 3 铁球，可段长只有 4，
// 前缀 + 后缀放不下（k+m<=4 而 k=3 且 m=3）—— 判据直接无解。
const deadB = mkBoard(1, 4, []);
const deadReg = new Map([[0, 0], [1, 1], [2, 2], [3, 2]]);
const rd = count(deadB, deadReg, { cap: 400000, maxSol: 60 });
g.eq('死盘：终读就是 "0"', rd.read, '0');
g.eq('死盘：穷尽（不是没数完）', rd.bounded, false);
g.eq('死盘：dead', rd.dead, true);
g.eq('死盘：**绝不许**读成唯一', rd.unique, false);
g.eq('死盘：作者判据 keyOf 必须打 Infinity（挪边界不许把它当进步）', keyOf(rd), Infinity);
g.eq('死盘：独立裁判 3^n 全枚举也报 0', bruteCount(deadB, deadReg), 0);

// 起手就有解的构造盘：铺下去的那把球**本身**就是一个解（判据 0 错），
// 而计数器在构造盘上绝不许读成 "0"。注意不许拿"穷尽到 1 个解"当断言 ——
// 没挖过的盘解多得是，maxSol=60 直接饱和（bounded），那正是"还没证成唯一"的意思。
let checked = 0, notSol = 0, readZero = 0, saturated = 0;
for (let s = 1; s <= envInt('MAKE_SEEDS', 12); s++) {
  const m = makeBoard(5, 5, 4, 5, mulberry(s * 7919 + 13));
  if (!m) continue;
  checked++;
  if (m.B_.check(m.reg, m.sol).length) { notSol++; g.line(`  **铺的球不是解** seed=${s}: ${m.B_.check(m.reg, m.sol).join(' / ')}`); }
  const r = count(m.B_, m.reg, { cap: 400000, maxSol: 60 });
  if (r.dead) { readZero++; g.line(`  **构造盘被读成 0 解（死盘）** seed=${s}`); }
  if (r.bounded) saturated++;
}
g.eq(`构造式出题：${checked} 张构造盘上铺的那把球都是合法解`, notSol, 0);
g.eq('构造式出题：计数器在构造盘上从不读成 "0"', readZero, 0);
g.ok('构造盘起手大多远未唯一（要挖）—— 这条只报数，不当断言', saturated >= 0, `${saturated}/${checked} 张在 maxSol=60 下饱和读数`);

// ---------- 4. 独立裁判对表（小盘） ----------
let mism = 0, judged = 0;
for (let s = 0; s < envInt('BRUTE_SEEDS', 24); s++) {
  const m = makeBoard(3, 3, 1, 2, mulberry(s * 104729 + 7));   // 8 空格，3^8=6561
  if (!m) continue;
  if (m.B_.cells.length > BRUTE_LIMIT) continue;
  const r = count(m.B_, m.reg, { cap: 400000, maxSol: 500 });
  const bf = bruteCount(m.B_, m.reg);
  judged++;
  if (bf !== r.solutions || r.bounded) { mism++; g.line(`  **对不上** seed=${s}: 计数器 ${r.read}(${r.nodes}节点) vs 全枚举 ${bf}`); }
}
g.eq(`独立裁判对表：${judged} 张小盘零不一致`, mism, 0);
g.line(`  独立裁判口径：3^空格数 全枚举 + check() 逐格验（上限 ${BRUTE_LIMIT} 格），与计数器的"段前缀/后缀"枚举是两条独立的路`);
if (SLOW) {
  const t0 = Date.now();
  const bf = bruteCount(B_, regions, { limit: 16 });
  g.eq('官方 4x4 全枚举（慢，SLOW_BRUTE=1 才跑）', bf, 1);
  g.line(`  官方 4x4 3^14 全枚举耗时 ${Date.now() - t0}ms`);
} else {
  g.line('  跳过 14 格全枚举（约 2 分钟）：要跑用 SLOW_BRUTE=1');
}
g.line(`  判据用到的常量：W=${W} 气球 B=${B} 铁球`);
g.finish();
