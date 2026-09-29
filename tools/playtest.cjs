// Minimal CDP driver for headless playtesting (Node 22+ global WebSocket/fetch).
//
// env: CDP_PORT (devtools port, default 9367), BASE_URL (page origin),
//      EXPECT_OFFICIAL / EXPECT_KEYS / GEN_SEED（node 侧算好的证人，递进页面去比）,
//      GATE_SELFTEST=1（让 scenarios.js 在每条报告里种一条注定错的期望）
//
//   node tools/playtest.cjs open <url>           新标签页打开 <url>，打印 boot 读数
//   node tools/playtest.cjs eval '<expr>' [nonav] 求值（await promise）
//   node tools/playtest.cjs scenario <name>      注入 tools/scenarios.js 跑 __ng.<name>()
//   node tools/playtest.cjs leg play             真指针 + 真按键（CDP Input.dispatch*）走到赢
//   node tools/playtest.cjs shot <file.png> / logs
//
// 选哪一个页面靠 BASE_URL 的 origin 决定，不靠硬编码端口：一条 eval 悄悄落在 about:blank 上，
// 读起来就像"部署坏了"而不是"测试写错了"。
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9367);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5267/';
const ORIGIN = new URL(BASE).origin;
const SELFTEST = process.env.GATE_SELFTEST === '1';
const cmd = process.argv[2];
const arg = process.argv[3];
const rest = process.argv[4];
const isOurs = u => typeof u === 'string' && u.startsWith(ORIGIN);

