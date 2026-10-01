// 接线：DOM、指针/键盘、计时器、存档游标，以及给真浏览器闸用的 window.dosun 台面。
// 这里**一条判据都不写** —— 盘面怎么算赢、每一档能不能出货，全部来自 js/engine/（经 js/ui/game.js）。
//
// seed 只来自存档里的自增游标，绝不取 Date.now()：页面上印着 "seed 7"，
// 就必须能用同一个 7 + 同一档重新出同一张盘（gen 腿在 node 与 Chrome 两边各出一份指纹对得上）。

import { BoardView } from './render/board.js';
import { Sim, SIM_STEP } from './render/anim.js';
import { Sfx } from './audio.js';
import { makeStore, decodeStore, STORE_KEY } from './save.js';
import { Game, TIERS, TIERS_MEASURED, DEFAULT_TIER, tierOf, tierFor, officialPuzzle, build, official, mkBoard, W, B, E, count, pencil, initCand, sameSol, shipOne, boardKey, fnv1a, DIG } from './ui/game.js';

const VERSION = '0.2.0';
// 每个文档一个身份：片段跳转不换文档，所以它在那种导航后必须还在、真重载后必须换。
const DOC = 'doc' + Math.random().toString(36).slice(2, 10);

const $ = s => document.querySelector(s);
const el = {
  viewMenu: $('#view-menu'), viewGame: $('#view-game'), tiers: $('#tier-list'),
  name: $('#stat-name'), tier: $('#stat-tier'), seed: $('#stat-seed'), time: $('#stat-time'),
  moves: $('#stat-moves'), balloons: $('#stat-balloons'), balls: $('#stat-balls'),
  filled: $('#stat-filled'), regions: $('#stat-regions'), conflicts: $('#stat-conflicts'),
  genms: $('#stat-genms'), measured: $('#stat-measured'),
  stateLine: $('#state-line'), winVeil: $('#win-veil'), winMeta: $('#win-meta'), winRecord: $('#win-record'),
  canvas: $('#board'), sound: $('#btn-sound'), full: $('#btn-full'), help: $('#btn-help'),
  helpVeil: $('#help-veil'), helpClose: $('#btn-help-close'), helpFacts: $('#help-facts'),
  pause: $('#btn-pause'), pauseVeil: $('#pause-veil'), pauseResume: $('#btn-resume-play'),
  resume: $('#btn-resume'), hint: $('#btn-hint'),
};

// 档位行上印的那句话：一个字段都不自己算，全部取 TIERS_MEASURED（tools/generator-probe.mjs 的读数）。
export function measuredLine(id) {
  const m = TIERS_MEASURED[id];
  if (!m) return '';
  return `实测 出货 第${m.shipAttempt}次 · ${m.shipMs}ms · 唯一盘 ${m.uniq}/${m.sample} · 推满 ${m.uniqSolved}/${m.uniq} · 节点 med/p95 ${m.nodesMedP95[0]}/${m.nodesMedP95[1]}`;
}

// 存档：解码走 js/save.js 的两段式（语法一段、记录一段），坏一条只丢那一条。
// storage 用注入式（node 里能拿垃圾档实测），这里给的就是 localStorage 本身。
const storage = typeof localStorage === 'undefined' ? null : {
  getItem: k => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: k => localStorage.removeItem(k),
};
const Store = makeStore(storage);
/** 上一次解码丢掉了什么：挂在台面上，闸与人都能读到（"存档活着"的证据不是"没报错"）。 */
let lastDropped = [];
try { lastDropped = decodeStore(storage && storage.getItem(STORE_KEY)).dropped; } catch { lastDropped = ['root:throw']; }

const view = new BoardView(el.canvas);
const sim = new Sim();
const sfx = new Sfx();
let game = null;
let currentView = 'menu';
let startedAt = 0;
let baseElapsed = 0;
let ticker = 0;
let notice = '';
const say = s => { notice = s || ''; };
const keys = { seen: 0, handled: 0, repeated: 0, last: '', by: {} };

