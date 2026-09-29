// 官方 4x4 例题（Nikoli 官网那张），本仓的**黄金夹具**：判据、计数器、铅笔、出题器
// 四条路都要在这张盘上给出已知读数（见 tools/rule-test.mjs / counter-test.mjs /
// pencil-test.mjs / golden-test.mjs）。它同时也就是游戏里的第 1 关。
//
// 数据来源是两条互相独立的路，谁也不是抄谁：
//   1) 盘面内容 + 粗线位置：对 Nikoli 官网 GIF 放大 4x 后逐像素量出来的
//      —— 判据是"边界中段暗像素跨度 >= 5px 即粗线"，黑格/铁球所在的一侧不参与判粗细。
//      量出来的是下面 OFFICIAL_PIXEL 那两串读数（# 粗线 / . 细线，外墙计入）。
//   2) 区域划分：从官方解答图按"每区恰 1 气球 1 铁球 + 连通"反推。
// 两条路给的 5 个区逐格一致 —— 这条一致性本身就是判据的一次交叉验证，
// 由 tools/rule-test.mjs 拿像素读数做洪泛再和下面的区表对比，不靠人眼。
//
// 边界读数的编号约定（tools/rule-test.mjs 里按这个约定洪泛，并有"键集合"的回归锁）：
//   V 共 R 行、每行 C+1 个字符：第 k 个字符是"第 k-1 列与第 k 列之间"的那条线（k=0 左外墙、k=C 右外墙）。
//   H 共 R+1 行、每行 C 个字符：H[b] 是"第 b 行之上"那条线（b=0 上外墙、b=R 下外墙）。
//   '#' 粗线（断开），'.' 细线（连通）。
//   所以 V 行 `#.#.#` 是 c0|c1 与 c2|c3 之间细、c1|c2 粗；`##.##` 是 c1|c2 细。

import { mkBoard, W, B } from './rules.js';

export const OFFICIAL_PIXEL = {
  V: ['#.#.#', '#####', '#####', '##.##'],   // 4 行 × 5 个竖直边界位
  H: ['####', '##.#', '.#..', '..##', '####'], // 5 行 × 4 个水平边界位
};

const R = 4, C = 4;
const id = (r, c) => r * C + c;

/** 题面黑格：r2c2、r4c4 */
export const OFFICIAL_BLACK = [id(1, 1), id(3, 3)];

/** 区表（A..E -> 索引 0..4） */
const REGION_LIST = [
  [id(0, 0), id(0, 1)],                       // A
  [id(1, 0), id(2, 0), id(3, 0)],             // B
  [id(0, 2), id(0, 3), id(1, 2), id(2, 2)],   // C
  [id(1, 3), id(2, 3)],                       // D
  [id(2, 1), id(3, 1), id(3, 2)],             // E
];

/** 官方解答：5 气球 5 铁球 / 14 空格。 */
const SOL_LIST = [
  [id(0, 0), W], [id(1, 0), W], [id(0, 3), W], [id(1, 3), W], [id(2, 1), W],
  [id(0, 1), B], [id(3, 0), B], [id(2, 2), B], [id(2, 3), B], [id(3, 2), B],
];

export const OFFICIAL_REGIONS = REGION_LIST.reduce((m, list, k) => { for (const i of list) m.set(i, k); return m; }, new Map());
export const OFFICIAL_SOL = new Map(SOL_LIST);

/** @returns {{B_, regions:Map, sol:Map, R:number, C:number}} 每次调用给新对象（判据不共享可变状态） */
export function official() {
  return {
    R, C,
    B_: mkBoard(R, C, [...OFFICIAL_BLACK]),
    regions: new Map(OFFICIAL_REGIONS),
    sol: new Map(SOL_LIST),
  };
}
