// 难度档位：**只按"实际出得来货"的定义列**，不按"规则上能玩多大"列。
// 出货口径 = 造盘 + 挖唯一 + 铅笔推满，量"第几次尝试出得来一张这样的盘"和累计毫秒
// （tools/generator-probe.mjs 每次提交前重跑，下面 TIERS_MEASURED 就是那一次的读数）。
//
// 两档尺寸、七级难度：5x5 区4..7（黑格4，21 空格）与 6x6 区6..8（黑格5，31 空格）。
// 为什么黑格数也跟着尺寸定死而不单独成一维：区数才是难度主轴（要挪的边界步数随区数涨），
// 黑格数只决定"段怎么切"；实测同区数下黑格 3→4 的出货率变化远小于区数 4→7 的变化，
// 所以把黑格数当常数、不当维度，档位表才是单调的。
//
// ---------- 封顶在哪里（读数，不是"先不做"） ----------
// 菜单停在 6x6 区8。理由是**出货率在这一档塌了**：每档 20 次尝试里"造得出盘"的次数
//   5x5 区4 20/20 · 区5 20/20 · 区6 17/20 · 区7 10/20
//   6x6 区6 19/20 · 区7 18/20 · **区8 7/20**
// 区8 那档还额外只有 2 张盘被证成唯一 —— "换一局"按下去要平均刷 5 次以上、
// 而且 20 次里 13 次连盘都造不出来，这是能玩性的下限，不是难度上限。
//
// 7x7 也实测了（本仓自己跑的，不是抄来的）。结论和原型笔记**不一致**，照实记：
//   7x7 黑格6 区8 / 20 次尝试：造成 13 · 唯一 6 · **第 3 次尝试就出货（1454ms）** · 全程 12813ms
//     （出口读数：步数用完 7 · 造不出盘 7 · 出货 6）
//   7x7 黑格8 区12 / 20 次尝试：**一张盘都造不出来**（20 次全"造不出盘"，1916ms）
// 也就是说"7x7 区8 20 盘 67 秒一张都不出"这条笔记**没能复现**：换了黑格数（6 而非笔记里的口径）
// 之后 7x7 区8 出货率和 6x6 区7 一个量级。这条读数在仓里可复跑：`tools/generator-probe.mjs`
// 的观测段（默认 OBS=6 次尝试，OBS 环境变量调大）。
// 但 7x7 仍然**不进菜单**，两个理由都是硬的：
//   1) 观测段的样本薄到不能当承诺：OBS=6 里只有 2 张盘被证成唯一（两张都被铅笔推满、liar 0），
//      而菜单上每一档的判据 1 是拿 20 次尝试、4~11 张唯一盘量出来的；
//   2) 6x6 区8 之后档位的"造成率"已经掉到 35%，7x7 区8 是 65% —— 中间没有单调过渡，
//      插一档读数比后一档好的难度进来，档位表就不成阶梯了。
// 想上 7x7：把 OBS 拉到 20 跑一遍观测段，出货率与推满率对上菜单口径之后再来列档。
//
// 每档的 ship 上限（attempts/ms）是**护栏**，不是读数：越过它当回归处理（出货率掉了、
// 或者某次改动把计数器弄慢了一个量级）。读数一律在 TIERS_MEASURED。
// 挖法口径：ARM=greedy（按解数贪心挪边界）+ MAXMUT=40 + cap=400000 + maxSol=400。
// 另一条 arm='forced'（按铅笔推进度挪）在引擎里可用，但这次台阶不是用它量的，不给它写读数。

/** 出货用的挖法常数（"换一局"按下去走这一套）。 */
export const DIG = { ARM: 'greedy', MAXMUT: 40, cap: 400000, maxSol: 400 };

export const TIERS = [
  { id: 's4', name: '入门', R: 5, C: 5, NB: 4, NR: 4, ship: { attempts: 12, ms: 4000 } },
  { id: 's5', name: '轻松', R: 5, C: 5, NB: 4, NR: 5, ship: { attempts: 12, ms: 4000 } },
  { id: 's6', name: '标准', R: 5, C: 5, NB: 4, NR: 6, ship: { attempts: 12, ms: 4000 } },
  { id: 's7', name: '进阶', R: 5, C: 5, NB: 4, NR: 7, ship: { attempts: 12, ms: 4000 } },
  { id: 'h6', name: '困难', R: 6, C: 6, NB: 5, NR: 6, ship: { attempts: 24, ms: 12000 } },
  { id: 'h7', name: '专家', R: 6, C: 6, NB: 5, NR: 7, ship: { attempts: 24, ms: 12000 } },
  { id: 'h8', name: '大师', R: 6, C: 6, NB: 5, NR: 8, ship: { attempts: 30, ms: 20000 } },
];

/** 默认档位（"换一局"按下去走这条）。 */
export const DEFAULT_TIER = 's6';

export const tierById = id => TIERS.find(t => t.id === id) || null;

// `node tools/generator-probe.mjs --bless-tiers` 的读数，手工贴回（刻意不让代码读文件：
// 档位表要能在浏览器里直接用，浏览器读不到磁盘）。
// 字段：shipAttempt/shipMs = 第几次尝试出货 / 到那时累计毫秒；nodesMedP95 = 唯一盘的计数器节点数
// med/p95；msMedP95 = 整盘（make+dig+铅笔）毫秒 med/p95；stepMedP95 = 挖到唯一用的挪步数；
// made = 20 次尝试里"造得出盘"的次数（出货率的那半个分数，只由种子与引擎决定，是菜单停在哪一档的读数）；
// uniq/uniqSolved = 20 次尝试里"证成唯一"的盘数 / 其中铅笔推满的盘数。
export const TIERS_MEASURED = {
  s4: { shipAttempt: 1, shipMs: 44, nodesMedP95: [153, 2145], msMedP95: [6, 44], stepMedP95: [3, 24], made: 20, uniq: 11, uniqSolved: 11, sample: 20, seed: 1, arm: 'greedy' },
  s5: { shipAttempt: 1, shipMs: 8, nodesMedP95: [420, 2580], msMedP95: [17, 64], stepMedP95: [5, 35], made: 20, uniq: 10, uniqSolved: 10, sample: 20, seed: 1, arm: 'greedy' },
  s6: { shipAttempt: 2, shipMs: 54, nodesMedP95: [264, 386], msMedP95: [42, 59], stepMedP95: [3, 26], made: 17, uniq: 7, uniqSolved: 7, sample: 20, seed: 1, arm: 'greedy' },
  s7: { shipAttempt: 1, shipMs: 34, nodesMedP95: [1584, 2571], msMedP95: [42, 56], stepMedP95: [6, 6], made: 10, uniq: 4, uniqSolved: 4, sample: 20, seed: 1, arm: 'greedy' },
  h6: { shipAttempt: 3, shipMs: 645, nodesMedP95: [1093, 6022], msMedP95: [50, 74], stepMedP95: [4, 16], made: 19, uniq: 8, uniqSolved: 8, sample: 20, seed: 1, arm: 'greedy' },
  h7: { shipAttempt: 2, shipMs: 443, nodesMedP95: [1463, 11223], msMedP95: [90, 446], stepMedP95: [12, 27], made: 18, uniq: 10, uniqSolved: 10, sample: 20, seed: 1, arm: 'greedy' },
  h8: { shipAttempt: 5, shipMs: 543, nodesMedP95: [778, 778], msMedP95: [102, 102], stepMedP95: [2, 2], made: 7, uniq: 2, uniqSolved: 2, sample: 20, seed: 1, arm: 'greedy' },
};