const clock = () => baseElapsed + (startedAt ? Date.now() - startedAt : 0);
const fmtMs = ms => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function availBox() {
  const narrow = window.innerWidth <= 860;
  const w = narrow ? window.innerWidth - 44 : Math.max(280, (document.getElementById('view-game').clientWidth || 640) - 320);
  return { w, h: Math.max(260, window.innerHeight - 250) };
}

function draw() {
  if (!game) return;
  const { w, h } = availBox();
  view.resize(game, w, h);
  view.draw(game, sim);
  sim.dirty = false;
}

// ---------------------------------------------------------------- 帧率无关的回路
// 帧回调只把墙钟差喂给累加器，仿真一律按 SIM_STEP 定步走（js/render/anim.js）。
// 首帧的 elapsed 记 0：用 `lastTs === 0` 当哨兵会白吃掉第一帧，凭空造出一个 25ms 的假依赖。
let lastTs = null;
let raf = 0;
function loop(ts) {
  raf = requestAnimationFrame(loop);
  const now = ts / 1000;
  const elapsed = lastTs === null ? 0 : now - lastTs;
  lastTs = now;
  sim.frame(elapsed);
  if (currentView !== 'game' || !game) return;
  // reduceMotion 且没有待画的碎屑 ⇒ 画面是静图，不必每帧重画
  if (sim.reduced && !sim.dirty) return;
  draw();
}
function startLoop() { if (!raf) raf = requestAnimationFrame(loop); }

// reduceMotion 两条腿：CSS 走媒体查询，canvas 回路走这一个开关（同一个 matchMedia）。
const rmq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function applyReducedMotion(v) {
  sim.setReduced(v);
  if (typeof document !== 'undefined') document.documentElement.dataset.reducedMotion = v ? 'reduce' : 'no-preference';
  draw();
}
if (rmq) {
  applyReducedMotion(rmq.matches);
  const onChange = e => applyReducedMotion(e.matches);
  if (rmq.addEventListener) rmq.addEventListener('change', onChange);
  else if (rmq.addListener) rmq.addListener(onChange);
}

// ---------------------------------------------------------------- 暂停 / 全屏 / 教学 / 静音
/** 暂停 = 累加器不再吃帧时间 + 计时器停表；恢复后盘面状态一格不丢（只是不再推进）。 */
function setPaused(v) {
  if (!game) v = false;
  const want = !!v && game.status !== 'won';
  sim.setPaused(want);
  el.pause.setAttribute('aria-pressed', String(want));
  el.pause.textContent = want ? '继续' : '暂停';
  el.pauseVeil.hidden = !want;
  if (want) stopClock();
  else if (!startedAt) startClock();
  syncStats();
  return want;
}

function fullscreenActive() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function syncFullscreen() {
  const on = fullscreenActive();
  el.full.setAttribute('aria-pressed', String(on));
  el.full.textContent = on ? '退出全屏' : '全屏';
  return on;
}
/** 全屏绑的是页面上真实存在的 #btn-full（不是引用一个不存在的 id）。 */
function toggleFullscreen() {
  const host = document.getElementById('app') || document.documentElement;
  const active = fullscreenActive();
  const req = host.requestFullscreen || host.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!req || (!active && !exit)) { say('这台设备不给网页全屏：按钮还在，只是系统不接。'); syncAll(); return false; }
  const p = active ? (exit ? exit.call(document) : null) : req.call(host, { navigationUI: 'hide' });
  if (p && p.catch) p.catch(err => { say('全屏被系统拒绝：' + (err && err.message ? err.message : err)); syncAll(); });
  return !active;
}
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);

function showHelp(v) {
  const want = !!v;
  el.helpVeil.hidden = !want;
  el.help.setAttribute('aria-pressed', String(want));
  if (want) el.helpFacts.textContent = helpFacts();
  return want;
}
/** 教学页上那句"你正在玩的这一档实测读数"：取 TIERS_MEASURED 原值，不在页面里另算。 */
function helpFacts() {
  const tier = game ? game.puzzle.tier : DEFAULT_TIER;
  const line = measuredLine(tier);
  return `${tier} · ${line || '官方例题 4×4（黄金夹具）'}`;
}
/** 真静音：ctx.suspend() + 静音期间一个振荡器都不建（读 sfx.state() 可验）。 */
function setMuted(m) {
  const st = sfx.setMuted(m);
  el.sound.setAttribute('aria-pressed', String(!m));
  el.sound.textContent = m ? '音效 关' : '音效 开';
  if (!m) sfx.play('mark');
  return st;
}
const isMuted = () => sfx.muted;

