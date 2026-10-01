// 音效：一条真停 AudioContext 的静音开关，不是把 gain 设 0 的假静音。
//
// 为什么较真这一条（简报 §2 点名的坑）：
//   * "静音"如果只把 master gain 设 0，振荡器节点还在一个个新建 —— 长时间玩下来节点堆积，
//     而且 Safari 上 suspended 的 ctx 与"活着但听不见"的 ctx 是两回事。
//   * 所以这里的不变量是两条，都能被外部读到：
//       1) muted 期间 play() 一个振荡器都不建（this.osc 不增长）；
//       2) 关掉音效时 ctx.suspend()，打开时 ctx.resume()，状态直接取自 AudioContext.state。
//   * 浏览器要求音频必须由用户手势解锁：所以 ctx 只在第一次"打开音效"的点击里创建，
//     页面加载即建 AudioContext 会在 iOS 上留下 "The AudioContext was not allowed to start"。
//
// 频率/时值都写死在下面这张表里：音效是"这一格放下了什么"的听觉记号，不是氛围音乐。

const TONES = {
  // 气球：往上滑的短促清亮音（"上浮"这条判据的听觉版）
  balloon: [{ f: 660, t: 0.00, d: 0.09, type: 'sine', to: 990 }],
  // 铁球：往下砸的低音
  ball: [{ f: 220, t: 0.00, d: 0.13, type: 'triangle', to: 110 }],
  mark: [{ f: 420, t: 0.00, d: 0.05, type: 'square', to: 420, g: 0.10 }],
  und: [{ f: 300, t: 0.00, d: 0.05, type: 'sine', to: 240, g: 0.12 }],
  refuse: [{ f: 150, t: 0.00, d: 0.10, type: 'sawtooth', to: 120, g: 0.10 }],
  win: [{ f: 523, t: 0.00, d: 0.12 }, { f: 659, t: 0.10, d: 0.12 }, { f: 784, t: 0.20, d: 0.16 }, { f: 1046, t: 0.32, d: 0.24 }],
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = true;          // 默认静音：网页自动播声是冒犯，且解锁必须由手势触发
    this.osc = 0;               // 累计建过的振荡器数（静音期间必须一条不动）
    this.refused = 0;           // 静音期间被 play() 挡掉的次数
    this.errors = 0;
  }

  static supported() {
    return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
  }

  /** 只有非静音态才会真的建 ctx —— 建 ctx 这件事本身就是"要出声"的承诺。 */
  ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!Ctor) { this.errors++; return null; }
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.ctx.destination);
      } catch { this.errors++; return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { this.errors++; });
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) {
      // 真停：整个上下文挂起，时钟不再走，已排队的音也一起停住。
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => { this.errors++; });
    } else {
      this.ensure();
    }
    return this.state();
  }

  /** @param {keyof typeof TONES} kind @returns {boolean} 是否真的发声了 */
  play(kind) {
    const spec = TONES[kind];
    if (!spec) return false;
    if (this.muted) { this.refused++; return false; }
    const ctx = this.ensure();
    if (!ctx) return false;
    const t0 = ctx.currentTime;
    for (const n of spec) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      this.osc++;
      osc.type = n.type || 'sine';
      osc.frequency.setValueAtTime(n.f, t0 + n.t);
      if (n.to && n.to !== n.f) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.t + n.d);
      const peak = n.g == null ? 0.9 : n.g;
      g.gain.setValueAtTime(0.0001, t0 + n.t);
      g.gain.exponentialRampToValueAtTime(peak, t0 + n.t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
      osc.connect(g); g.connect(this.master);
      osc.start(t0 + n.t);
      osc.stop(t0 + n.t + n.d + 0.02);
      osc.onended = () => { try { g.disconnect(); } catch { /* 已断开 */ } };
    }
    return true;
  }

  state() {
    return { muted: this.muted, osc: this.osc, refused: this.refused, ctx: this.ctx ? this.ctx.state : 'none', errors: this.errors };
  }
}

export { TONES };
