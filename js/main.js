// 接线：DOM、指针/键盘、计时器、存档游标，以及给真浏览器闸用的 window.dosun 台面。
// 这里**一条判据都不写** —— 盘面怎么算赢、每一档能不能出货，全部来自 js/engine/（经 js/ui/game.js）。
//
// seed 只来自存档里的自增游标，绝不取 Date.now()：页面上印着 "seed 7"，
// 就必须能用同一个 7 + 同一档重新出同一张盘（gen 腿在 node 与 Chrome 两边各出一份指纹对得上）。

import { BoardView } from './render/board.js';
import { Game, TIERS, TIERS_MEASURED, DEFAULT_TIER, tierOf, tierFor, officialPuzzle, build, official, mkBoard, W, B, E, count, pencil, initCand, sameSol, shipOne, boardKey, fnv1a, DIG } from './ui/game.js';

const VERSION = '0.1.0';
// 每个文档一个身份：片段跳转不换文档，所以它在那种导航后必须还在、真重载后必须换。
const DOC = 'doc' + Math.random().toString(36).slice(2, 10);
const STORE_KEY = 'dosun-cos:v1';

const $ = s => document.querySelector(s);
const el = {
  viewMenu: $('#view-menu'), viewGame: $('#view-game'), tiers: $('#tier-list'),
  name: $('#stat-name'), tier: $('#stat-tier'), seed: $('#stat-seed'), time: $('#stat-time'),
  moves: $('#stat-moves'), balloons: $('#stat-balloons'), balls: $('#stat-balls'),
  filled: $('#stat-filled'), regions: $('#stat-regions'), conflicts: $('#stat-conflicts'),
  genms: $('#stat-genms'), measured: $('#stat-measured'),
  stateLine: $('#state-line'), winVeil: $('#win-veil'), winMeta: $('#win-meta'), winRecord: $('#win-record'),
  canvas: $('#board'), sound: $('#btn-sound'),
};

// 档位行上印的那句话：一个字段都不自己算，全部取 TIERS_MEASURED（tools/generator-probe.mjs 的读数）。
export function measuredLine(id) {
  const m = TIERS_MEASURED[id];
  if (!m) return '';
  return `实测 出货 第${m.shipAttempt}次 · ${m.shipMs}ms · 唯一盘 ${m.uniq}/${m.sample} · 推满 ${m.uniqSolved}/${m.uniq} · 节点 med/p95 ${m.nodesMedP95[0]}/${m.nodesMedP95[1]}`;
}

const Store = {
  get data() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
  },
  save(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch { /* 隐私模式：读数照样有效，只是不跨页 */ } },
  cursor() { const d = this.data; return Number.isInteger(d.cursor) && d.cursor >= 1 ? d.cursor : 1; },
  setCursor(c) { const d = this.data; d.cursor = c; this.save(d); },
  best(id) { return (this.data.best || {})[id] || null; },
  record(id, r) {
    const d = this.data; d.best = d.best || {};
    const prev = d.best[id];
    // 同档只比时间：提示/步数不当门，免得把"更快"这条读数改成别的口径。
    if (!prev || r.ms < prev.ms) d.best[id] = r;
    this.save(d);
    return !prev || r.ms < prev.ms;
  },
  reset() { localStorage.removeItem(STORE_KEY); },
};

const view = new BoardView(el.canvas);
let game = null;
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
  view.draw(game);
}

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
  const ms = clock();
  const f = game.winFacts();
  const better = Store.record(game.puzzle.tier, { ms, moves: game.moves, size: `${game.R}×${game.C}` });
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
  if (game.status === 'won') onWin();
}

/** 摆一格：v 为 W/B/E/null。黑格会被 Game.set 挡回来，挡回来的那句话写进状态行。 */
function place(i, v) {
  if (!game) return null;
  const r = game.set(i, v);
  if (r.refused) { say(r.refused); syncAll(); return null; }
  if (r.noop) return null;
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
    if (game.B.black.has(i)) { say(`${game.B.name(i)} 是题面黑格：不属于任何区，也摆不了球。`); syncAll(); }
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
  const s = game.undo();
  if (!s) { say('没有可退的一步。'); syncAll(); return null; }
  say('');
  syncAll();
  return s;
}

