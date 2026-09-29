// 出题器闸：两件事一起量，都从同一次循环里出来（同一批盘、同一套种子）。
//   台阶 = 每一档"第几次尝试出得来一张 唯一解 且 铅笔推满 的盘"、累计多少毫秒
//   成本 = 计数器节点数 med/p95、整盘（make+dig+铅笔）耗时 med/p95、挪步数、试刀数
// 红线三条，任何一条亮就非零退出：
//   liar      没被计数器证成唯一的盘上，铅笔宣称推满（判据 1 作废）
//   打架      铅笔推出来的解和计数器的唯一解不是同一张盘
//   出货      某一档在 attempts/ms 上限内出不出货（档位表是"按出货定义"的，出不来就不该在表上）
// 另有两条：一条防 liar 红线空转（样本里得真有没证成唯一的盘），一条把 tiers.js 里**手抄**回来的
// TIERS_MEASURED 逐档对上本轮读数（墙钟字段不比）。末尾还有一段 7x7 的**观测**（不设出货红线，
// 只设 liar/打架）——它的作用是把"判据 1 在 7x7 没跑过"这句话换成一个读数。
// 另外报一条软读数：唯一盘里被铅笔推满的比例（判据 1 的反向）。原型在 800+120 张盘上是 100%，
// 这里同样按硬门盯（FLOOR 默认 0.95）——掉了就是说命名规则不够用了。
//
// 跑法：node tools/generator-probe.mjs [TIERS=s6,h6] [--bless-tiers]
// 环境变量：SAMPLE（每档尝试次数，默认 20）SEED（默认 1）FLOOR（推满比例下限）ARM（挖法）
//           OBS（7x7 观测段的尝试次数，默认 6）
import { sameSol } from '../js/engine/pencil.js';
import { shipAttempt } from '../js/engine/generate.js';
import { TIERS, DIG, TIERS_MEASURED } from '../js/engine/tiers.js';
import { mkGate, envInt, envStr, med, p95 } from './kit.mjs';

const g = mkGate('generator-probe');
const SAMPLE = envInt('SAMPLE', 20);
const SEED = envInt('SEED', 1);
const FLOOR = +(envStr('FLOOR', '0.95'));
const ARM = envStr('ARM', DIG.ARM);
const tiers = envStr('TIERS', '').split(',').filter(Boolean).length
  ? TIERS.filter(t => envStr('TIERS', '').split(',').includes(t.id)) : TIERS;
g.ok('档位表非空', tiers.length > 0, `${tiers.length} 档：${tiers.map(t => `${t.name}${t.R}x${t.C}区${t.NR}`).join(' · ')}`);
g.line(`口径：ARM=${ARM} MAXMUT=${DIG.MAXMUT} cap=${DIG.cap} maxSol=${DIG.maxSol} · 每档 ${SAMPLE} 次尝试 · SEED=${SEED}`);

