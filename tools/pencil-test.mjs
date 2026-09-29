// 铅笔闸：官方 4x4 必须推满 14/14、且推出来的就是官方解答；
// 外加判据 1 的红线在随机盘上的抽样版：**没被计数器证成唯一的盘，铅笔绝不许宣称推满**。
// 推满了就等于有某条链式规则（N1c/N2c）在猜 —— 那条规则就不再是"人眼规则"，判据 1 整个作废。
import { count } from '../js/engine/counter.js';
import { pencil, initCand, sameSol } from '../js/engine/pencil.js';
import { official } from '../js/engine/official.js';
import { makeBoard } from '../js/engine/generate.js';
import { mulberry } from '../js/engine/rng.js';
import { W, B, E } from '../js/engine/rules.js';
import { mkGate, envInt } from './kit.mjs';

const g = mkGate('pencil-test');
const NAMED = ['N1 浮', 'N1 浮(倒推)', 'N1c 浮(撞区)', 'N2 沉', 'N2 沉(倒推)', 'N2c 沉(撞区)', 'N3 配对(气球)', 'N3 配对(铁球)', 'N4 三态'];

// ---------- 官方 4x4：14/14，且 == 官方解答 ----------
const { B_, regions, sol } = official();
const p = pencil(B_, regions, initCand(B_));
g.eq('官方例题：推满', p.solved, true);
g.eq('官方例题：没有矛盾', p.contradiction, null);
g.eq('官方例题：钉满格数', `${p.forced}/${p.total}`, '14/14');
g.eq('官方例题：轮数（夹具）', p.rounds, 3);
g.ok('官方例题：推出来的盘 == 官方解答', sameSol(p.sol, sol), `${p.sol.size} 个球`);
g.ok('官方例题：用到的规则都在命名表里', p.log.every(x => NAMED.some(n => x.startsWith(n))), p.log.join(' , '));
// 官方例题实际用到的 7 条是夹具读数。**plain N1 浮 / N2 沉 在这张盘上一次都没用上**
// （唯一的那条"上面不是气球"的删候选在这里都被 N1c 抢先了）—— 所以那两条在下面
// 用随机盘的规则并集来验，不许拿"本题没用到"当"这条规则是死的"糊过去。
for (const rule of ['N1c 浮(撞区)', 'N2c 沉(撞区)', 'N3 配对(气球)', 'N3 配对(铁球)', 'N1 浮(倒推)', 'N2 沉(倒推)', 'N3 配对(气球) 同区排斥']) {
  g.ok(`官方例题用到的规则里有 ${rule}`, p.log.includes(rule));
}

// N4 三态：一格三个身份被抹光 = 矛盾，且绝不许"推满"
const c4 = initCand(B_); c4.get(B_.cells[0]).clear();
const p4 = pencil(B_, regions, c4);
g.ok('N4 三态：候选抹光要报矛盾', !!p4.contradiction && p4.contradiction.startsWith('N4 三态'), p4.contradiction || '没报');
g.eq('N4 三态：报了矛盾的盘不许算推满', p4.solved, false);
// 候选被掐死时也不许谎报推满
const cut = initCand(B_); const last = B_.cells[B_.cells.length - 1]; cut.get(last).delete(W); cut.get(last).delete(B);
const p2 = pencil(B_, regions, cut);
g.ok('钉不满时如实报钉不满', !p2.solved && p2.forced < p2.total, `${p2.forced}/${p2.total} 矛盾 ${p2.contradiction || '无'}`);

// ---------- 判据 1 的红线 + 规则覆盖率：随机盘 ----------
const N = envInt('TRIES', 120);
const NB = envInt('NB', 4), NR = envInt('NR', 5), SZ = envInt('SZ', 5);
let uniq = 0, uniqSolved = 0, nonUniq = 0, liar = 0, made = 0, fight = 0;
const seen = new Set();
for (let t = 0; t < N; t++) {
  const rnd = mulberry(77 * 100003 + t * 7919);
  const m = makeBoard(SZ, SZ, NB, NR, rnd);
  if (!m) continue;
  made++;
  const r = count(m.B_, m.reg, { cap: 400000, maxSol: 400 });
  const pp = pencil(m.B_, m.reg, initCand(m.B_));
  for (const entry of pp.log) for (const n of NAMED) if (entry.startsWith(n)) seen.add(n);
  const isUniq = !r.bounded && r.solutions === 1;
  if (isUniq) { uniq++; if (pp.solved) { uniqSolved++; if (!sameSol(pp.sol, r.sols[0])) { fight++; g.line(`  **铅笔和计数器打架** seed=${t}`); } } }
  else {
    nonUniq++;
    if (pp.solved) { liar++; g.line(`  **铅笔在不唯一的盘上宣称推满** seed=${t} 计数器 ${r.read}`); }
  }
}
g.eq('红线：不唯一（含没数完）的盘上铅笔宣称推满的次数', liar, 0);
g.eq('红线：铅笔的解与计数器的唯一解打架', fight, 0);
g.ok('这一轮真的验到了不唯一的盘（不然第一条断言是空的）', nonUniq > 0, `不唯一 ${nonUniq} / 造成 ${made}`);
for (const n of ['N1 浮', 'N2 沉', 'N3 配对(气球)', 'N1c 浮(撞区)', 'N2c 沉(撞区)']) {
  g.ok(`随机盘并集里出现过 ${n}（这条命名规则不是死代码）`, seen.has(n));
}
g.line(`  规则并集：${[...seen].sort().join(' , ')}`);
g.line(`  随机盘抽样 ${N} 次（${SZ}x${SZ} 黑格${NB} 区${NR}）：造成 ${made} · 唯一 ${uniq}（其中铅笔推满 ${uniqSolved}）· 不唯一 ${nonUniq} · 谎报 ${liar}`);
g.finish();