function begin({ tier = DEFAULT_TIER, seed = null } = {}) {
  if (tier === 'off') {
    game = new Game(officialPuzzle());
    show('game');
    startClock();
    say('');
    syncAll();
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
  baseElapsed = 0;
  el.winVeil.hidden = true;
  show('game');
  startClock();
  say('');
  syncAll();
  writeHash();
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
}

el.canvas.addEventListener('pointerdown', ev => {
  if (!game) return;
  const i = view.hitCell(ev.clientX, ev.clientY);
  if (i < 0) return;
  ev.preventDefault();
  el.canvas.focus?.({ preventScroll: true });
  cycle(i);
});
el.canvas.addEventListener('contextmenu', ev => ev.preventDefault());

$('#btn-w').addEventListener('click', () => game && place(game.cursor, W));
$('#btn-b').addEventListener('click', () => game && place(game.cursor, B));
$('#btn-e').addEventListener('click', () => game && place(game.cursor, E));
$('#btn-u').addEventListener('click', () => game && place(game.cursor, null));
$('#btn-undo').addEventListener('click', undo);
$('#btn-clear').addEventListener('click', () => {
  if (!game) return;
  game.clear();
  el.winVeil.hidden = true;
  baseElapsed = 0;
  startedAt = Date.now();
  say('重摆：题面（黑格与区界）一个字没动，只清掉摆上去的球。');
  syncAll();
});
$('#btn-new').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : DEFAULT_TIER }));
$('#btn-menu').addEventListener('click', () => show('menu'));
$('#btn-menu-2').addEventListener('click', () => show('menu'));
$('#btn-again').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : DEFAULT_TIER }));
el.sound.addEventListener('click', () => {
  el.sound.setAttribute('aria-pressed', 'false');
  el.sound.textContent = '音效 未实装';
  say('这一版没有音效：不写没量过的东西。');
  syncAll();
});
$('#btn-reset').addEventListener('click', () => { Store.reset(); game = null; show('menu'); });

window.addEventListener('keydown', ev => {
  keys.seen++;
  keys.last = ev.key;
  if (ev.repeat) keys.repeated++;
  keys.by[ev.key] = (keys.by[ev.key] || 0) + 1;
  if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
  if (!game) return;
  const k = ev.key;
  if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
    moveCursor(k); ev.preventDefault(); keys.handled++;
  } else if (k === ' ' || k === 'Enter') {
    cycle(game.cursor); ev.preventDefault(); keys.handled++;
  } else if (k === 'w' || k === 'W') { place(game.cursor, W); keys.handled++; }
  else if (k === 'b' || k === 'B') { place(game.cursor, B); keys.handled++; }
  else if (k === 'x' || k === 'X') { place(game.cursor, E); keys.handled++; }
  else if (k === 'Backspace' || k === 'Delete') { place(game.cursor, null); keys.handled++; }
  else if (k === 'z' || k === 'Z') { undo(); keys.handled++; }
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

window.addEventListener('resize', draw);

renderMenu();
const deep = parseHash();
if (deep && tierOf(deep.tier) && deep.seed >= 1) begin({ tier: deep.tier, seed: deep.seed });

window.dosun = {
  version: VERSION,
  doc: DOC,
  view,
  get game() { return game; },
  show, begin, renderMenu, select, cycle, place, undo, measuredLine,
  keyHits: () => ({ ...keys, by: { ...keys.by } }),
  state: () => (game ? { ...game.counts(), moves: game.moves, cursor: game.cursor, status: game.status, tier: game.puzzle.tier, seed: game.puzzle.seed, errs: game.errs(), elapsedMs: clock() } : null),
  winFacts: () => (game ? game.winFacts() : null),
  hint: () => (game ? game.hint() : null),
  Store,
  engine: { mkBoard, official, TIERS, TIERS_MEASURED, DEFAULT_TIER, tierOf, tierFor, W, B, E, count, pencil, initCand, sameSol, shipOne, boardKey, fnv1a, DIG, Game, officialPuzzle, build },
};
