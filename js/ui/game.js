// 可玩状态机：一格被点下去变成什么、撤销退回来什么、什么时候算赢、提示能说什么。
//
// 两条刻意的绑定，都是"UI 不许自己判"的那一条：
//   * 胜负 = `B_.check(reg, sol)` —— js/engine/rules.js 里从规则原文写出来的 R1/R2/R3，
//     不是这个文件的记账。所以"看着填满"的盘赢不了：填满但浮沉关系错了、区里球数错了，
//     判据会给出一串条款，err 数不为 0 就不算赢。
//   * 题面 = js/engine/generate.js 的 shipOne（造盘 + 挖唯一 + 铅笔复核），
//     计数器读数 r.read 与铅笔推满 p.forced/p.total 一路带到页面上印出来 ——
//     页面上写的每个数字都是某个闸读过的同一个字段（档位读数走 TIERS_MEASURED）。
//
// 这里没有第二条规则实现：循环状态用的 W/B/E 就是 js/engine/rules.js 导出的那三个常量。

import { mkBoard, W, B, E } from '../engine/rules.js';
import { official } from '../engine/official.js';
import { count } from '../engine/counter.js';
import { pencil, initCand, sameSol } from '../engine/pencil.js';
import { shipOne, boardKey } from '../engine/generate.js';
import { DIG, TIERS, TIERS_MEASURED, DEFAULT_TIER, tierById } from '../engine/tiers.js';
import { fnv1a } from '../engine/rng.js';

/** 格子的一圈状态：未定 → 气球 → 铁球 → 钉空 → 未定。UND 用 null，其余三态直接就是引擎的身份常量。 */
export const UND = null;
export const CYCLE = [UND, W, B, E];
export const isBall = v => v === W || v === B;

export const tierOf = id => TIERS.find(t => t.id === id) || null;
export const tierFor = id => tierOf(id) || tierOf(DEFAULT_TIER) || TIERS[0];

/** 官方 4×4 例题 = 第 1 关：题面黑格、区表、答案都直接取 js/engine/official.js。 */
export function officialPuzzle() {
  const o = official();
  return {
    tier: 'off',
    name: '官方例题',
    R: o.R, C: o.C,
    B_: o.B_,
    reg: o.regions,
    sol: o.sol,
    NR: new Set(o.regions.values()).size,
    seed: 0,
    read: '1（官方夹具）',
    nodes: 0,
    pencilRead: `${o.B_.cells.length}`,
    genMs: 0,
    att: 0,
    official: true,
  };
}

/**
 * 出货：走引擎的 shipOne（同一颗种子在 node 与 Chrome 长同一张盘 —— 这条由 gen 腿逐档断言）。
 * @returns {null|object} null = 这一号 seed 在该档的 attempts 上限内没出货
 */
export function build(spec, seed) {
  const t0 = Date.now();
  const s = shipOne({ R: spec.R, C: spec.C, NB: spec.NB, NR: spec.NR, seed, attempts: spec.ship.attempts, ...DIG });
  if (!s) return null;
  return {
    tier: spec.id,
    name: spec.name,
    R: spec.R, C: spec.C,
    B_: s.B_,
    reg: s.reg,
    sol: s.r.sols[0],
    NR: new Set(s.reg.values()).size,
    seed,
    read: s.r.read,
    nodes: s.r.nodes,
    pencilRead: `${s.p.forced}/${s.p.total}`,
    solved: s.p.solved,
    steps: s.step,
    genMs: Date.now() - t0,
    att: s.att + 1,
    key: fnv1a(boardKey(s.B_, s.reg)),
  };
}

