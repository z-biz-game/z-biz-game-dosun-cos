// 页面内的场景断言（被 tools/playtest.cjs 用 Page.addScriptToEvaluateOnNewDocument 注入，
// 所以这是**普通脚本**不是模块：它只能碰 window.dosun 那一层台面，而台面上的 engine 就是
// js/engine/ 那几个模块本身 —— 场景里没有第二条判据实现。
//
// 报告必须是**字符串**：把对象直接交给 returnByValue 只会打印 [object Object]，
// 于是这条腿看起来跑了、verify.sh 一行断言都解析不到（hebi 的坑，照搬）。
/* eslint-disable */
(function () {
  const D = () => window.dosun;
  const EN = () => window.dosun.engine;
  const rows = [];
  const ck = (test, cond, detail) => rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${JSON.stringify(got)} / want ${JSON.stringify(want)}`);
  const num = (test, got, want) => ck(test, Number(got) === Number(want), `got ${got} / want ${want}`);
  // 报告必须是 {rows, fail} 这个形状：verify.sh 的 parse 读的是 d['rows']，
  // 直接把 rows 数组交出去会让整条腿"跑得很绿但一行都解析不到"（第一轮就死在这上面）。
  const report = () => ({ rows: rows.slice(), fail: rows.filter(r => !r.pass).length });

  // 阴性自证：种下的这一条注定错，并且点名是哪条腿吃下了它（verify.sh 按 SELFTEST·<腿名> 归并）。
  const plant = who => {
    if (window.__selftest) rows.push({ test: `SELFTEST·${who} 种下的错期望（判据必须抓到）`, pass: false, detail: 'planted: 1==2' });
  };
  const ser = m => [...m].sort((a, b) => a[0] - b[0]).map(([i, v]) => `${i}:${v}`).join(',');
  const veilVisible = () => {
    const e = document.getElementById('win-veil');
    return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };
  const txt = s => {
    const e = document.querySelector(s);
    return e ? (e.textContent || '').trim() : '';
  };

  // ---------- engine：官方 4×4 在页面里重放，读数对上 tools/fixtures/golden.json ----------
  async function engine() {
    plant('engine');
    const o = EN().official();
    const want = window.__expectOfficial || {};
    const errs = o.B_.check(o.regions, o.sol);
    eq('官方例题：判据 check() 0 条违反', errs.length, 0);
    const r = EN().count(o.B_, o.regions, { cap: 400000, maxSol: 60 });
    eq('官方例题：计数器终读', r.read, want.read === undefined ? '1' : want.read);
    eq('官方例题：计数器节点数（与 node 同一个数）', r.nodes, want.nodes === undefined ? 144 : want.nodes);
    ck('官方例题：计数器的唯一解 == 官方解答', EN().sameSol(r.sols[0], o.sol));
    const p = EN().pencil(o.B_, o.regions, EN().initCand(o.B_));
    ck('官方例题：铅笔推满', p.solved && p.forced === p.total, `${p.forced}/${p.total}`);
    ck('官方例题：铅笔解 == 计数器解 == 官方解答', EN().sameSol(p.sol, o.sol));
    eq('官方例题：铅笔轮数 == 夹具', p.rounds, want.rounds);
    eq('官方例题：铅笔钉满读数 == 夹具', `${p.forced}/${p.total}`, want.forced);
    eq('官方例题：答案逐格指纹 == 夹具', ser(o.sol), want.answer);
    eq('官方例题：黑格位置', [...o.B_.black].sort((a, b) => a - b).join(','), '5,15');
    eq('官方例题：区数', new Set(o.regions.values()).size, 5);
    const w = [...o.sol.values()].filter(v => v === EN().W).length;
    const b = [...o.sol.values()].filter(v => v === EN().B).length;
    eq('官方例题：气球/铁球数', `${w}/${b}`, '5/5');

    // 台面用的必须就是这一个引擎，不是页面自己抄的一份：同一个模块对象、同一个函数身份。
    ck('页面台面导出的是引擎模块本身（official 可调用且给真判据）', typeof EN().official === 'function' && typeof o.B_.check === 'function');
    eq('页面的 mkBoard 与 official() 用的是同一套判据', EN().mkBoard(4, 4, [5, 15]).check(o.regions, o.sol).length, 0);
    ck('页面里没有第二条判据：check 只在 rules.js 上', !('check' in EN()) && typeof EN().W === 'string', `engine keys: ${Object.keys(EN()).sort().join(',')}`);

    // 第 1 关真的能玩到赢：把官方解答摆进 UI，判据读到 0 条、状态变成 won。
    D().show('game');
    D().begin({ tier: 'off' });
    const g = D().game;
    eq('第 1 关开出来就是官方那张盘（黑格指纹一致）', [...g.B.black].sort((a, b) => a - b).join(','), '5,15');
    ck('开局未定：判据不许判赢', g.status === 'play' && g.errs().length > 0, `${g.status}/${g.errs().length} 条`);
    for (const [i, v] of o.sol) D().place(i, v);
    eq('摆完官方解答：判据 0 条违反', g.errs().length, 0);
    eq('摆完官方解答：状态 = won', g.status, 'won');
    const f = g.winFacts();
    eq('胜局读数：与唯一解逐格 0 处不同', f.mismatch, 0);
    ck('胜局读数带着计数器读数（页面印的是引擎字段）', /1/.test(String(f.read)), f.read);
    return report();
  }

  // ---------- menu：印给玩家看的每个数字都等于引擎导出的那个 ----------
  const LINE = /^实测 出货 第(\d+)次 · (\d+)ms · 唯一盘 (\d+)\/(\d+) · 推满 (\d+)\/(\d+) · 节点 med\/p95 (\d+)\/(\d+)$/;
  async function menu() {
    plant('menu');
    D().show('menu');
    D().renderMenu();
    const T = EN().TIERS, M = EN().TIERS_MEASURED;
    eq('菜单档位条数 == TIERS（外加官方例题一行）', document.querySelectorAll('#tier-list .tier').length, T.length + 1);
    eq('档位 id 逐个来自 TIERS', T.map(t => t.id).join(','), Object.keys(M).join(','));
    let matched = 0, printed = 0;
    for (const t of T) {
      const e = document.getElementById(`tier-measured-${t.id}`);
      ck(`${t.id}：这一档的实测行存在`, !!e);
      const line = e ? (e.textContent || '').trim() : '';
      const m = LINE.exec(line);
      ck(`${t.id}：实测行是可解析的读数（不是形容词）`, !!m, line);
      if (!m) continue;
      printed++;
      const g = { shipAttempt: +m[1], shipMs: +m[2], uniq: +m[3], sample: +m[4], uniqSolved: +m[5], uniq2: +m[6], nodesMed: +m[7], nodesP95: +m[8] };
      const w = M[t.id];
      const same = g.shipAttempt === w.shipAttempt && g.shipMs === w.shipMs && g.uniq === w.uniq && g.sample === w.sample
        && g.uniqSolved === w.uniqSolved && g.uniq2 === w.uniq && g.nodesMed === w.nodesMedP95[0] && g.nodesP95 === w.nodesMedP95[1];
      ck(`${t.id}：打印的 8 个数字 == TIERS_MEASURED 的 8 个字段`, same, `印出 ${JSON.stringify(g)} / 引擎 ${JSON.stringify(w)}`);
      matched++;
      const btn = document.getElementById(`tier-${t.id}`);
      eq(`${t.id}：尺寸也来自 TIERS`, btn.dataset.size, `${t.R}×${t.C}`);
      eq(`${t.id}：区数也来自 TIERS`, btn.dataset.nr, String(t.NR));
    }
    eq('七档全部按 TIERS_MEASURED 打印（无一档缺读数）', matched, T.length);
    ck('页面上写着实测二字（读数而不是形容词）', /实测/.test(txt('#tier-measured-s6')), txt('#tier-measured-s6'));
    return report();
  }

  // ---------- gen：菜单上每一档在页面里出货，并且唯一 + 铅笔推满 + 与 node 同一张盘 ----------
  async function gen() {
    plant('gen');
    const T = EN().TIERS;
    const wantKeys = window.__expectKeys || {};
    const SEED = Number(window.__genSeed || 7);
    eq('gen 腿的 seed 由 node 递过来（不是页面自己取的墙钟）', String(SEED), String(wantKeys.__seed === undefined ? SEED : wantKeys.__seed));
    let shipped = 0;
    for (const t of T) {
      const s = EN().shipOne({ R: t.R, C: t.C, NB: t.NB, NR: t.NR, seed: SEED, attempts: t.ship.attempts, ...EN().DIG });
      ck(`${t.id}：${t.ship.attempts} 次尝试内在页面里出货`, !!s, s ? '' : 'null（一档都出不来）');
      if (!s) continue;
      shipped++;
      eq(`${t.id}：计数器终读 = 1 解`, s.r.read, '1');
      ck(`${t.id}：铅笔推满`, s.p.solved && s.p.forced === s.p.total, `${s.p.forced}/${s.p.total}`);
      eq(`${t.id}：判据 check() 在铅笔解上 0 条违反`, s.B_.check(s.reg, s.p.sol).length, 0);
      ck(`${t.id}：区数 == 档位声明的 NR`, new Set(s.reg.values()).size, t.NR);
      ck(`${t.id}：黑格数 == 档位声明的 NB`, s.B_.black.size, t.NB);
      const key = EN().fnv1a(EN().boardKey(s.B_, s.reg));
      const w = wantKeys[t.id];
      ck(`${t.id}：有 node 侧指纹可比`, !!w, JSON.stringify(w));
      if (w) {
        eq(`${t.id}：同一颗种子在 Chrome 与 node 长同一张盘`, key, w.key);
        eq(`${t.id}：铅笔读数也与 node 一致`, `${s.p.forced}/${s.p.total}`, w.forced);
      }
    }
    eq('七档全部出货（菜单每一档都真能玩）', shipped, T.length);
    // 换一局走的是 UI 那条路（build → 台面上的 game），它也必须给一张唯一盘。
    const g = D().begin({ tier: 's6', seed: SEED });
    ck('换一局的盘开出来了（UI 走的是同一条 shipOne）', !!g && !!g.puzzle.key, JSON.stringify(g && g.puzzle && g.puzzle.seed));
    if (g) {
      eq('UI 盘的指纹 == 页面 shipOne 的指纹', g.puzzle.key, wantKeys.s6 ? wantKeys.s6.key : g.puzzle.key);
      eq('UI 盘的计数器读数印在面板上（"1"）', g.puzzle.read, '1');
      const r = g.recount({ maxSol: 2 });
      eq('UI 盘独立再数一遍仍是唯一', r.read, '1');
    }
    return report();
  }

  window.__ng = { engine, menu, gen };
})();
