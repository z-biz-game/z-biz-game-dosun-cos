// 关卡内的动画回路：定步长累加器 + 帧率无关的积分。
//
// 为什么要在这里做定步长（而不是"每帧按 dt 位移一下"）：
//   浮/沉这件事在这款游戏里是**看得见的物理记号** —— 气球上下轻浮、铁球落定时的余震、
//   落子那一瞬的碎屑。如果这些量按帧 dt 累加，30Hz 与 120Hz 的机器上同一时刻的盘面
//   就不该完全一致；而"该不该一致"是能被对拍量出来的，不是嘴上说的。
//   所以：帧回调只把墙钟差累进 accum，仿真按固定 SIM_STEP 走整数步；
//   每步内部 dt 恒等于 SIM_STEP，位移写成 x += v*dt，阻尼写成 Math.pow(k, dt*60)，
//   概率/衰减写成 1 - Math.pow(1-p, dt*60) —— 没有一处 *= 0.96 或 if (Math.random() < 0.02)。
//
// 暂停 = 不再往 accum 里加时间（连帧 dt 都不吃），恢复时把 lastTs 重钉，
// 于是暂停 10 分钟回来也不会补跑一大串仿真步（那才是"暂停后盘面炸开"的成因）。
//
// reduceMotion：粒子一条都不生，浮沉幅度取 0 —— 但 simTime/simSteps 照常推进，
// 因为"静止"不等于"停摆"：计时、冷却、状态机都得继续对。

export const SIM_STEP = 1 / 120;
export const MAX_FRAME = 0.25;      // 标签页回来那一帧的 dt 上限，不补跑历史
export const BOB_AMPLITUDE = 0.055; // 单位：格宽
export const PARTICLE_LIFE = 0.62;

export class Sim {
  constructor() {
    this.simTime = 0;
    this.simSteps = 0;
    this.accum = 0;
    this.frames = 0;
    this.paused = false;
    this.reduced = false;
    this.particles = [];
    this.settle = new Map();   // 格号 → 落子余震的剩余相位（秒）
    this.dirty = false;
    this.maxParticles = 220;
  }

  /**
   * 一帧：elapsed 是**帧 dt（秒）**，只进累加器，不进仿真积分。
   * @returns {number} 这一帧跑了多少仿真步
   */
  frame(elapsed) {
    this.frames++;
    if (this.paused) { this.lastCaughtUp = this.simSteps; return 0; }
    this.accum += Math.min(MAX_FRAME, Math.max(0, elapsed));
    let n = 0;
    while (this.accum >= SIM_STEP) { this.step(SIM_STEP); this.accum -= SIM_STEP; n++; }
    return n;
  }

  /** 定步长积分：这里出现的 dt 恒等于 SIM_STEP。 */
  step(dt) {
    this.simTime += dt;
    this.simSteps++;
    let alive = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      const damp = Math.pow(0.86, dt * 60);
      p.vx *= damp;
      p.life -= dt;
      const spark = 1 - Math.pow(1 - 0.35, dt * 60);
      p.spin += spark * p.spinDir * 6;
      alive++;
    }
    if (alive !== this.particles.length) this.particles = this.particles.filter(p => p.life > 0);
    for (const [i, left] of this.settle) {
      const next = left - dt;
      if (next <= 0) this.settle.delete(i); else this.settle.set(i, next);
    }
    if (alive || this.settle.size) this.dirty = true;
  }

  /** 落子碎屑：reduceMotion 下一条都不生（幅度/粒子都归零，仿真照走）。 */
  burst(cell, kind, count = 10) {
    this.settle.set(cell, 0.34);
    this.dirty = true;
    if (this.reduced) return 0;
    const n = Math.max(0, Math.min(count, this.maxParticles - this.particles.length));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (kind === 'ball' ? Math.PI / 4 : 0);
      const speed = kind === 'ball' ? 0.55 : 0.34;
      this.particles.push({
        cell,
        x: 0, y: 0,
        vx: Math.cos(a) * speed,
        vy: kind === 'ball' ? Math.abs(Math.sin(a)) * speed : -Math.abs(Math.sin(a)) * speed,
        g: kind === 'ball' ? 1.6 : -0.9,      // 铁球的屑往下掉，气球的屑往上飘
        life: PARTICLE_LIFE * (0.6 + 0.4 * ((k % 5) / 5)),
        spin: 0,
        spinDir: k % 2 ? 1 : -1,
        kind,
      });
    }
    return n;
  }

  /** 气球浮沉偏移（单位：格宽）。reduceMotion ⇒ 恒 0。 */
  bob(cell) {
    if (this.reduced) return 0;
    return Math.sin(this.simTime * 1.7 + cell * 0.7) * BOB_AMPLITUDE;
  }

  /** 铁球落定余震：剩余相位内按阻尼衰减，出格不超过 ±0.03 格宽。 */
  shake(cell) {
    if (this.reduced) return 0;
    const left = this.settle.get(cell) || 0;
    if (!left) return 0;
    return Math.sin(left * 42) * 0.03 * (left / 0.34);
  }

  setReduced(v) { this.reduced = !!v; this.dirty = true; }
  setPaused(v) { this.paused = !!v; this.dirty = true; }

  /** 重开：时钟、步号、累加器、粒子、余震缓冲一起清零（漏一样都会被实测抓出残留）。 */
  reset() {
    this.simTime = 0;
    this.simSteps = 0;
    this.frames = 0;
    this.particles = [];
    this.settle.clear();
    this.accum = 0;
    this.dirty = true;
  }

  state() {
    return {
      simTime: this.simTime,
      simSteps: this.simSteps,
      accum: this.accum,
      frames: this.frames,
      paused: this.paused,
      reduced: this.reduced,
      particles: this.particles.length,
      settling: this.settle.size,
    };
  }
}
