// Canvas 渲染：只读引擎状态画图，自己不判任何一条规则 —— 于是画面不可能和判据表打架。
// 布局也留在这里（格宽、棋盘原点、DPR），因为 hitCell 必须用 draw 用过的同一套数字：
// 这两处一旦各走各的，就会出现"画得对、点下去偏一格"。
//
// 区域底色只按 **区号** 上色（区号是引擎发的），不按答案上色：玩家摆对摆错都不会被颜色剧透。
// 违反条款的高亮走的是 rules.js 的 check() 返回的文本里那些格子名 —— 只是把 already-reported
// 的格子涂红，不新增任何判断。

import { W, B, E } from '../engine/rules.js';
import { PARTICLE_LIFE } from './anim.js';

// 44 CSS px 是触摸下限：34px 的格宽在桌面上没问题，在手机上就是"点 A 打 B"。
export const Cell = { min: 44, max: 88 };
export const SPRITE = { pieces: 'assets/sprites/pieces-128.png', paper: 'assets/textures/paper-256.png' };
/** 值 → sprite 帧号（横排 3 帧：气球 / 铁球 / 钉空）。 */
export const frameOf = v => (v === W ? 0 : v === B ? 1 : v === E ? 2 : -1);
const INK = {
  bg: '#10131a',
  cell: '#232837',
  cellAlt: '#1d2230',
  black: '#05070b',
  thin: '#39415230',
  border: '#5b6478',
  region: '#c9d4e8',
  cursor: '#5ec8ff',
  balloon: '#f2f4f7',
  balloonRing: '#8f9bb0',
  ball: '#3b4250',
  ballRing: '#cfd6e4',
  mark: '#6d7789',
  bad: '#ff6b6b',
  sparkBalloon: '#dfe6f2',
  sparkBall: '#7d8798',
};

/** 相对当前文档解析：Pages 把仓挂在 /z-biz-game-dosun-cos/ 前缀下，写死 '/assets/…' 会 404。 */
export function assetUrl(rel) {
  if (typeof document !== 'undefined' && document.baseURI) {
    try { return new URL(rel, document.baseURI).href; } catch { return rel; }
  }
  return rel;
}

