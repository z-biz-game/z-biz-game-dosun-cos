// 黄金夹具闸，两半：
//  A) 官方 4x4 重放 —— 判据 0 错、计数器读到 "1"（穷尽、144 节点）、铅笔 14/14、
//     推出来的答案逐格 == 官方解答。这张盘也就是游戏第 1 关，所以这条不是"测试用的假盘"。
//  B) 确定性 —— 静态扫引擎源码（不许出现墙钟 / Math.random / 比较函数里的 rnd），
//     再拿固定种子重放出货盘，逐格指纹比对 tools/fixtures/golden.json。
//     为什么指纹要落进文件：硬要求是"同一颗种子在 node 和 Chrome 长同一张盘"，
//     那就要有一处**跨进程、跨引擎**能对照的常量。跑法：
//       node tools/golden-test.mjs --bless   # 重新生成夹具（改算法之后要人看过 diff 再 bless）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkBoard, W, B, E } from '../js/engine/rules.js';
import { count } from '../js/engine/counter.js';
import { pencil, initCand, sameSol } from '../js/engine/pencil.js';
import { official, OFFICIAL_SOL } from '../js/engine/official.js';
import { makeBoard, shipOne, boardKey } from '../js/engine/generate.js';
import { fnv1a, mulberry } from '../js/engine/rng.js';
import { TIERS } from '../js/engine/tiers.js';
import { mkGate, envInt, readJSON, writeJSON } from './kit.mjs';

const g = mkGate('golden-test');
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden.json');
const BLESS = process.argv.includes('--bless');

// ---------- A. 官方 4x4 重放 ----------
const { B_, regions, sol } = official();
const serSol = m => [...m].sort((x, y) => x[0] - y[0]).map(([i, v]) => `${i}:${v}`).join(',');
const errs = B_.check(regions, sol);
g.eq('官方例题：判据 0 错', errs.length, 0);
const r = count(B_, regions, { cap: 400000, maxSol: 60 });
g.eq('官方例题：计数器终读', r.read, '1');
g.eq('官方例题：计数器节点数', r.nodes, 144);
g.ok('官方例题：计数器的解 == 官方解答', sameSol(r.sols[0], sol));
const p = pencil(B_, regions, initCand(B_));
g.ok('官方例题：铅笔推满且 == 官方解答', p.solved && sameSol(p.sol, sol), `钉 ${p.forced}/${p.total} · ${p.rounds} 轮`);
g.eq('官方例题：黑格位置', [...B_.black].sort((a, b) => a - b).join(','), '5,15');
g.eq('官方例题：区数', new Set(regions.values()).size, 5);
g.eq('官方例题：气球/铁球数', `${[...sol.values()].filter(v => v === W).length}/${[...sol.values()].filter(v => v === B).length}`, '5/5');
// 官方盘在 3^14 独立裁判的射程外（14 格 = 478 万叶子 × check() ≈ 2 分钟），所以答案一致性
// 由"计数器 + 判据 + 像素洪泛"三条路背书；全枚举版挂在 counter-test 的 SLOW_BRUTE=1 后面。
const gold = { official: { read: r.read, nodes: r.nodes, rounds: p.rounds, forced: `${p.forced}/${p.total}`, answer: serSol(sol) }, boards: {} };