const rows = [];
let liarAll = 0, fightAll = 0, uniqAll = 0, uniqSolvedAll = 0, madeAll = 0;
for (const t of tiers) {
  const nodes = [], ms = [], steps = [], probes = [];
  let made = 0, uniq = 0, uniqSolved = 0, liar = 0, fight = 0, first = null, cum = 0;
  const why = {};
  for (let att = 0; att < SAMPLE; att++) {
    const t0 = Date.now();
    const s = shipAttempt({ R: t.R, C: t.C, NB: t.NB, NR: t.NR, seed: SEED, att, ...DIG, ARM });
    const dt = Date.now() - t0;
    cum += dt;
    why[s.reason] = (why[s.reason] || 0) + 1;
    if (!s.made) continue;
    made++;
    const r = s.r;
    const isUniq = !!r && !r.bounded && r.solutions === 1;
    if (isUniq) { uniq++; nodes.push(r.nodes); ms.push(dt); steps.push(s.step); probes.push(s.probes); }
    if (isUniq && s.p.solved) {
      uniqSolved++;
      const arg = sameSol(s.p.sol, r.sols[0]);
      if (!arg) { fight++; g.line(`  **铅笔和计数器打架** ${t.id} att=${att}`); }
    }
    // 判据 1 的红线：盘没被证成唯一（多解 / 死盘 / 没数完），铅笔就不许宣称推满
    if (!isUniq && s.p.solved) { liar++; g.line(`  **铅笔在不唯一的盘上宣称推满** ${t.id} att=${att} 计数器 ${r ? r.read : '未数'}`); }
    if (s.shipped && first === null) first = { att: att + 1, cumMs: cum, step: s.step, nodes: r.nodes, rounds: s.p.rounds, forced: `${s.p.forced}/${s.p.total}` };
  }
  const ratio = uniq ? uniqSolved / uniq : NaN;
  rows.push({ t, id: t.id, made, uniq, uniqSolved, ratio, liar, fight, first,
    nodes: [med(nodes), p95(nodes)], ms: [med(ms), p95(ms)], steps: [med(steps), p95(steps)], probes: [med(probes), p95(probes)], why });
  liarAll += liar; fightAll += fight; uniqAll += uniq; uniqSolvedAll += uniqSolved; madeAll += made;
}
for (const r of rows) {
  const t = r.t;
  g.line(`${t.id} ${t.name} ${t.R}x${t.C} 黑格${t.NB} 区${t.NR} / ${SAMPLE} 次尝试：造成 ${r.made} · 唯一 ${r.uniq}（铅笔推满 ${r.uniqSolved}）· 谎报 ${r.liar} · 打架 ${r.fight}`);
  g.line(`  出货：${r.first ? `第 ${r.first.att} 次尝试（累计 ${r.first.cumMs}ms）· 那张盘 ${r.first.step} 步挪 / 计数器 ${r.first.nodes} 节点 / 铅笔 ${r.first.rounds} 轮钉满 ${r.first.forced}` : '**未出货**'}`);
  g.line(`  成本（按唯一盘计）：计数器节点 med ${r.nodes[0]} p95 ${r.nodes[1]} · 整盘 med ${r.ms[0]} p95 ${r.ms[1]}ms · 挪步 med ${r.steps[0]} p95 ${r.steps[1]} · 试刀 med ${r.probes[0]} p95 ${r.probes[1]}`);
  g.line(`  出口读数：${JSON.stringify(r.why)}`);
}

// ---- 红线 ----
g.eq('红线：铅笔在不唯一的盘上宣称推满（liar）', liarAll, 0);
// 上面那条红线得有"没证成唯一"的盘可验，否则它永远绿：整批盘全是唯一解时 liar 根本没机会开口。
g.ok('liar 红线不是空转：样本里真有没证成唯一的盘', madeAll - uniqAll >= 3,
  `造成 ${madeAll} · 证成唯一 ${uniqAll} · 可供验谎 ${madeAll - uniqAll}`);
g.eq('红线：铅笔推出来的解与计数器的唯一解不一致（打架）', fightAll, 0);
for (const r of rows) {
  const t = r.t;
  g.ok(`${t.id} 在 ${t.ship.attempts} 次尝试内出货`, !!r.first && r.first.att <= t.ship.attempts, r.first ? `第 ${r.first.att} 次` : '未出货');
  g.ok(`${t.id} 出货累计耗时在 ${t.ship.ms}ms 内`, !!r.first && r.first.cumMs <= t.ship.ms, r.first ? `${r.first.cumMs}ms` : '未出货');
  g.ok(`${t.id} 至少造出过一张盘`, r.made > 0, `造成 ${r.made}/${SAMPLE}`);
  g.ok(`${t.id} 唯一盘被铅笔推满的比例 >= ${FLOOR}`, r.uniq > 0 && r.ratio >= FLOOR,
    `${r.uniqSolved}/${r.uniq} = ${Number.isNaN(r.ratio) ? 'n/a' : r.ratio.toFixed(3)}`);
}
g.line(`合计 ${tiers.length} 档 · 造成 ${madeAll} · 唯一 ${uniqAll} · 其中铅笔推满 ${uniqSolvedAll} · liar ${liarAll} · 打架 ${fightAll}`);