export class Game {
  /** @param {ReturnType<typeof officialPuzzle>|object} puzzle */
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.B = puzzle.B_;
    this.R = puzzle.R;
    this.C = puzzle.C;
    this.reg = puzzle.reg;
    /** 每格状态：null 未定 / W 气球 / B 铁球 / E 钉空 */
    this.st = new Map(puzzle.B_.cells.map(i => [i, UND]));
    this.cursor = puzzle.B_.cells[0];
    this.moves = 0;
    this.history = [];
    this.status = 'play';
  }

  /** 只放球的那几格 —— 直接交给引擎判据的那份 Map。 */
  solMap() {
    const m = new Map();
    for (const [i, v] of this.st) if (isBall(v)) m.set(i, v);
    return m;
  }

  /** @returns {string[]} 违反的条款（R1/R2/R3 前缀就是判据给的） */
  errs() {
    return this.B.check(this.reg, this.solMap());
  }

  counts() {
    const v = [...this.st.values()];
    return {
      balloons: v.filter(x => x === W).length,
      balls: v.filter(x => x === B).length,
      decided: v.filter(x => x !== UND).length,
      total: this.st.size,
      regions: new Set(this.reg.values()).size,
    };
  }

  /** 赢 = 判据 0 条违反（区数、球数、浮沉全在里面）。没有任何"填满即赢"的旁路。 */
  checkWin() {
    const errs = this.errs();
    return errs.length === 0 ? { won: true, errs } : { won: false, errs };
  }

  select(i) {
    if (this.B.black.has(i) || !this.st.has(i)) return false;
    this.cursor = i;
    return true;
  }

  /** @param {number} i @param {null|'W'|'B'|'E'} v @returns {{refused?:string,noop?:boolean,step?:object}} */
  set(i, v) {
    if (this.status === 'won') return { refused: '这一局已经结束了：按「换一局」或「重摆」再玩。' };
    if (this.B.black.has(i)) return { refused: `${this.B.name(i)} 是题面黑格：不属于任何区，也摆不了球。` };
    if (!this.st.has(i)) return { refused: `${this.B.name(i)} 不在盘上。` };
    if (this.st.get(i) === v) return { noop: true };
    const prev = this.st.get(i);
    this.st.set(i, v);
    this.history.push({ i, prev, next: v });
    this.moves++;
    this.cursor = i;
    const r = this.checkWin();
    if (r.won) this.status = 'won';
    return { step: { i, prev, next: v }, errs: r.errs };
  }

  /** 点一格 = 沿 CYCLE 走一步（未定→气球→铁球→钉空→未定）。 */
  cycle(i) {
    if (this.status === 'won' || this.B.black.has(i) || !this.st.has(i)) return this.set(i, UND);
    const cur = this.st.get(i);
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    return this.set(i, next);
  }

  undo() {
    if (this.status === 'won') return null;
    const last = this.history.pop();
    if (!last) return null;
    this.st.set(last.i, last.prev);
    this.moves--;
    this.cursor = last.i;
    return last;
  }

  /** 重摆：只清摆上去的球，题面（黑格与区）一个字都不动。 */
  clear() {
    this.st = new Map(this.B.cells.map(i => [i, UND]));
    this.history = [];
    this.moves = 0;
    this.status = 'play';
  }

  /** 赢那张牌上写的读数，全部来自引擎字段，没有一处是本页算出来的判决。 */
  winFacts() {
    const errs = this.errs();
    const c = this.counts();
    const sol = this.solMap();
    const unique = this.puzzle.sol;
    let mismatch = 0;
    if (unique) for (const i of this.B.cells) if ((sol.get(i) || null) !== (unique.get(i) || null)) mismatch++;
    return { errs: errs.length, first: errs[0] || '', mismatch, unique: !!unique, ...c, read: this.puzzle.read, nodes: this.puzzle.nodes, pencil: this.puzzle.pencilRead };
  }

  /** 独立再数一遍的证人（gen 腿用）：同一份区表交给计数器，读数必须是 "1"。 */
  recount(opts = {}) {
    return count(this.B, this.reg, { cap: DIG.cap, maxSol: DIG.maxSol, ...opts });
  }

  /** 命名铅笔：从空候选推到哪一步（页面不靠它判胜负，只把读数印出来 + 给提示用）。 */
  runPencil() {
    return pencil(this.B, this.reg, initCand(this.B));
  }

  /** 提示：铅笔在"当前已定的格"上真推出来的第一行（p.log 是字符串行，见 pencil.js 的返回契约）。 */
  hint() {
    const cand = new Map(this.B.cells.map(i => {
      const v = this.st.get(i);
      return [i, new Set(v === UND ? [W, B, E] : [v])];
    }));
    const p = pencil(this.B, this.reg, cand);
    if (p.contradiction) return { conflict: String(p.contradiction), text: '这里和题面矛盾：已摆的球里有一步推不下去了。' };
    const line = (p.log || []).map(String).find(l => l.length) || '';
    if (!line) return { stalled: true, text: p.solved ? '铅笔已经能推到底了：剩下的路是你自己的。' : '这一步铅笔推不动：先把某一格钉成不放球再试。' };
    return { rule: `铅笔 ${p.forced}/${p.total} 已钉`, text: line };
  }
}

export { mkBoard, W, B, E, UND as UNDEF, TIERS, TIERS_MEASURED, DEFAULT_TIER, tierById, official, count, pencil, initCand, sameSol, shipOne, boardKey, fnv1a, DIG };