// ---------------------------------------------------------------- 存档（进行中的这一局）
let saveTimer = 0;
function snapshot() {
  if (!game) return null;
  const cells = [];
  for (const [i, v] of game.st) if (v !== null) cells.push([i, v]);
  return { tier: game.puzzle.tier, seed: game.puzzle.seed, R: game.R, C: game.C, elapsedMs: clock(), moves: game.moves, cells };
}
function saveNow() { if (game && game.status !== 'won') Store.setGame(snapshot()); }
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
function savedRecord() {
  const rec = Store.game();
  if (!rec) return null;
  if (rec.tier !== 'off' && !tierOf(rec.tier)) return null;
  return rec;
}
function syncResumeButton() {
  const rec = savedRecord();
  el.resume.hidden = !rec;
  if (rec) el.resume.textContent = `继续上一局 · ${rec.tier} seed ${rec.seed} · ${rec.cells.length} 格已摆`;
  return !!rec;
}
/** 续档：同一颗 seed 重新出同一张盘（gen 腿证过的那条），再把摆好的格子贴回去。 */
function resumeSaved() {
  const rec = savedRecord();
  if (!rec) { say('没有可继续的局。'); return null; }
  const puzzle = rec.tier === 'off' ? officialPuzzle() : build(tierFor(rec.tier), rec.seed);
  if (!puzzle || puzzle.R !== rec.R || puzzle.C !== rec.C) {
    say(`存档里那一局（${rec.tier} seed ${rec.seed}）现在出不来了：换一档重新开。`);
    Store.clearGame();
    syncResumeButton();
    return null;
  }
  game = new Game(puzzle);
  for (const [i, v] of rec.cells) if (game.st.has(i)) game.st.set(i, v);
  game.moves = rec.moves;
  sim.reset();
  baseElapsed = rec.elapsedMs;
  startedAt = 0;
  el.winVeil.hidden = true;
  show('game');
  startClock();
  say('从存档续上：题面与已摆的格子都按 seed 复原了。');
  syncAll();
  setPaused(false);
  return game;
}

// ---------------------------------------------------------------- 读数面板
// 读数只有一处写手：一格的状态变了，所有面板数字一起跟着重算，不会出现半张表停在旧值。
function syncStats() {
  if (!game) return;
  const c = game.counts();
  const errs = game.errs();
  const spec = tierFor(game.puzzle.tier);
  el.name.textContent = `${game.puzzle.name} · ${game.R}×${game.C} · ${c.regions} 个区`;
  el.tier.textContent = game.puzzle.tier === 'off' ? '官方例题' : `${spec.name} 区${spec.NR}`;
  el.tier.dataset.tier = game.puzzle.tier;
  el.seed.textContent = `seed ${game.puzzle.seed}`;
  el.seed.dataset.seed = String(game.puzzle.seed);
  el.time.textContent = fmtMs(clock());
  el.moves.textContent = String(game.moves);
  el.balloons.textContent = `${c.balloons}/${c.regions}`;
  el.balls.textContent = `${c.balls}/${c.regions}`;
  el.filled.textContent = `${c.decided}/${c.total}`;
  el.regions.textContent = String(c.regions);
  el.conflicts.textContent = String(errs.length);
  el.genms.textContent = game.puzzle.official ? '官方夹具' : `${game.puzzle.att} 次尝试 / ${game.puzzle.genMs}ms · 计数器 ${game.puzzle.read} 解（${game.puzzle.nodes} 节点）· 铅笔 ${game.puzzle.pencilRead}`;
  el.measured.textContent = game.puzzle.official ? '官方 4×4（黄金夹具）' : measuredLine(game.puzzle.tier);
  for (const [sel, bad] of [['#stat-conflicts', errs.length > 0], ['#stat-balloons', game.status !== 'won' && c.balloons !== c.regions], ['#stat-balls', game.status !== 'won' && c.balls !== c.regions]]) {
    $(sel).closest('.stat').classList.toggle('bad', bad);
  }
  for (const b of document.querySelectorAll('.digits .place')) {
    const v = b.id === 'btn-w' ? W : b.id === 'btn-b' ? B : b.id === 'btn-e' ? E : null;
    b.setAttribute('aria-pressed', String(game.cursor >= 0 && game.st.get(game.cursor) === v));
  }
  el.stateLine.textContent = notice ? notice
    : errs.length ? `${errs.length} 条违反：${errs[0]}`
    : game.status === 'won' ? ''
    : '';
}