// ---------- B1. 静态确定性扫描 ----------
const ENGINE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'engine')).filter(f => /\.js$/.test(f)).sort();
g.ok('引擎模块齐全', ['rules.js', 'counter.js', 'pencil.js', 'generate.js', 'rng.js'].every(f => ENGINE.includes(f)), ENGINE.join(' '));
/** 剥掉注释再扫：闸读的是代码，不是散文（引擎注释里成段地写着"不许出现 Date.now"）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
/** 取出所有 .sort(...) 的实参文本（配平括号），检查里面没有 rnd —— 只查文本，不执行。 */
function sortArgs(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith('.sort(', i)) {
      let d = 0, j = i + '.sort'.length;
      for (; j < src.length; j++) {
        if (src[j] === '(') d++;
        else if (src[j] === ')') { d--; if (!d) break; }
      }
      out.push(src.slice(i + '.sort'.length + 1, j));
    }
  }
  return out;
}
for (const f of ENGINE) {
  const src = stripComments(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'engine', f), 'utf8'));
  g.ok(`${f}: 不读墙钟`, !/Date\.now|performance\.now|new Date|Date\.parse/.test(src));
  g.ok(`${f}: 不碰内建熵源/宿主熵源`, !/Math\.random|require\(.crypto|process\.env|process\.argv|globalThis/.test(src));
  const sa = sortArgs(src);
  g.ok(`${f}: ${sa.length} 处 sort 的比较函数里都没有 rnd/Math.random`, sa.every(a => !/rnd|Math\.random/.test(a)), sa.length ? sa.map(a => a.replace(/\s+/g, ' ').slice(0, 28)).join(' | ') : '无 sort');
}

// ---------- B2. 固定种子重放 ----------
const REPEAT = envInt('REPLAY', 3);
for (const t of TIERS) {
  const rec = [];
  for (let att = 0; att < REPEAT; att++) {
    const m = makeBoard(t.R, t.C, t.NB, t.NR, mulberry(1000003 + att * 7919 + t.NR * 31 + t.NB * 17));
    // 造不出盘是**合法读数**（构造式出题本来就有刷光的时候，见 generator-probe 的"造成 x/20"），
    // 这里只要求"同一个种子还是造不出"——所以指纹记 'none'，不当红。
    if (!m) { rec.push({ stage: 'make', key: 'none' }); continue; }
    rec.push({ stage: 'make', key: fnv1a(boardKey(m.B_, m.reg)), cells: m.B_.cells.length, sol: serSol(m.sol) });
  }
  const s = shipOne({ R: t.R, C: t.C, NB: t.NB, NR: t.NR, seed: 7, attempts: 40 });
  g.ok(`${t.id} 40 次尝试内出货（重放用）`, !!s, s ? `第 ${s.att + 1} 次` : '未出货');
  if (s) rec.push({ stage: 'ship', key: fnv1a(boardKey(s.B_, s.reg)), read: s.r.read, nodes: s.r.nodes, forced: `${s.p.forced}/${s.p.total}`, cells: s.B_.cells.length });
  gold.boards[t.id] = rec;
  // 同进程里再走一遍：抓到任何藏在模块级状态里的"第二次不一样"
  if (s) {
    const s2 = shipOne({ R: t.R, C: t.C, NB: t.NB, NR: t.NR, seed: 7, attempts: 40 });
    g.eq(`${t.id} 同种子重放（进程内二次）指纹一致`, fnv1a(boardKey(s2.B_, s2.reg)), fnv1a(boardKey(s.B_, s.reg)));
  }
}

if (BLESS || !fs.existsSync(FIX)) {
  if (!BLESS) { g.ok('夹具文件存在（缺就先 bless）', false, `node tools/golden-test.mjs --bless 生成 ${path.relative(process.cwd(), FIX)}`); g.finish(); }
  writeJSON(FIX, gold);
  g.line(`夹具已写出 ${path.relative(process.cwd(), FIX)}（${JSON.stringify(gold.official)}）`);
  g.finish();
  process.exit(0);
}
const want = readJSON(FIX);
g.eq('夹具：出货盘/构造盘指纹逐档一致', JSON.stringify(gold.boards), JSON.stringify(want.boards));
g.eq('夹具：官方例题读数一致', JSON.stringify(gold.official), JSON.stringify(want.official));
g.line(`  重放覆盖 ${Object.keys(gold.boards).length} 档 × ${REPEAT} 次造盘 + 1 次出货（含出货后区表、计数器读数、铅笔钉满数）`);
g.line(`  身份常量：W=${W}（气球）B=${B}（铁球）E=${E}（铅笔第三态）`);
g.finish();
