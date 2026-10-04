// Minimal CDP driver for headless playtesting (Node 22+ global WebSocket/fetch).
//
// env: CDP_PORT (devtools port, default 9473), BASE_URL (page origin),
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

// 默认端口 5273/9473 是本仓的车道位（CDP 不用 5273 的镜像位 9373——那条上坐着兄弟车道的长期
// Chrome，attach 过去读到的是别人的页面）。为什么写在这一层：verify.sh 会用 env 覆盖它们，
// 而 `node tools/playtest.cjs …` 单独跑时读的就是这里的默认值，两处不一致时台架会连错浏览器。
const PORT = Number(process.env.CDP_PORT || 9473);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5273/';
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
    const map = { ArrowRight: 'ArrowRight', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ' ': 'Space', Enter: 'Enter', w: 'KeyW', b: 'KeyB', x: 'KeyX', z: 'KeyZ', p: 'KeyP', Backspace: 'Backspace' };
    const vk = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, ' ': 32, Enter: 13, w: 87, b: 66, x: 88, z: 90, p: 80, Backspace: 8 };
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
    // 一条命令名，两条腿：play 走到赢、pause 证明暂停把两样东西一起冻住。
    // 分成两条腿（而不是往 play 尾巴上加一节）是因为 pause 要从**干净的一局**开始测表针，
    // 而 play 腿结束时盘面是赢局、纪录已写过、存档刚被清 —— 那种起点上读不出"这一局的用时"。
    await (arg === 'pause' ? legPause() : leg());
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
    // 这一条腿自己管存档：进来先清，出去再清。engine 腿赢过一次就会在 best 里留下一条用时，
    // 不清的话下面"第一次赢"读的是别人写下的纪录，而不是这一局。
    await evaluate(`window.dosun.Store.reset()`);
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

    // ---------- 纪录只比时间：幕布上那句"本档最快纪录已更新"是有读数的 ----------
    // 这一局是真点出来的，所以存档里的 ms 就是台面上的 elapsedMs；
    // 后面两条灌进去的对照局走台面 API（Store.record 正是按钮那条路调的函数），
    // 判据是"慢的顶不掉、快的能顶掉"，方向必须不对称 —— 否则这条等式对任何实现都能绿。
    const rec0 = await json(`(()=>{const d=window.dosun;return {best:d.Store.best('off'),st:d.state(),
      line:(document.querySelector('#win-record').textContent||'').trim()};})()`);
    ck('赢局把纪录写进了存档（本档 best 带着用时读数）', !!rec0.best && Number.isInteger(rec0.best.ms), JSON.stringify(rec0.best));
    eq('存档里的用时 = 台面上的计时（同一个数，不是各算各的）', rec0.best.ms, rec0.st.elapsedMs);
    eq('存档里的步数 = 这一局的步数', rec0.best.moves, rec0.st.moves);
    ck('第一次赢：幕布上说纪录更新了（没有旧纪录可比）', /最快纪录已更新/.test(rec0.line), rec0.line);

    const recSlow = await json(`(()=>{const d=window.dosun;const prev=d.Store.best('off');
      d.Store.record('off',{ms:prev.ms+60000,moves:1,size:prev.size});
      const now=d.Store.best('off');return {prevMs:prev.ms,prevMoves:prev.moves,ms:now.ms,moves:now.moves};})()`);
    eq('更慢的一局顶不掉纪录（存的还是原来那个用时）', recSlow.ms, recSlow.prevMs);
    eq('更慢的一局也没把步数换进来（整条纪录一起换或一起不换）', recSlow.moves, recSlow.prevMoves);

    const recFast = await json(`(()=>{const d=window.dosun;const prev=d.Store.best('off');
      const faster=Math.max(1,prev.ms-1000);d.Store.record('off',{ms:faster,moves:99,size:prev.size});
      const now=d.Store.best('off');return {prevMs:prev.ms,faster,ms:now.ms,moves:now.moves};})()`);
    ck('探针本身有效：灌进去的那个用时确实比旧纪录快', recFast.faster < recFast.prevMs, `${recFast.faster} < ${recFast.prevMs}`);
    eq('更快的一局顶掉了纪录', recFast.ms, recFast.faster);
    eq('顶掉之后步数跟着换（换的是整条纪录）', recFast.moves, 99);

    // ---------- 坏档：localStorage 里的东西是外部输入，不能假设它是我们写进去的形状 ----------
    const corrupt = await json(`(()=>{const k='dosun-cos:v1',d=window.dosun;const bad=['{','not json','null','[]','{"cursor":"7"}','{"best":"x"}'];
      const tries=[];for(const s of bad){localStorage.setItem(k,s);
        try{tries.push({s,data:JSON.stringify(d.Store.data),cur:d.Store.cursor(),best:String(d.Store.best('off'))});}
        catch(e){tries.push({s,threw:String((e&&e.message)||e)});}}
      return tries;})()`);
    eq('六种坏档都没让台面抛（读档的那三条路各自吞得下）', corrupt.filter(t => t.threw).map(t => t.s).join(','), '');
    eq('坏档一律回读成空档游标 1（不把脏字符串当游标）', corrupt.map(t => t.cur).join(','), corrupt.map(() => 1).join(','));
    eq('坏档里的 best 读不出来就是 null（不返回脏东西）', corrupt.map(t => t.best).join(','), corrupt.map(() => 'null').join(','));
    eq('彻底解析不了的三档回读成 {}（不是 undefined、不是半截对象）',
      corrupt.filter(t => ['{', 'not json', 'null'].includes(t.s)).map(t => t.data).join(','), '{},{},{}');

    // 换一局：走 UI 那条路（shipOne），seed 必须来自存档游标而不是墙钟
    const swept = await json(`(()=>{const d=window.dosun;d.Store.reset();
      return {raw:localStorage.getItem('dosun-cos:v1'),cur:d.Store.cursor(),best:String(d.Store.best('off'))};})()`);
    eq('坏档扫完之后清档：localStorage 里什么都没有', swept.raw, null);
    eq('清档之后游标回到 1（下面的 seed 断言要的是"从空档起"那条路）', swept.cur, 1);
    eq('清档之后纪录不在了（刚灌的那条跟着没了）', swept.best, 'null');
    await evaluate(`window.dosun.begin({tier:'s4'})`);
    await sleep(200);
    const g1 = await json(`(()=>{const g=window.dosun.game;return {seed:g.puzzle.seed,key:g.puzzle.key,read:g.puzzle.read,att:g.puzzle.att,tier:g.puzzle.tier,cur:window.dosun.Store.cursor()};})()`);
    ck('换一局换出了一张生成盘（seed 是小整数，不是时间戳）', Number.isInteger(g1.seed) && g1.seed >= 1 && g1.seed < 1e7, JSON.stringify(g1));
    eq('生成的盘计数器读数 = 1 解', g1.read, '1');
    ck('游标推到了 seed 之后（下一局不会撞同一张）', g1.cur > g1.seed, `${g1.seed} / ${g1.cur}`);
    eq('空档起的第一局就从游标 1 出发（不是"随便一个正整数"）', g1.seed, 1);
    await evaluate(`window.dosun.begin({tier:'s4'})`);
    await sleep(200);
    const g2 = await json(`(()=>{const g=window.dosun.game;return {seed:g.puzzle.seed,key:g.puzzle.key};})()`);
    ck('再换一局又是另一张盘（指纹变了）', g2.key !== g1.key, `${g1.key} -> ${g2.key}`);
    eq('seed 是游标自增来的', g2.seed, g1.seed + 1);
    const domG = await stOf();
    ck('页面把 seed 印出来了', domG.seed.includes(String(g2.seed)), domG.seed);
    ck('面板上"档位读数"印的是 TIERS_MEASURED 那一行', /实测/.test(domG.measured), domG.measured);

    // 存档到底落没落盘：只在同一份文档里读到游标，说明的可能只是内存。
    // 换一次真文档（reload）再读一次，跨过去了才叫 localStorage 的读数。
    await gotoFresh(BASE);
    const d1 = await docInfo();
    ck('reload 换出了新文档（下面那条读数不是同一份内存）', d1.doc !== domG.doc, `${domG.doc} -> ${d1.doc}`);
    const cur2 = await json(`window.dosun.Store.cursor()`);
    eq('reload 之后游标还在（存档真的跨文档）', cur2, g2.seed + 1);

    // 写档的腿自己清档：两种 URL 形态共用同一个浏览器 profile，
    // 上一形态留下的游标会让下一形态的"从空档起"变成别人的读数。
    await evaluate(`window.dosun.Store.reset()`);
    eq('腿尾存档是干净的（下一形态从空档开始）', await json(`localStorage.getItem('dosun-cos:v1')`), null);

    out({ leg: arg, clicks: clicks.length, cells: p.cells.length, buttons: p.btns.length });
  }

  // ---------- 暂停腿：表针和盘面要一起冻住 ----------
  //
  // 这条腿存在的理由只有一个数：`Store.record` 排纪录只看 `r.ms < prev.ms`（js/main.js:45）。
  // 只停表、不停盘的暂停，等于给思考时间免单 —— 想多久都行，按「继续」再一路摆到赢，
  // 用时照样顶掉旧纪录。所以这里量的不是"paused 这个布尔量翻了没"，而是三件实事：
  //   ① 表针冻住（elapsedMs 恒等、HUD 那句话也不再跳）；
  //   ② 盘面冻住（真指针 + 真按键 + 台面 API 三条路都原样退回，且挡回去的刀数数得清）；
  //   ③ 解冻之后一切都还能用（对照组：同样的那一格，这一下真的落地）——
  //      少了对照组，"整条腿什么都没发生"和"暂停真的挡住了"读起来一模一样。
  async function legPause() {
    const ROSTER = ['btn-pause', 'btn-fullscreen', 'btn-sound', 'btn-w', 'btn-b', 'btn-e', 'btn-u',
      'btn-undo', 'btn-new', 'btn-clear', 'btn-menu'];
    const GEO = ids => `(()=>{
      const d=window.dosun,g=d.game,h=d.view;
      const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName):'null';};
      const o={controls:[]};
      for(const id of ${JSON.stringify(ids)}){const e=document.getElementById(id);
        if(!e){o.controls.push({id,missing:true});continue;}
        const b=e.getBoundingClientRect();const x=b.left+b.width/2,y=b.top+b.height/2;
        const t=document.elementFromPoint(x,y);
        o.controls.push({id,x,y,w:Math.round(b.width),h:Math.round(b.height),shown:b.width>0&&b.height>0,
          hit:at(x,y),hitOn:!!t&&(t===e||e.contains(t)),
          text:(e.textContent||'').trim(),disabled:!!e.disabled,title:e.title||''});}
      const cv=h.canvas.getBoundingClientRect();
      o.cells=[];for(const i of g.B.cells){if(g.B.black.has(i))continue;const r=h.cellRect(i);
        const x=cv.left+r.x+r.size/2,y=cv.top+r.y+r.size/2;o.cells.push({i,name:g.B.name(i),x,y,hit:at(x,y)});}
      const v=document.getElementById('win-veil');
      o.veil=!!v&&getComputedStyle(v).display!=='none'&&v.getClientRects().length>0;
      o.live=document.getElementById('state-line').getAttribute('aria-live');
      return o;})()`;
    const SNAP = `(()=>{const d=window.dosun,g=d.game;
      const t=s=>{const n=document.querySelector(s);return n?(n.textContent||'').trim():'';};
      const e=document.getElementById('win-veil');
      return {st:[...g.st].map(([i,v])=>i+':'+(v||'-')).join(','),moves:g.moves,cursor:g.cursor,status:g.status,
        decided:g.counts().decided,errs:g.errs().length,ms:d.state().elapsedMs,time:t('#stat-time'),
        paused:d.isPaused(),blocked:d.keyHits().blocked,line:t('#state-line'),
        btn:t('#btn-pause'),aria:document.getElementById('btn-pause').getAttribute('aria-pressed'),
        title:document.getElementById('btn-pause').title,seed:String(g.puzzle.seed),tier:g.puzzle.tier,
        veil:!!e&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0};})()`;
    const snap = () => json(SNAP);
    // 每一刀之前现量命中盒（视图一换坐标就变了，量一次用到底 = 拿旧坐标点新页面）。
    // 命中点落在控件本身或它的**后代**都算到得了（选档那一行是 `<button><span>…</span></button>`，
    // 中心自然量到那只 span）；落在别的东西上（幕布、叠层）才算点不到。
    const clickId = async id => {
      const c = (await json(GEO([id]))).controls[0];
      ck(`${id}：点之前命中盒到得了这只控件`, !c.missing && c.shown && c.hitOn,
        `missing=${c.missing} shown=${c.shown} hit=${c.hit}`);
      await mouse(c.x, c.y);
      return c;
    };

    await gotoFresh(BASE);
    await evaluate(`window.dosun.Store.reset()`);
    await evaluate(`(()=>{ if(!window.dosun.game) window.dosun.begin({tier:'off'}); return 1; })()`);
    // headless 会把页面报成 hidden，而这条腿要看的是 setInterval 驱动的 HUD 那句话还跳不跳 ——
    // 不钉回 visible，"文字没变"就可能是 Chrome 自己把表掐了，不是本仓的暂停掐的。
    await evaluate(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
      Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'ok'`);
    await sleep(200);
    const d0 = await docInfo();
    const g0 = await json(GEO(ROSTER));
    const cells0 = (await json(GEO(['btn-pause']))).cells;
    evidence({ leg: arg, url: d0.url, timeOrigin: d0.to, doc: d0.doc, seed: (await snap()).seed, controls: g0.controls.length, cells: cells0.length });
    if (SELFTEST) ck(`SELFTEST·${arg} 种下的错期望（判据必须抓到）`, false, 'planted: 1==2');

    // ---------- 名册：暂停这只按钮真的在 DOM 里、点得到、写着它是干什么的 ----------
    eq(`名册：${ROSTER.length} 只控件一个都不缺`, g0.controls.filter(c => c.missing).map(c => c.id).join(','), '');
    eq('名册：每只控件的中心都落在自己身上（先量 hit box 再谈点得到）',
      g0.controls.filter(c => c.hit !== c.id).map(c => `${c.id}->${c.hit}`).join(','), '');
    ck('名册：每只都有可见尺寸（>=28px 高，藏在幕布后面的不算点得到）',
      g0.controls.every(c => c.h >= 28), JSON.stringify(g0.controls.map(c => [c.id, c.w, c.h])));
    ck('名册：没有一只按钮写着空文案（读屏要有话说）',
      g0.controls.every(c => c.text.length > 0), JSON.stringify(g0.controls.filter(c => !c.text).map(c => c.id)));
    eq('名册：这一份名册就是 HUD 上的那一排（页面里没有第二只暂停按钮）',
      await json(`[...document.querySelectorAll('button')].filter(b=>/暂停|继续/.test(b.textContent)).map(b=>b.id).join(',')`), 'btn-pause');
    const s0 = await snap();
    eq('开局：按钮写着「暂停」、aria-pressed=false、title 点名 (P)', `${s0.btn}|${s0.aria}|${s0.title}`, '暂停|false|暂停 (P)');
    eq('开局：isPaused() 与按钮写的是同一件事（没有各说各话）', s0.paused, 'false');
    eq('开局的盘就是官方例题那一张（seed 0 / tier off）', `${s0.tier}|${s0.seed}`, 'off|0');

    // ---------- 先证"表在走"：没有这条正对照，下面所有的"没变"都能空转 ----------
    const t0 = await snap();
    await sleep(320);
    const t1 = await snap();
    ck('没暂停时表在走：两次读数之间 elapsedMs 涨了 >=150ms', t1.ms - t0.ms >= 150, `差 ${t1.ms - t0.ms}ms`);
    const timeWas = t1.time;
    await sleep(2200);
    const t2 = await snap();
    ck('HUD 那句话由 ticker 驱动：没暂停时 2.2 秒里 mm:ss 一定变', t2.time !== timeWas, `两读都是 ${t2.time}`);
    ck('同一段时间 elapsedMs 也真的涨了（文字与计时同源）', t2.ms - t1.ms >= 2000, `差 ${t2.ms - t1.ms}ms`);

    // 先落一子，让撤销/重摆这两条路在暂停里"有的可做却做不成"——否则挡的是空操作。
    const cA = cells0[0];
    await mouse(cA.x, cA.y);
    const seeded = await snap();
    eq(`真点击先落一刀（对照组前置：${cA.name} 已是气球）`, one(seeded, cA.i), 'W');
    eq('这一子算一步', seeded.moves, '1');
    await sleep(120);
    const was = await snap();

    // ---------- ① 停表：真指针按暂停 ----------
    await clickId('btn-pause');
    const p1 = await snap();
    eq('按下暂停：isPaused() 翻真', p1.paused, 'true');
    eq('按下暂停：按钮改口「继续」、aria-pressed=true、title 跟着改', `${p1.btn}|${p1.aria}|${p1.title}`, '继续|true|继续 (P)');
    ck('按下暂停：盘面状态一个字没动（暂停本身不许改盘）', p1.st === was.st && p1.moves === was.moves, `${p1.st} / ${was.st}`);
    const f0 = await snap();
    await sleep(320);
    const f1 = await snap();
    eq('停表：暂停期间 elapsedMs 恒等（墙钟再走也不入账）', f1.ms - f0.ms, 0);
    await sleep(2200);
    const f2 = await snap();
    eq('停表：HUD 那句话也不跳（停的不只是账面数，ticker 也停了）', f2.time, f1.time);
    eq('停表：那 2.2 秒仍然一秒都没入账', f2.ms - f1.ms, 0);

    // ---------- ② 冻盘：真指针、真按键、台面 API 三条路一起试 ----------
    // pin 取在暂停已经落下去之后：下面这些"什么都没变"的窗口必须整条落在 paused 里，
    // 拿点暂停之前的 was 当起点，就会把那一下点击的 CDP 往返（实测 3ms）算成暂停漏掉的账。
    const pin = await snap();
    const wall0 = Date.now();
    const n = { pointer: 0, keys: 0, api: 0 };
    const cellB = cells0.find(c => c.i !== cA.i);
    await mouse(cellB.x, cellB.y); n.pointer++;          // 棋盘上另一格：cycle → place
    await clickId('btn-w'); n.pointer++;                 // 数字面板：摆光标格
    await clickId('btn-e'); n.pointer++;
    await clickId('btn-undo'); n.pointer++;              // 撤销（history 里真有一步可退）
    await clickId('btn-clear'); n.pointer++;             // 重摆（它以前还顺手把表拨回 0）
    // 这就是本腿要防的那种用法：按下暂停，想多久想多久，再按「继续」一路摆到赢。
    // 这 1.2 秒是墙钟里真的睡着的，不是断言之间的往返 —— 冻住的必须是数，界面藏起来不算。
    await sleep(1200);
    for (const k of ['ArrowRight', 'ArrowDown', ' ', 'Enter', 'w', 'b', 'x', 'z', 'Backspace']) { await key(k); n.keys++; }
    const api = await json(`(()=>{const d=window.dosun,e=d.engine,g=d.game;
      const other=${cellB.i},sel=${cells0.find(c => c.i !== cellB.i).i};
      d.place(other,e.W); d.cycle(other); d.undo(); d.select(sel);
      return {h:d.hint(),st:[...g.st].map(([i,v])=>i+':'+(v||'-')).join(',')};})()`);
    n.api = 5;
    const after = await snap();
    const cuts = n.pointer + n.keys + n.api;

    eq('冻盘：一整条电池跑完，盘面逐格指纹一个字没变', after.st, pin.st);
    eq('冻盘：步数没动', after.moves, pin.moves);
    eq('冻盘：已定格读数没动（重摆那一下也没把球清掉）', after.decided, seeded.decided);
    eq('冻盘：光标没被方向键挪走', after.cursor, pin.cursor);
    eq('冻盘：违反条数没动（挡不住盘，就谈不上冻住）', after.errs, pin.errs);
    eq('冻盘：题面还是那一张（tier 与 seed 都没被换）', `${after.tier}|${after.seed}`, `${pin.tier}|${pin.seed}`);
    eq('冻盘：暂停期间表针恒等 —— 一整条电池的墙钟都不入账', after.ms - pin.ms, 0);
    const wall = Date.now() - wall0;
    ck(`这条"什么都没发生"真的烧掉了墙钟（>=2 秒）：冻住的是数，不是把界面藏起来`, wall >= 2000, `wall=${wall}ms`);
    eq(`挡回去的刀数 == 台账数（${n.pointer} 真点击 + ${n.keys} 真按键 + ${n.api} 台面 API）`, after.blocked - pin.blocked, cuts);
    ck('台面那条 hint 在暂停里返回 null（不是半截读数、不是照念）', api.h === null, JSON.stringify(api.h));
    ck('每一刀都被告知为什么：状态行写着「已暂停」与"没有落地"', /已暂停/.test(after.line) && /没有落地/.test(after.line), after.line);
    const gPaused = await json(GEO(ROSTER));
    eq('那句话走的是 aria-live=polite 的通道（读屏念得到，不是只画在 canvas 上）', gPaused.live, 'polite');
    eq('挡的方式不是把控件弄灰：名册里一只都还可点', gPaused.controls.filter(c => c.disabled).map(c => c.id).join(','), '');

    // ---------- ③ 解冻：同一刀这回落得下去，否则"挡"和"坏"读起来一样 ----------
    await clickId('btn-pause');
    const u1 = await snap();
    eq('按「继续」解冻：isPaused() 回 false', u1.paused, 'false');
    eq('按「继续」：按钮改回「暂停」、aria-pressed=false、title 也回 (P)', `${u1.btn}|${u1.aria}|${u1.title}`, '暂停|false|暂停 (P)');
    const jump = u1.ms - pin.ms;
    ck(`恢复不补账：暂停期间憋下的墙钟没有一次性灌进来（涨 ${jump}ms）`, jump >= 0 && jump < 500, `jump=${jump}ms / 暂停里睡了 ~${wall}ms 墙钟`);
    const u2 = await snap();
    await sleep(320);
    const u3 = await snap();
    ck('恢复后表重新走：elapsedMs 又开始涨', u3.ms - u2.ms >= 150, `差 ${u3.ms - u2.ms}ms`);
    await mouse(cellB.x, cellB.y);
    const u4 = await snap();
    eq(`对照组：解冻之后同一格真的落地（${cellB.name} → 气球）`, one(u4, cellB.i), 'W');
    eq('对照组：这一步算一步', u4.moves, u3.moves + 1);
    eq('对照组：落地的那一刀不再被记账（blocked 不涨）', u4.blocked - u3.blocked, 0);
    await clickId('btn-undo');
    const u5 = await snap();
    eq('解冻后撤销真的退了一步', u5.moves, u4.moves - 1);

    // ---------- P 是暂停在这条腿上的另一只手 ----------
    await key('p');
    const k1 = await snap();
    eq('真按 P 进暂停（isPaused 与按钮同一句话）', `${k1.paused}|${k1.btn}`, 'true|继续');
    const k2 = await snap();
    await key('w');
    const k3 = await snap();
    eq('暂停里 W 键没落地（键整条被 keydown 那道闸挡）', k3.st, k2.st);
    eq('那一下被记成一刀，而不是"按键丢了"', k3.blocked - k2.blocked, 1);
    await key('p');
    const k4 = await snap();
    eq('再按 P 解冻：P 自己永远是放行那只', `${k4.paused}|${k4.btn}`, 'false|暂停');

    // ---------- 重摆不换题，所以也不许换表（这一条与暂停无关，是纪录的第二条免费腿） ----------
    const off = await json(`(()=>{const o=window.dosun.engine.official();const a=[];for(const [i,v] of o.sol)a.push([i,v]);return a;})()`);
    for (const [i, v] of off) await json(`window.dosun.place(${i},'${v}')`);
    const won = await snap();
    eq('台面把官方解答摆完：状态 won、判据 0 条违反', `${won.status}|${won.errs}`, 'won|0');
    ck('赢局幕布揭开了（由几何作证，不是 hidden 属性）', won.veil === true, `veil=${won.veil}`);
    const w0 = await snap();
    await clickId('btn-clear');
    const w1 = await snap();
    eq('赢局之后重摆：回到可玩、球清干净、幕布揭开', `${w1.status}|${w1.decided}|${w1.veil}`, 'play|0|false');
    ck('重摆不送免费时间：用时不减一秒（>= 赢的那一刻）', w1.ms >= w0.ms, `${w0.ms} -> ${w1.ms}`);
    ck('重摆那句话现在不撒谎：写着计时继续走', /重摆/.test(w1.line) && /计时继续/.test(w1.line), w1.line);
    const w2 = await snap();
    await sleep(320);
    const w3 = await snap();
    ck('onWin 停掉的那只 ticker 被重摆重新接上（表针又开始涨）', w3.ms - w2.ms >= 150, `差 ${w3.ms - w2.ms}ms`);
    const wt0 = w3.time;
    await sleep(2200);
    const wt1 = await snap();
    ck('HUD 那句话也跟着恢复（跑的是同一只 ticker）', wt1.time !== wt0, `两读都是 ${wt1.time}`);

    // ---------- 从暂停里点进官方例题：这一条以前会得到一块走不动的盘 ----------
    await clickId('btn-pause');
    const preMenu = await snap();
    eq('带着暂停离开这一局：先确认现在确实是暂停的', preMenu.paused, 'true');
    await clickId('btn-menu');
    const geoMenu = await json(GEO(['btn-pause', 'btn-fullscreen', 'btn-sound', 'btn-w', 'btn-new', 'btn-clear']));
    eq('回选档：顶部 HUD 那三只一直在（暂停不是只在牌桌上才有入口）',
      geoMenu.controls.slice(0, 3).filter(c => c.missing || !c.shown).map(c => c.id).join(','), '');
    eq('回选档：牌桌上的玩法控件确实收起了（选档页没有叠在棋盘上面）',
      geoMenu.controls.slice(3).filter(c => c.shown).map(c => c.id).join(','), '');
    await clickId('tier-off');
    const o2 = await snap();
    eq('点进官方例题：上一局的暂停没跟过来（这把死锁就是本腿要修的）', o2.paused, 'false');
    eq('点进官方例题：按钮写着「暂停」、aria-pressed=false、title 回到 (P)', `${o2.btn}|${o2.aria}|${o2.title}`, '暂停|false|暂停 (P)');
    ck('点进官方例题：上一局赢过的幕布没盖在这张盘上', o2.veil === false, `veil=${o2.veil}`);
    ck('点进官方例题：这是一块新表（没带上上一局那十几秒）', o2.ms < 1500, `ms=${o2.ms}`);
    const o3 = await snap();
    await sleep(320);
    const o4 = await snap();
    ck('点进官方例题：表在走', o4.ms - o3.ms >= 150, `差 ${o4.ms - o3.ms}ms`);
    const cells3 = (await json(GEO(['btn-pause']))).cells;
    await mouse(cells3[0].x, cells3[0].y);
    const o5 = await snap();
    eq('点进官方例题：真点击真的落地（这盘解得开，不是锁着的）', one(o5, cells3[0].i), 'W');
    eq('点进官方例题：落地的这一刀没被记账', o5.blocked - o4.blocked, 0);

    await evaluate(`window.dosun.Store.reset()`);
    eq('腿尾存档是干净的（这一腿赢过一次、写过一条纪录，不许留给下一形态）',
      await json(`localStorage.getItem('dosun-cos:v1')`), null);
    evidence({ frozenMs: f2.ms - f1.ms, batteryMs: after.ms - pin.ms, wall, jump, blocked: after.blocked - pin.blocked, cuts });
    out({ leg: arg, cuts, controls: ROSTER.length, cells: cells0.length });
  }
}


main().catch(err => {
  console.error('ERROR ' + (err.message || err));
  if (rows.length) console.error('RESULT ' + JSON.stringify(result({ crashed: true })));
  else console.error('RESULT ' + JSON.stringify({ rows: [{ test: `${cmd} ${arg || ''} 整条腿跑挂了`, pass: false, detail: String(err.message || err) }], fail: 1, crashed: true }));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