// TIERS_MEASURED 是 round 2 要印到选档页上的那句「实测」，靠人从本段输出抄回 tiers.js。
// 抄错了/口径换了都不该让它继续绿：这一条把可复现的字段逐档对上
// （uniq/uniqSolved/步数 med·p95/计数器节点 med·p95/出货是第几次尝试/sample·seed·arm）。
// msMedP95 与 shipMs 故意不进等式——那是墙钟，机器速度一变就红，跟盘没关系。
// 只在默认口径（全档 + SAMPLE/SEED/ARM 与表里记的一致）时比，跑子集时明说"跳过"，不闷声绿。
{
  const sameScope = tiers.length === TIERS.length && SAMPLE === 20 && SEED === 1 && ARM === DIG.ARM;
  if (!sameScope) {
    g.line(`TIERS_MEASURED 对表：跳过（本轮口径不是默认全档：档 ${tiers.length}/${TIERS.length} · SAMPLE=${SAMPLE} · SEED=${SEED} · ARM=${ARM}）`);
  } else {
    for (const r of rows) {
      const p = TIERS_MEASURED[r.id];
      const fresh = `${r.uniq}/${r.uniqSolved} · 步 ${r.steps.join('/')} · 节点 ${r.nodes.join('/')} · 出货第 ${r.first ? r.first.att : '∞'} 次`;
      const bless = p ? `${p.uniq}/${p.uniqSolved} · 步 ${p.stepMedP95.join('/')} · 节点 ${p.nodesMedP95.join('/')} · 出货第 ${p.shipAttempt ?? '∞'} 次` : '表里没这一档';
      g.ok(`${r.id} 贴回的读数与本轮一致`, !!p && p.uniq === r.uniq && p.uniqSolved === r.uniqSolved &&
        p.stepMedP95[0] === r.steps[0] && p.stepMedP95[1] === r.steps[1] &&
        p.nodesMedP95[0] === r.nodes[0] && p.nodesMedP95[1] === r.nodes[1] &&
        p.shipAttempt === (r.first ? r.first.att : null) && p.sample === SAMPLE && p.seed === SEED && p.arm === ARM,
        `贴回 ${bless} vs 本轮 ${fresh}`);
    }
  }
}

// 观测段：7x7 黑格6 区8 不在菜单上（tiers.js 写了两条理由）。但"判据 1 在 7x7 上没跑过"
// 是一句没有读数的话——这里把它跑出来。出货率/推满率**不设红线**：那是尺寸天花板，
// 哪天跑得动了是进步。liar 与打架照设：铅笔说谎不是"尺寸不够大"，是引擎有洞，跟尺寸无关。
{
  const OBS = envInt('OBS', 6);
  const t = { R: 7, C: 7, NB: 6, NR: 8 };
  let made = 0, uniq = 0, solved = 0, liar = 0, fight = 0, firstShip = null, cum = 0;
  const why = {};
  for (let att = 0; att < OBS; att++) {
    const t0 = Date.now();
    const s = shipAttempt({ ...t, seed: SEED, att, ...DIG, ARM });
    cum += Date.now() - t0;
    why[s.reason] = (why[s.reason] || 0) + 1;
    if (!s.made) continue;
    made++;
    const isUniq = !!s.r && !s.r.bounded && s.r.solutions === 1;
    if (isUniq) uniq++;
    if (isUniq && s.p.solved) {
      solved++;
      if (!sameSol(s.p.sol, s.r.sols[0])) { fight++; g.line(`  **铅笔和计数器打架** 7x7 att=${att}`); }
    }
    if (!isUniq && s.p.solved) { liar++; g.line(`  **铅笔在不唯一的盘上宣称推满** 7x7 att=${att} 计数器 ${s.r ? s.r.read : '未数'}`); }
    if (s.shipped && firstShip === null) firstShip = { att: att + 1, cumMs: cum };
  }
  g.line(`观测 7x7 黑格6 区8（不在菜单）/ ${OBS} 次尝试：造成 ${made} · 唯一 ${uniq} · 铅笔推满 ${solved} · 首次出货 ${firstShip ? `第 ${firstShip.att} 次（累计 ${firstShip.cumMs}ms）` : '未出'} · 出口 ${JSON.stringify(why)}`);
  g.eq('观测段红线：7x7 上 liar', liar, 0);
  g.eq('观测段红线：7x7 上打架', fight, 0);
}

if (process.argv.includes('--bless-tiers')) {
  const out = {};
  for (const r of rows) out[r.id] = {
    shipAttempt: r.first ? r.first.att : null, shipMs: r.first ? r.first.cumMs : null,
    nodesMedP95: r.nodes, msMedP95: r.ms, stepMedP95: r.steps,
    uniq: r.uniq, uniqSolved: r.uniqSolved, sample: SAMPLE, seed: SEED, arm: ARM,
  };
  g.line('\n// 贴回 js/engine/tiers.js 的 TIERS_MEASURED：');
  g.line(`export const TIERS_MEASURED = ${JSON.stringify(out)};`);
}
g.finish();