function syncAll() { syncStats(); draw(); }

function startClock() {
  startedAt = Date.now();
  clearInterval(ticker);
  ticker = setInterval(() => { el.time.textContent = fmtMs(clock()); }, 1000);
}
function stopClock() { baseElapsed = clock(); startedAt = 0; clearInterval(ticker); ticker = 0; }

function onWin() {
  stopClock();
  setPaused(false);
  sfx.play('win');
  const ms = clock();
  const f = game.winFacts();
  const better = Store.record(game.puzzle.tier, { ms, moves: game.moves, size: `${game.R}×${game.C}` });
  // 赢了就不留"进行中的局"：下一次打开应该从菜单开始，而不是续上一个已经打完的盘。
  Store.clearGame();
  el.winMeta.textContent = `${game.puzzle.name} · ${game.R}×${game.C} · seed ${game.puzzle.seed} · ${fmtMs(ms)} · ${game.moves} 步 · 判据 ${f.errs} 条违反`;
  el.winRecord.textContent =
    `判据 check() 给了 ${f.errs} 条违反 · 气球 ${f.balloons}/${f.regions} · 铁球 ${f.balls}/${f.regions} · ` +
    `计数器读数 ${f.read} 解 · 与唯一解逐格比对 ${f.mismatch} 处不同 · ` +
    (better ? '本档最快纪录已更新。' : `本档纪录 ${fmtMs(Store.best(game.puzzle.tier).ms)}。`);
  el.winVeil.hidden = false;
  syncStats();
}

function afterStep() {
  syncAll();
  queueSave();
  if (game.status === 'won') onWin();
}

/** 摆一格：v 为 W/B/E/null。黑格会被 Game.set 挡回来，挡回来的那句话写进状态行。 */
function place(i, v) {
  if (!game) return null;
  if (sim.paused) { say('暂停中：按 P 或点「继续」再摆。'); syncAll(); return null; }
  const r = game.set(i, v);
  if (r.refused) { sfx.play('refuse'); say(r.refused); syncAll(); return null; }
  if (r.noop) return null;
  sfx.play(v === W ? 'balloon' : v === B ? 'ball' : v === E ? 'mark' : 'und');
  if (v !== null) sim.burst(i, v === B ? 'ball' : 'balloon', v === B ? 12 : 9);
  say('');
  afterStep();
  return r.step;
}

/** 点一格 = 循环一格状态（未定→气球→铁球→钉空→未定）。 */
function cycle(i) {
  if (!game) return null;
  const cur = game.st.get(i);
  if (game.status === 'won') {
    say('这一局已经结束了：按「换一局」或「重摆」再玩。');
    syncAll();
    return null;
  }
  if (game.B.black.has(i) || !game.st.has(i)) {
    if (game.B.black.has(i)) { sfx.play('refuse'); say(`${game.B.name(i)} 是题面黑格：不属于任何区，也摆不了球。`); syncAll(); }
    return null;
  }
  const states = [null, W, B, E];
  const next = states[(states.indexOf(cur) + 1) % states.length];
  return place(i, next);
}

function select(i) {
  if (!game || i < 0) return false;
  const ok = game.select(i);
  say(ok ? '' : `${game.B.name(i)} 是题面黑格：选不中。`);
  syncAll();
  return ok;
}

function undo() {
  if (!game) return null;
  if (sim.paused) { say('暂停中：先继续再撤销。'); syncAll(); return null; }
  const s = game.undo();
  if (!s) { say('没有可退的一步。'); syncAll(); return null; }
  sfx.play('und');
  say('');
  syncAll();
  queueSave();
  return s;
}