const logs = [];
const rows = [];
const ck = (test, cond, detail) => rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${JSON.stringify(got)} / want ${JSON.stringify(want)}`);
const result = extra => ({ rows: rows.slice(), fail: rows.filter(r => !r.pass).length, ...extra });
const out = extra => {
  const r = result(extra);
  if (logs.length) console.error(logs.slice(-40).join('\n'));
  console.log('RESULT ' + JSON.stringify(r));
};
const evidence = o => console.log('EVIDENCE ' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' '));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) this.consume(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  consume(m) {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map(a => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') logs.push(`[log:error] ${e.text} ${e.url || ''}`);
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForDevTools(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch { /* not bound yet */ }
    if (Date.now() > deadline) throw new Error(`devtools never bound on :${PORT}`);
    await sleep(250);
  }
}

async function main() {
  const info = await waitForDevTools();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) {
      if (t.type === 'page' && isOurs(t.url)) {
        try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone */ }
      }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find(t => t.type === 'page' && isOurs(t.url));
  let sessionId;
  if (existing) {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: existing.id || existing.targetId, flatten: true }));
  } else {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const evaluate = async expression => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 900000 }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const json = async expression => JSON.parse(await evaluate(`JSON.stringify((${expression}))`));

  const ready = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await evaluate('document.readyState').catch(() => 'loading');
      if (s === 'complete') return;
      await sleep(100);
    }
  };
  const navigate = async url => {
    await cdp.send('Page.navigate', { url }, sessionId);
    await ready();
    await sleep(200);
  };
  // 只差一个 hash 的 URL 是 same-document navigation：所以"这条腿必须落在新文档"走 Page.reload。
  const gotoFresh = async (url = BASE) => {
    const cur = String(await evaluate('location.href').catch(() => ''));
    const cut = u => u.split('#')[0];
    if (cur && cut(cur) === cut(url)) {
      await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
      await ready();
      await sleep(200);
    } else await navigate(url);
  };
  const docInfo = () =>
    evaluate(`(()=>{const d=window.dosun;return {url:location.href,to:performance.timeOrigin,doc:d?d.doc:'(no window.dosun)',boot:!!d};})()`)
      .catch(e => ({ url: 'unknown', to: 0, doc: 'ERR:' + e.message, boot: false }));

  // ---------- 页面几何：先量 hit box，再谈"点得到" ----------
  const PREP = `(()=>{
    const d=window.dosun, h=d.view, g=d.game;
    if(!g) throw new Error('no game on screen');
    const rect=h.canvas.getBoundingClientRect();
    const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName):'null';};
    const o={rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height},iw:innerWidth,dpr:devicePixelRatio,
      R:g.R,C:g.C,seed:g.puzzle.seed,tier:g.puzzle.tier,cells:[],blackCells:[],sol:[],btns:[],sweepTotal:g.B.cells.length,sweepHits:0,sweepMiss:0};
    for(const i of g.B.cells){const r=h.cellRect(i);const x=rect.left+r.x+r.size/2,y=rect.top+r.y+r.size/2;
      const hit=at(x,y); if(hit==='board')o.sweepHits++;else o.sweepMiss++;
      o.cells.push({i,name:g.B.name(i),x,y,hit});}
    for(const i of g.B.black){const r=h.cellRect(i);const x=rect.left+r.x+r.size/2,y=rect.top+r.y+r.size/2;
      o.blackCells.push({i,name:g.B.name(i),x,y,hit:at(x,y)});}
    const off=d.engine.official();
    for(const [i,v] of off.sol){const r=h.cellRect(i);o.sol.push({i,v,name:off.B_.name(i),
      x:rect.left+r.x+r.size/2,y:rect.top+r.y+r.size/2,hit:at(rect.left+r.x+r.size/2,rect.top+r.y+r.size/2)});}
    for(const id of ['btn-w','btn-b','btn-e','btn-u','btn-undo','btn-new','btn-clear','btn-menu']){
      const e=document.getElementById(id);if(!e)throw new Error('missing #'+id);
      const b=e.getBoundingClientRect();const x=b.left+b.width/2,y=b.top+b.height/2;
      o.btns.push({id,x,y,hit:at(x,y),w:Math.round(b.width),h:Math.round(b.height)});}
    return o;})()`;

  const STATE = `(()=>{const g=window.dosun.game;const e=document.getElementById('win-veil');
    const t=s=>{const n=document.querySelector(s);return n?(n.textContent||'').trim():''};
    return {cursor:g.cursor,moves:g.moves,status:g.status,
      st:[...g.st].map(([i,v])=>i+':'+(v||'-')).join(','),
      errs:g.errs().length,first:g.errs()[0]||'',
      counts:g.counts(),veil:e?getComputedStyle(e).display!=='none'&&e.getClientRects().length>0:false,
      time:t('#stat-time'),conflicts:t('#stat-conflicts'),filled:t('#stat-filled'),
      balloons:t('#stat-balloons'),balls:t('#stat-balls'),movesDom:t('#stat-moves'),
      stateLine:t('#state-line'),winMeta:t('#win-meta'),winRecord:t('#win-record'),seed:t('#stat-seed'),
      measured:t('#stat-measured'),genms:t('#stat-genms'),doc:window.dosun.doc};})()`;

  const mouse = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(60);
  };
  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] }, sessionId);
    await sleep(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    await sleep(60);
  };
  // 绝不给 nativeVirtualKeyCode：macOS 上 Chrome 把它当平台原生键码，raw keyboard 会把同一只键
  // 反复补发（hebi 实测 520ms 内 3664 次 keydown）。只给 windowsVirtualKeyCode，让 Chrome 自己推。
  const key = async k => {
    const map = { ArrowRight: 'ArrowRight', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ' ': 'Space', w: 'KeyW', b: 'KeyB', x: 'KeyX', z: 'KeyZ', Backspace: 'Backspace' };
    const vk = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, ' ': 32, w: 87, b: 66, x: 88, z: 90, Backspace: 8 };
    const text = k.length === 1 ? k : undefined;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: map[k], text, windowsVirtualKeyCode: vk[k] }, sessionId);
    if (text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await sleep(60);
  };
  const stOf = () => json(STATE);
  const one = (st, i) => {
    const p = String(st.st).split(',').find(x => x.startsWith(i + ':'));
    return p ? p.split(':')[1] : '(absent)';
  };

  // ---------- commands ----------
  if (cmd === 'open') {
    await navigate(arg || BASE);
    const d = await docInfo();
    evidence({ url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (rest !== 'nonav') await navigate(BASE);
    const v = await evaluate(arg);
    console.log(typeof v === 'string' ? v : JSON.stringify(v));
  } else if (cmd === 'scenario') {
    const src = fs.readFileSync(path.join(__dirname, 'scenarios.js'), 'utf8');
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src }, sessionId);
    await gotoFresh(BASE);
    await evaluate(`window.__selftest=${SELFTEST};
      window.__expectOfficial=${process.env.EXPECT_OFFICIAL || 'null'};
      window.__expectKeys=${process.env.EXPECT_KEYS || 'null'};
      window.__genSeed=${JSON.stringify(process.env.GEN_SEED || '7')};'ok'`);
    // headless 会把页面报成 hidden，渲染回路允许在 hidden 时跳帧 —— 所以把可见性钉回 visible。
    await evaluate(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
      Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'ok'`);
    const d = await docInfo();
    evidence({ scenario: arg, url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    const res = await evaluate(`(async()=>{
      if (!window.__ng) throw new Error('scenarios.js never installed');
      return JSON.stringify(await window.__ng[${JSON.stringify(arg)}]());
    })()`);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId).catch(() => {});
    if (logs.length) console.error(logs.slice(-40).join('\n'));
    console.log('RESULT ' + res);
  } else if (cmd === 'leg') {
    await leg();
  } else if (cmd === 'shot') {
    await cdp.send('Page.bringToFront', {}, sessionId);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(arg), { recursive: true });
    fs.writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg);
  } else if (cmd === 'logs') {
    console.log(logs.join('\n') || '(clean)');
  } else {
    console.error('unknown command: ' + cmd);
    process.exit(64);
  }
  ws.close();
  process.exit(0);

  // ---------- 真事件腿：指针点到赢（CDP Input.*，不是页内 new Event） ----------
  async function leg() {
    await gotoFresh(BASE);
    await evaluate(`(()=>{ if(!window.dosun.game) window.dosun.begin({tier:'off'}); return 1; })()`);
    await sleep(200);
    const p = await json(PREP);
    const d0 = await docInfo();
    evidence({ leg: arg, url: d0.url, timeOrigin: d0.to, doc: d0.doc, innerWidth: p.iw, dpr: p.dpr, seed: p.seed, cells: p.cells.length });
    if (SELFTEST) ck(`SELFTEST·${arg} 种下的错期望（判据必须抓到）`, false, 'planted: 1==2');

    eq('hit box：棋盘每一格中心都落在 canvas 上', p.sweepMiss, 0);
    eq(`hit box：${p.cells.length} 个空格全命中（一格不漏）`, p.sweepHits, p.sweepTotal);
    eq('hit box：按钮中心都落在自己上', p.btns.filter(b => b.hit !== b.id).map(b => b.hit + '@' + b.id).join(','), '');
    ck('按钮都够点（>=34px 高）', p.btns.every(b => b.h >= 34), JSON.stringify(p.btns.map(b => b.h)));
    eq('hit box：题面黑格的命中元素也是 canvas', p.blackCells.map(b => b.hit).join(','), p.blackCells.map(() => 'board').join(','));
    eq('hit box：官方解答要摆的 10 格命中元素都是 canvas', p.sol.filter(s => s.hit !== 'board').map(s => s.hit + '@' + s.name).join(','), '');

    // 黑格点不动：真点一下，状态与光标都不许变
    const blk = p.blackCells[0];
    const beforeBlack = await stOf();
    await mouse(blk.x, blk.y);
    const afterBlack = await stOf();
    eq(`黑格 ${blk.name} 点不动：光标没跳`, afterBlack.cursor, beforeBlack.cursor);
    ck('状态行说出了为什么（点了黑格）', /黑格/.test(afterBlack.stateLine), afterBlack.stateLine);

    // 一格循环：未定 → 气球 → 铁球 → 钉空 → 未定（四下走满一圈）
    const c0 = p.cells[0];
    const seq = ['-', 'W', 'B', 'E', '-'];
    for (let k = 0; k < seq.length; k++) {
      const s = await stOf();
      eq(`循环第 ${k} 次读数：格 ${c0.name} 的状态`, one(s, c0.i), seq[k]);
      if (k < seq.length - 1) await mouse(c0.x, c0.y);
    }
    eq('四次点击走完一圈（回到未定）', one(await stOf(), c0.i), '-');

    // "看着填满"赢不了：把每一个空格都点成气球（14 下真点击），判据必须还有一堆违反
    for (const c of p.cells) await mouse(c.x, c.y);
    const full = await stOf();
    eq('填满 14 格之后：已定格读数 = 空格数', full.counts.decided, p.cells.length);
    ck('填满但摆错：状态仍然不是 won', full.status !== 'won', full.status);
    ck('填满但摆错：判据给出的违反条数 > 0', full.errs > 0, `${full.errs} 条`);
    ck('面板上的违反读数与判据同步', full.conflicts, String(full.errs));
    ck('状态行把第一条违反说出来了', /R\d/.test(full.first) && /违反/.test(full.stateLine), `${full.stateLine}`);
    eq('胜负幕布还没揭开', full.veil, 'false');

    // 重摆：只清球，题面不动
    const bClear = p.btns.find(b => b.id === 'btn-clear');
    await mouse(bClear.x, bClear.y);
    const cleared = await stOf();
    eq('重摆之后已定格归零', cleared.counts.decided, 0);
    eq('重摆之后步数归零', cleared.moves, '0');
    eq('重摆之后黑格还在（题面没被动过）', await json('window.dosun.game.B.black.size'), String(p.blackCells.length));
    ck('重摆的说明写进了状态行', /重摆/.test(cleared.stateLine), cleared.stateLine);

    // 键盘路：方向键移动光标 + W/B 落子（都是真按键）。起点先用真点击把光标钉死在一格上，
    // 再点「重摆」把状态清干净 —— 不清的话这一格已经是气球，按键段的读数就不是从 0 开始。
    await mouse(p.cells[0].x, p.cells[0].y);
    await mouse(bClear.x, bClear.y);
    const before = await stOf();
    eq('键盘段起点：光标就在第一格', before.cursor, p.cells[0].i);
    eq('键盘段起点：重摆之后没有残留步数', before.moves, '0');
    await key('ArrowRight');
    const afterArrow = await stOf();
    eq('方向键走一格（不弹到对侧）', afterArrow.cursor, p.cells[1].i);
    await key('w');
    const afterW = await stOf();
    eq('W 键把光标格摆成气球', one(afterW, afterW.cursor), 'W');
    await key('b');
    const afterB = await stOf();
    eq('B 键把同一格换成铁球', one(afterB, afterB.cursor), 'B');
    eq('两次按键各算一步', afterB.moves, '2');
    await key('z');
    const afterZ = await stOf();
    eq('Z 键撤销回气球', one(afterZ, afterZ.cursor), 'W');
    await key('Backspace');
    const afterDel = await stOf();
    eq('退格收回未定', one(afterDel, afterDel.cursor), '-');
    await key(' ');
    const afterSpace = await stOf();
    eq('空格键循环到气球', one(afterSpace, afterSpace.cursor), 'W');

    // 真指针走到赢：先把键盘那几步清掉（题面仍然不动），再按官方解答把 10 只球摆完
    await mouse(bClear.x, bClear.y);
    const clean = await stOf();
    eq('摆答案之前盘面是干净的（已定格 0）', clean.counts.decided, 0);
    const clicks = [];
    for (const s of p.sol) {
      const want = s.v === 'W' ? 1 : 2;
      for (let k = 0; k < want; k++) { await mouse(s.x, s.y); clicks.push(`${s.name}:${k + 1}`); }
      const st = await stOf();
      eq(`摆 ${s.name} 之后读到 ${s.v}`, one(st, s.i), s.v);
    }
    const won = await stOf();
    eq('摆完官方解答：判据 0 条违反', won.errs, '0');
    eq('摆完官方解答：状态 = won', won.status, 'won');
    eq('胜负幕布揭开了（几何作证，不是 hidden 属性）', won.veil, 'true');
    eq('气球数 = 区数', won.counts.balloons, won.counts.regions);
    eq('铁球数 = 区数', won.counts.balls, won.counts.regions);
    ck('胜局读数里写着 0 条违反', /0 条违反/.test(won.winMeta), won.winMeta);
    ck('胜局读数写着逐格比对结果（与唯一解 0 处不同）', /0 处不同/.test(won.winRecord), won.winRecord);
    ck('计时器停住了：时间读数还在且是 mm:ss', /^\d{2}:\d{2}$/.test(won.time), won.time);
    eq('面板违反读数归零', won.conflicts, '0');

    // 赢了之后再点：幕布盖在棋盘上，点不到格子（由几何作证，不是"我以为 hidden 有效"）；
    // 台面 API 也照样拒 —— 判据不会因为"已经赢了"就松口。
    const veilHit = await json(`(()=>{const v=window.dosun.view;const r=v.cellRect(${p.sol[0].i});
      const rect=v.canvas.getBoundingClientRect();const e=document.elementFromPoint(rect.left+r.x+r.size/2, rect.top+r.y+r.size/2);
      return e?(e.id||e.tagName):'null';})()`);
    ck('赢局里棋盘被幕布挡住（真点击落不到 canvas 上）', veilHit !== 'board', veilHit);
    const refused = await json(`(()=>{const d=window.dosun;d.cycle(${p.sol[0].i});const g=d.game;
      return {status:g.status,v:String(g.st.get(${p.sol[0].i})),line:(document.querySelector('#state-line').textContent||'').trim()};})()`);
    eq('赢局里再点同一格：格子状态没被改动', refused.v, p.sol[0].v);
    eq('赢局里再点：状态仍是 won', refused.status, 'won');
    ck('赢局里再点会被告知为什么', /已经结束/.test(refused.line), refused.line);

    // 换一局：走 UI 那条路（shipOne），seed 必须来自存档游标而不是墙钟
    await evaluate(`window.dosun.begin({tier:'s4'})`);
    await sleep(200);
    const g1 = await json(`(()=>{const g=window.dosun.game;return {seed:g.puzzle.seed,key:g.puzzle.key,read:g.puzzle.read,att:g.puzzle.att,tier:g.puzzle.tier,cur:window.dosun.Store.cursor()};})()`);
    ck('换一局换出了一张生成盘（seed 是小整数，不是时间戳）', Number.isInteger(g1.seed) && g1.seed >= 1 && g1.seed < 1e7, JSON.stringify(g1));
    eq('生成的盘计数器读数 = 1 解', g1.read, '1');
    ck('游标推到了 seed 之后（下一局不会撞同一张）', g1.cur > g1.seed, `${g1.seed} / ${g1.cur}`);
    await evaluate(`window.dosun.begin({tier:'s4'})`);
    await sleep(200);
    const g2 = await json(`(()=>{const g=window.dosun.game;return {seed:g.puzzle.seed,key:g.puzzle.key};})()`);
    ck('再换一局又是另一张盘（指纹变了）', g2.key !== g1.key, `${g1.key} -> ${g2.key}`);
    eq('seed 是游标自增来的', g2.seed, g1.seed + 1);
    const domG = await stOf();
    ck('页面把 seed 印出来了', domG.seed.includes(String(g2.seed)), domG.seed);
    ck('面板上"档位读数"印的是 TIERS_MEASURED 那一行', /实测/.test(domG.measured), domG.measured);

    out({ leg: arg, clicks: clicks.length, cells: p.cells.length, buttons: p.btns.length });
  }
}

main().catch(err => {
  console.error('ERROR ' + (err.message || err));
  if (rows.length) console.error('RESULT ' + JSON.stringify(result({ crashed: true })));
  else console.error('RESULT ' + JSON.stringify({ rows: [{ test: `${cmd} ${arg || ''} 整条腿跑挂了`, pass: false, detail: String(err.message || err) }], fail: 1, crashed: true }));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