export function layoutFor(R, C, availW, availH) {
  const pad = 12;
  const size = Math.min((availW - pad * 2) / C, (availH - pad * 2) / R);
  const cell = Math.max(Cell.min, Math.min(Cell.max, Math.floor(size)));
  return { cell, boardW: cell * C, boardH: cell * R, pad };
}

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = { cell: 0, x: 0, y: 0, w: 0, h: 0, dpr: 1 };
    this.game = null;
    /** 位图资产：解不出来的一直是 null，draw() 走矢量回落 —— 页面不会因为一张图而白屏 */
    this.art = { pieces: null, paper: null, pattern: null };
    this.loadArt();
  }

  /** 加载仓内现画的 sprite 表与纸纹（assets/gen/make_art.py 的产物）。 */
  loadArt() {
    if (typeof Image === 'undefined') return this.art;
    const pieces = new Image();
    pieces.onload = () => { this.art.pieces = pieces; this.dirty = true; };
    pieces.src = assetUrl(SPRITE.pieces);
    const paper = new Image();
    paper.onload = () => {
      this.art.paper = paper;
      this.art.pattern = this.ctx.createPattern(paper, 'repeat');
      this.dirty = true;
    };
    paper.src = assetUrl(SPRITE.paper);
    return this.art;
  }

  // 背板按设备像素铺，绘制留在 CSS 像素：顶部一次 ctx.scale，Retina 上字与圈都清楚，
  // 而且这个文件里每个常量只有一份。
  resize(game, availW, availH) {
    const l = layoutFor(game.R, game.C, availW, availH);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const w = l.boardW + l.pad * 2;
    const h = l.boardH + l.pad * 2;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geo = { cell: l.cell, x: l.pad, y: l.pad, w, h, dpr };
    this.game = game;
    return this.geo;
  }

  cellRect(i) {
    const { cell, x, y } = this.geo;
    const [r, c] = this.game.B.rc(i);
    return { x: c * cell + x, y: r * cell + y, size: cell };
  }

  hitCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, x, y } = this.geo;
    const g = this.game;
    if (!cell || !g) return -1;
    // CSS 缩放换算：canvas 的 rect 宽度与 geo.w 不一定相等（窄屏上被 CSS 收窄过），
    // 不除这个比例，手机上就是"点 A 打 B"。
    const sx = rect.width > 0 && this.geo.w ? rect.width / this.geo.w : 1;
    const sy = rect.height > 0 && this.geo.h ? rect.height / this.geo.h : 1;
    const px = (clientX - rect.left) / sx - x;
    const py = (clientY - rect.top) / sy - y;
    if (px < 0 || py < 0) return -1;
    const c = Math.floor(px / cell);
    const r = Math.floor(py / cell);
    if (r < 0 || c < 0 || c >= g.C || r >= g.R) return -1;
    return g.B.id(r, c);
  }

  /** check() 的条款文本里带 rXcY 格名；只用来把已经报出来的格子涂红。 */
  badCells(errs) {
    const g = this.game;
    const s = new Set();
    if (!errs || !errs.length) return s;
    const byName = new Map(g.B.cells.map(i => [g.B.name(i), i]));
    for (const e of errs) {
      for (const m of e.matchAll(/r\d+c\d+/g)) {
        const i = byName.get(m[0]);
        if (i !== undefined) s.add(i);
      }
    }
    return s;
  }

  draw(game, sim = null, { pulse = null } = {}) {
    this.game = game;
    const { ctx, geo } = this;
    const { cell, x: ox, y: oy } = geo;
    const B_ = game.B;
    const bad = this.badCells(game.errs());

    ctx.clearRect(0, 0, geo.w, geo.h);
    ctx.fillStyle = INK.bg;
    ctx.fillRect(0, 0, geo.w, geo.h);
    if (this.art.pattern) {
      // 纸纹只当质感：alpha 压到 0.5 以下，区底色的深浅差仍然读得出来
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = this.art.pattern;
      ctx.fillRect(0, 0, geo.w, geo.h);
      ctx.restore();
    }

    // 1) 格子底色：题面黑格 / 区底色（区号决定，和答案无关）
    for (const i of B_.cells) {
      const [r, c] = B_.rc(i);
      const k = game.reg.get(i);
      ctx.fillStyle = k % 2 ? INK.cellAlt : INK.cell;
      ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
    }
    for (const i of B_.black) {
      const [r, c] = B_.rc(i);
      ctx.fillStyle = INK.black;
      ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
    }

    // 2) 细线：同一区内部的分隔
    ctx.strokeStyle = INK.thin;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const i of B_.cells) {
      const [r, c] = B_.rc(i);
      const x = ox + c * cell;
      const y = oy + r * cell;
      const right = c + 1 < game.C ? B_.id(r, c + 1) : null;
      const down = r + 1 < game.R ? B_.id(r + 1, c) : null;
      if (right !== null && !B_.black.has(right) && game.reg.get(right) === game.reg.get(i)) {
        ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell);
      }
      if (down !== null && !B_.black.has(down) && game.reg.get(down) === game.reg.get(i)) {
        ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y + cell);
      }
    }
    ctx.stroke();

    // 3) 粗线：区界（不同区之间）与外墙/黑格边
    ctx.strokeStyle = INK.border;
    ctx.lineWidth = Math.max(2, Math.round(cell * 0.09));
    ctx.beginPath();
    const seg = (x1, y1, x2, y2) => { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); };
    for (const i of B_.cells) {
      const [r, c] = B_.rc(i);
      const x = ox + c * cell;
      const y = oy + r * cell;
      const right = c + 1 < game.C ? B_.id(r, c + 1) : null;
      if (right === null || B_.black.has(right) || game.reg.get(right) !== game.reg.get(i)) seg(x + cell, y, x + cell, y + cell);
      const left = c - 1 >= 0 ? B_.id(r, c - 1) : null;
      if (left === null || B_.black.has(left) || game.reg.get(left) !== game.reg.get(i)) seg(x, y, x, y + cell);
      const down = r + 1 < game.R ? B_.id(r + 1, c) : null;
      if (down === null || B_.black.has(down) || game.reg.get(down) !== game.reg.get(i)) seg(x, y + cell, x + cell, y + cell);
      const up = r - 1 >= 0 ? B_.id(r - 1, c) : null;
      if (up === null || B_.black.has(up) || game.reg.get(up) !== game.reg.get(i)) seg(x, y, x + cell, y);
    }
    ctx.stroke();

    // 4) 摆上去的东西：有位图走位图（assets/sprites/pieces-128.png 的三帧），
    //    位图还没解出来（首帧、或 file:// 下被拒）走同一套几何的矢量回落。
    const sheet = this.art.pieces;
    if (sheet) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
    for (const i of B_.cells) {
      const v = game.st.get(i);
      if (v === undefined || v === null) continue;
      const rect = this.cellRect(i);
      // 气球随定步长仿真轻浮，铁球只在落定后的余震里晃一下；reduceMotion ⇒ 两个都是 0。
      const dy = sim ? (v === W ? -sim.bob(i) * cell : sim.shake(i) * cell) : 0;
      const cx = rect.x + cell / 2;
      const cy = rect.y + cell / 2 + dy;
      const rad = cell * 0.31;
      const frame = sheet ? frameOf(v) : -1;
      if (frame >= 0) {
        const fw = sheet.width / 3;
        const size = cell * 0.9;
        ctx.drawImage(sheet, frame * fw, 0, fw, sheet.height, cx - size / 2, cy - size / 2, size, size);
        continue;
      }
      if (v === W) {
        ctx.fillStyle = INK.balloon;
        ctx.beginPath(); ctx.arc(cx, cy - cell * 0.04, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = INK.balloonRing; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy - cell * 0.04, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy + rad - cell * 0.04); ctx.lineTo(cx, cy + cell * 0.34); ctx.stroke();
      } else if (v === B) {
        ctx.fillStyle = INK.ball;
        ctx.beginPath(); ctx.arc(cx, cy + cell * 0.04, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = INK.ballRing; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy + cell * 0.04, rad, 0, Math.PI * 2); ctx.stroke();
      } else if (v === E) {
        ctx.strokeStyle = INK.mark; ctx.lineWidth = 2;
        const d = cell * 0.13;
        seg(cx - d, cy - d, cx + d, cy + d); seg(cx + d, cy - d, cx - d, cy + d);
      }
    }

    // 5) 违反条款点到的格子（读数来自 check()）
    ctx.strokeStyle = INK.bad; ctx.lineWidth = 2;
    for (const i of bad) {
      const rect = this.cellRect(i);
      ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, cell - 3, cell - 3);
    }

    // 5.5) 落子碎屑：位置由 js/render/anim.js 的定步长积分给，这里只按 life 淡出
    if (sim && sim.particles.length) {
      for (const p of sim.particles) {
        const rect = this.cellRect(p.cell);
        const a = Math.max(0, Math.min(1, p.life / PARTICLE_LIFE));
        const size = cell * (0.06 + 0.05 * a);
        ctx.fillStyle = (p.kind === 'ball' ? INK.sparkBall : INK.sparkBalloon) + Math.round(a * 210).toString(16).padStart(2, '0');
        ctx.save();
        ctx.translate(rect.x + cell / 2 + p.x * cell, rect.y + cell / 2 + p.y * cell);
        ctx.rotate(p.spin);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }

    // 6) 光标
    if (game.cursor >= 0 && B_.cells.includes(game.cursor)) {
      const rect = this.cellRect(game.cursor);
      ctx.strokeStyle = pulse && pulse.cell === game.cursor ? INK.mark : INK.cursor;
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x + 2, rect.y + 2, cell - 4, cell - 4);
    }

    // 7) 区域外圈坐标读数（每区一只气球一只铁球的记账留给面板，这里只标区号）
    ctx.fillStyle = INK.region;
    ctx.font = `${Math.max(9, Math.round(cell * 0.22))}px ui-monospace, monospace`;
    const seen = new Set();
    for (const i of B_.cells) {
      const k = game.reg.get(i);
      if (seen.has(k)) continue;
      seen.add(k);
      const rect = this.cellRect(i);
      ctx.fillText(String.fromCharCode(65 + (k % 26)), rect.x + 3, rect.y + Math.max(10, cell * 0.22));
    }
  }
}

export { INK };