function hint() {
  if (!game) return null;
  const h = game.hint();
  sfx.play('mark');
  say(`提示 · ${h.rule || (h.conflict ? '矛盾' : h.stalled ? '推不动' : '铅笔')}：${h.text}`);
  syncAll();
  return h;
}

function begin({ tier = DEFAULT_TIER, seed = null } = {}) {
  if (tier === 'off') {
    game = new Game(officialPuzzle());
    sim.reset();
    show('game');
    startClock();
    say('');
    syncAll();
    setPaused(false);
    saveNow();
    return game;
  }
  const spec = tierFor(tier);
  let probe = Number.isInteger(seed) && seed >= 1 ? seed : Store.cursor();
  let puzzle = null;
  for (let k = 0; k < 5 && !puzzle; k++) {
    puzzle = build(spec, probe + k);
  }
  if (!puzzle) {
    show('game');
    el.stateLine.textContent = `这一档连着 5 号 seed 都没出货（${spec.name} ${spec.R}×${spec.C} 区${spec.NR}）—— 换一档试试。`;
    return null;
  }
  Store.setCursor(puzzle.seed + 1);
  game = new Game(puzzle);
  sim.reset();
  baseElapsed = 0;
  el.winVeil.hidden = true;
  show('game');
  startClock();
  say('');
  syncAll();
  writeHash();
  setPaused(false);
  saveNow();
  return game;
}

function writeHash() {
  if (!game) return;
  const h = `#t=${game.puzzle.tier}&s=${game.puzzle.seed}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function parseHash() {
  const m = /^#t=([a-z0-9]+)&s=(\d+)$/.exec(location.hash || '');
  if (!m) return null;
  return { tier: m[1], seed: Number(m[2]) };
}

function show(which) {
  currentView = which;
  el.viewMenu.hidden = which !== 'menu';
  el.viewGame.hidden = which !== 'game';
  if (which === 'menu') { stopClock(); renderMenu(); }
  if (which === 'game') draw();
  return which;
}

const TIER_NOTE = {
  s4: '一只气球一只铁球，边界挪一两步就收口',
  s5: '开始要靠"这一段的最上/最下"卡位',
  s6: '边界要挪好几刀，默认档',
  s7: '5×5 里最满的一档：区多、段短',
  h6: '6×6 起手：黑格多一处，段被切得更碎',
  h7: '挖到唯一平均要挪十几步',
  h8: '菜单的封顶：出货率掉到 35%，还留在表上是因为读数量过',
};

function renderMenu() {
  el.tiers.innerHTML = '';
  const off = document.createElement('button');
  off.type = 'button';
  off.className = 'tier';
  off.id = 'tier-off';
  off.dataset.tier = 'off';
  off.innerHTML = `<span class="tier-name">官方例题 4×4</span><span class="tier-note">Nikoli 官网那张，本仓的黄金夹具：第 1 关</span><span class="tier-size mono">4×4 · 2 黑格 · 5 个区 · 判据/计数器/铅笔三条路都在这张盘上对过表</span>`;
  off.addEventListener('click', () => begin({ tier: 'off' }));
  el.tiers.appendChild(off);

  for (const t of TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.id = `tier-${t.id}`;
    b.dataset.tier = t.id;
    b.dataset.size = `${t.R}×${t.C}`;
    b.dataset.nr = String(t.NR);
    b.dataset.nb = String(t.NB);
    b.innerHTML =
      `<span class="tier-name">${t.name}</span>` +
      `<span class="tier-note">${TIER_NOTE[t.id] || ''}</span>` +
      `<span class="tier-size mono">${t.R}×${t.C} · 黑格${t.NB} · 区${t.NR}</span>` +
      `<span class="tier-measured mono" id="tier-measured-${t.id}">${measuredLine(t.id)}</span>`;
    b.addEventListener('click', () => begin({ tier: t.id }));
    el.tiers.appendChild(b);
  }
  syncResumeButton();
}

// ---------------------------------------------------------------- 输入：指针 / 触屏 / 键盘
// pointerdown 优先（鼠标、触屏、触控笔同一条路）；只在完全不支持 pointer 的老内核上
// 回落 touchstart/mousedown —— 回落里必须自己取 changedTouches，否则拿不到坐标。
function onPoint(clientX, clientY) {
  if (!game) return;
  if (!el.helpVeil.hidden) { showHelp(false); return; }
  const i = view.hitCell(clientX, clientY);
  if (i < 0) return;
  el.canvas.focus?.({ preventScroll: true });
  cycle(i);
}
if (typeof window !== 'undefined' && 'onpointerdown' in window) {
  el.canvas.addEventListener('pointerdown', ev => { ev.preventDefault(); onPoint(ev.clientX, ev.clientY); });
} else {
  el.canvas.addEventListener('touchstart', ev => {
    const t = ev.changedTouches && ev.changedTouches[0];
    if (!t) return;
    ev.preventDefault();
    onPoint(t.clientX, t.clientY);
  }, { passive: false });
  el.canvas.addEventListener('mousedown', ev => { ev.preventDefault(); onPoint(ev.clientX, ev.clientY); });
}
el.canvas.addEventListener('contextmenu', ev => ev.preventDefault());

$('#btn-w').addEventListener('click', () => game && place(game.cursor, W));
$('#btn-b').addEventListener('click', () => game && place(game.cursor, B));
$('#btn-e').addEventListener('click', () => game && place(game.cursor, E));
$('#btn-u').addEventListener('click', () => game && place(game.cursor, null));
$('#btn-undo').addEventListener('click', undo);
el.hint.addEventListener('click', hint);
$('#btn-clear').addEventListener('click', () => {
  if (!game) return;
  game.clear();
  sim.reset();
  el.winVeil.hidden = true;
  baseElapsed = 0;
  setPaused(false);
  startClock();
  sfx.play('und');
  say('重摆：题面（黑格与区界）一个字没动，只清掉摆上去的球，计时与碎屑一起归零。');
  syncAll();
  saveNow();
});
$('#btn-new').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : DEFAULT_TIER }));
$('#btn-menu').addEventListener('click', () => { saveNow(); show('menu'); });
$('#btn-menu-2').addEventListener('click', () => show('menu'));
$('#btn-again').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : DEFAULT_TIER }));
el.pause.addEventListener('click', () => setPaused(!sim.paused));
el.pauseResume.addEventListener('click', () => setPaused(false));
el.full.addEventListener('click', toggleFullscreen);
el.help.addEventListener('click', () => showHelp(el.helpVeil.hidden));
el.helpClose.addEventListener('click', () => showHelp(false));
el.helpVeil.addEventListener('click', ev => { if (ev.target === el.helpVeil) showHelp(false); });
el.resume.addEventListener('click', resumeSaved);
el.sound.addEventListener('click', () => {
  const st = setMuted(!sfx.muted);
  say(st.muted
    ? `音效已关：AudioContext 状态 ${st.ctx}，静音期间累计建过的振荡器 ${st.osc} 个（不再增长）。`
    : `音效已开：AudioContext 状态 ${st.ctx}，累计 ${st.osc} 个振荡器。`);
  syncAll();
});
$('#btn-reset').addEventListener('click', () => {
  Store.reset();
  lastDropped = [];
  game = null;
  sim.reset();
  show('menu');
  say('存档清空了：纪录、游标与进行中的那一局都不在盘上了。');
});

window.addEventListener('keydown', ev => {
  keys.seen++;
  keys.last = ev.key;
  if (ev.repeat) keys.repeated++;
  keys.by[ev.key] = (keys.by[ev.key] || 0) + 1;
  if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
  const k = ev.key;
  // 教学幕布开着：任何按键都先用来关它，不会顺手往盘上落子。
  if (!el.helpVeil.hidden) {
    if (k === 'Escape' || k === 'h' || k === 'H' || k === '?' || k === 'Enter' || k === ' ') { showHelp(false); ev.preventDefault(); keys.handled++; }
    return;
  }
  if (k === 'm' || k === 'M') { el.sound.click(); ev.preventDefault(); keys.handled++; return; }
  if (k === 'f' || k === 'F') { toggleFullscreen(); ev.preventDefault(); keys.handled++; return; }
  if (k === 'h' || k === 'H' || k === '?') { showHelp(true); ev.preventDefault(); keys.handled++; return; }
  if (!game) {
    // 菜单里 Enter/空格 开局：键盘用户不该被迫先用鼠标点一次档位。
    if (k === 'Enter' || k === ' ') { begin({ tier: DEFAULT_TIER }); ev.preventDefault(); keys.handled++; }
    return;
  }
  if (k === 'p' || k === 'P' || k === 'Escape') { setPaused(!sim.paused); ev.preventDefault(); keys.handled++; return; }
  if (k === 'r' || k === 'R') { begin({ tier: game.puzzle.tier }); ev.preventDefault(); keys.handled++; return; }
  if (sim.paused) { say('暂停中：按 P 或点「继续」恢复。'); syncAll(); return; }
  if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
    moveCursor(k); ev.preventDefault(); keys.handled++;
  } else if (k === ' ' || k === 'Enter') {
    cycle(game.cursor); ev.preventDefault(); keys.handled++;
  } else if (k === 'w' || k === 'W') { place(game.cursor, W); keys.handled++; }
  else if (k === 'b' || k === 'B') { place(game.cursor, B); keys.handled++; }
  else if (k === 'x' || k === 'X') { place(game.cursor, E); keys.handled++; }
  else if (k === 'Backspace' || k === 'Delete') { place(game.cursor, null); keys.handled++; }
  else if (k === 'z' || k === 'Z') { undo(); keys.handled++; }
  else if (k === 'g' || k === 'G') { hint(); keys.handled++; }
});

// 方向键在选择框里走：黑格也走（它是盘面上的格子，只是摆不了球），到盘边就停。
function moveCursor(k) {
  const [r, c] = game.B.rc(game.cursor);
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
  const rr = r + d[0], cc = c + d[1];
  if (!game.B.inb(rr, cc)) { say(`${game.B.name(game.cursor)} 已在盘边：方向键不弹到对侧。`); syncAll(); return; }
  const i = game.B.id(rr, cc);
  if (game.B.black.has(i)) say(`${game.B.name(i)} 是题面黑格：光标停给它，但摆不上球。`);
  else say('');
  game.cursor = i;
  syncAll();
}

window.addEventListener('resize', () => draw());
// 切到后台：停表 + 挂起音频。回来不该补跑一屏碎屑，也不该在看不见的标签页里出声。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (game && game.status !== 'won') setPaused(true);
  saveNow();
  if (!sfx.muted && sfx.ctx && sfx.ctx.state === 'running') sfx.ctx.suspend().catch(() => { sfx.errors++; });
});
window.addEventListener('pagehide', saveNow);

renderMenu();
startLoop();
syncFullscreen();
const deep = parseHash();
if (deep && tierOf(deep.tier) && deep.seed >= 1) begin({ tier: deep.tier, seed: deep.seed });

window.dosun = {
  version: VERSION,
  doc: DOC,
  view,
  sim,
  sfx,
  SIM_STEP,
  get game() { return game; },
  show, begin, renderMenu, select, cycle, place, undo, hint, measuredLine,
  setPaused, toggleFullscreen, showHelp, setMuted, resumeSaved, savedRecord, snapshot, saveNow,
  keyHits: () => ({ ...keys, by: { ...keys.by } }),
  dropped: () => ({ lastDropped, key: STORE_KEY }),
  reducedMotion: () => (rmq ? rmq.matches : null),
  audio: () => sfx.state(),
  fullscreen: fullscreenActive,
  state: () => (game ? {
    ...game.counts(),
    moves: game.moves, cursor: game.cursor, status: game.status, tier: game.puzzle.tier, seed: game.puzzle.seed,
    errs: game.errs(), elapsedMs: clock(), paused: sim.paused, reduced: sim.reduced,
    simTime: sim.simTime, simSteps: sim.simSteps, particles: sim.particles.length, muted: sfx.muted,
  } : null),
  winFacts: () => (game ? game.winFacts() : null),
  Store,
  engine: { mkBoard, official, TIERS, TIERS_MEASURED, DEFAULT_TIER, tierOf, tierFor, W, B, E, count, pencil, initCand, sameSol, shipOne, boardKey, fnv1a, DIG, Game, officialPuzzle, build },
};
