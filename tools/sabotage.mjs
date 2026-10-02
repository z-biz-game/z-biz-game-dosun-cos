// 破坏试验台账：把每一类谎各写回一份**临时副本**一遍，看压轴那道闸 doctest 会不会**点名**变红。
//
// 用法：node tools/sabotage.mjs                                       整跑台账（README 最后一节那张表）
//       SABOTAGE_TWIST=K3.expect=D5a node tools/sabotage.mjs         反证：故意把一把刀的期望改错，它必须判红
//
// 为什么要有这个文件：doctest 报「N 条全绿」只说明**这一轮没有东西坏**，它没说**闸会不会红**。
// 上一轮这条车道做过两次破坏试验（文档数字漂移、端口那句话被删），但刀打在 workspace 根的 scratch 里、
// 跑完 cp 还原，树上什么都没留下——那份"会红"只能相信一句话。这里把它落成被追踪的台账：
// 刀从 README 那张表里解析（文档改了，跑的就是改后的那一版），红行由脚本自己读回来。
//
// 五条硬规矩（机制照 z-biz-game-kurotto-cos/tools/sabotage.mjs，第一条是本仓多出来的）：
//   1. 刀只打在临时副本上：仓里的真文件一个字节都不许改，也不 git stash/checkout/restore
//      （共享工作区，别的车道正在同一个 workspace 里跑）。跑完逐文件对 sha256、再把副本删净。
//   2. 针必须唯一命中：0 次或 >1 次都是 ERROR——"打不中却一声不响跑完"是台账最坏的失败。
//      README 的台账行自己会把针抄一遍，所以数命中的时候把 `| K… |` 那些行摘掉再数。
//   3. rc 要等于台账那一行写的 rc，**且**红行里点名了它那一条断言，才算红；
//      语法炸了、超时也是 rc 非 0，但那不是闸红。
//   4. 每把刀的红只能落在它自己那一族（FAIL 行的 D 前缀）：把别的东西也弄红了，说明副本是坏的。
//   5. 全部刀红完之后，**不带刀**在副本里整跑一遍 doctest 要求全绿，且副本与仓里数出同一个条数——
//      否则"刀红了"可能只是"副本没建全"。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const PH = String.fromCharCode(1);
const stripTicks = s => (/^`.*`$/.test(s) ? s.slice(1, -1) : s);
const die = msg => { console.log(`  ERROR ${msg}`); console.log(`sabotage: 台账没能跑完（已打印 ${rows} 条）`); process.exit(2); };

let rows = 0;
const fail = [];
const ok = (cond, label, detail) => {
  rows++;
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};

// ---- 台账的刀从 README 最后一节那张表里解析 ----
const LEDGER = /^\| K\d+ \| /;
const readmePath = 'README.md';
const readme0 = read(readmePath);
const parse = l => l.replace(/\\\|/g, PH).split('|').slice(1, -1).map(c => c.trim().replace(new RegExp(PH, 'g'), '|'));
const knives = readme0.split('\n').filter(l => LEDGER.test(l)).map(l => {
  const c = parse(l);
  if (c.length !== 8) die(`台账那一行的列数不是 8：${l.slice(0, 40)}…（解析到 ${c.length} 列）`);
  return { id: c[0], where: c[1], file: stripTicks(c[2]), needle: stripTicks(c[3]),
    repl: stripTicks(c[4]).replace(/\\n/g, '\n'), expect: stripTicks(c[5]), cmd: stripTicks(c[6]), rc: +c[7], raw: l };
});

// ---- 反证入口：故意把某一把刀的某一格改错，台账必须因此判红 ----
const twist = process.env.SABOTAGE_TWIST || '';
if (twist) {
  const m = twist.match(/^(K\d+)\.(expect|repl|needle)=(.*)$/);
  if (!m) die(`SABOTAGE_TWIST 的形状要的是 K3.expect=…（收到「${twist}」）`);
  const k = knives.find(x => x.id === m[1]);
  if (!k) die(`SABOTAGE_TWIST 点了台账上没有的刀：${m[1]}`);
  k[m[2]] = m[3];
  console.log(`  反证跑：${m[1]} 的「${m[2]}」被故意改成「${m[3]}」——这一跑**必须**红，绿了才是台账坏了`);
}

const famOf = s => (String(s).match(/^D\d+/) || [])[0];
const DOCTEST_CMD = 'node tools/doctest.mjs';

// ---- 命中在哪一处：台账行自己会把针抄一遍，那些命中不算（副本里也一样）----
const hits = (src, needle) => {
  const lines = src.split('\n');
  const ledger = lines.map((l, i) => (LEDGER.test(l) ? i : -1)).filter(i => i >= 0);
  const inLedger = pos => {
    let up = 0;
    for (let i = 0; i < lines.length; i++) { up += lines[i].length + 1; if (up > pos) return ledger.includes(i); }
    return false;
  };
  const at = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) if (!inLedger(i)) at.push(i);
  return at;
};

// ---- 临时副本：整棵树拷一份（.git / node_modules / _tmp-* 不进副本），刀只打在副本里 ----
const SKIP = /(^|[\\/])(?:\.git|node_modules|_tmp[^\\/]*)(?:$|[\\/])/;
const SHADOW = mkdtempSync(join(tmpdir(), 'dosun-sab-'));
const relOf = p => relative(ROOT, p);
cpSync(ROOT, SHADOW, { recursive: true, filter: src => !SKIP.test(relOf(src)) });
const shadowRead = p => readFileSync(join(SHADOW, p), 'utf8');
const cleanup = () => { if (existsSync(SHADOW)) rmSync(SHADOW, { recursive: true, force: true }); };
process.on('exit', cleanup);

// ---- doctest 的一跑：rc、FAIL 行、它自己报的条数 ----
// GATE_ROWS_FILE / COUNTS_FILE 都不递：那两种入口会让同一条闸去比本轮 manifest 或浏览器读数，
// 而 manifest 在 sabotage 自己这一跑里还没有 sabotage 那一行——那是接线，不是刀。
const runDoctest = cwd => {
  const env = { ...process.env };
  delete env.GATE_ROWS_FILE; delete env.COUNTS_FILE; delete env.SABOTAGE_TWIST;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['tools/doctest.mjs'], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  return {
    rc: r.status === null ? -1 : r.status, out, secs: (Date.now() - t0) / 1000,
    timedOut: !!r.error && r.error.code === 'ETIMEDOUT',
    labels: out.split('\n').filter(l => /^FAIL \S+ :: /.test(l)).map(l => l.replace(/^FAIL \S+ :: /, '').trim()),
    rowCount: +(out.match(/^rows: (\d+) fail: \d+$/m) || [])[1] || -1,
  };
};

// ---- 预检：刀本身得是打得中的刀 ----
if (!knives.length) die('README 的台账里一把刀都没解析到（表格形状改了就是这里）');
const families = new Set();
for (const k of knives) {
  if (k.cmd !== DOCTEST_CMD) die(`${k.id} 跑的不是「${DOCTEST_CMD}」，而是「${k.cmd}」——台账不许指别的闸`);
  if (!famOf(k.expect)) die(`${k.id} 期望点名的「${k.expect}」不是一个 D 开头的 doctest 断言名`);
  if (k.rc !== 1) die(`${k.id} 那一行的 rc 写的不是 1（doctest 红了就是退码 1）：写了 ${k.rc}`);
  let src;
  try { src = read(k.file); } catch { die(`${k.id} 的文件不存在：${k.file}`); }
  const at = hits(src, k.needle);
  if (at.length !== 1) die(`${k.id} 的针在 ${k.file} 的台账行之外命中 ${at.length} 次（必须恰好 1 次）`);
  if (k.repl === k.needle) die(`${k.id} 的「改成」与针相同，这一刀不会改变任何东西`);
  families.add(famOf(k.expect));
}
ok(knives.length >= 3 && families.size === knives.length && knives.every(k => k.cmd === DOCTEST_CMD),
  'S1 台账解析到 ≥3 把刀、每把点名一族、跑的都是 doctest',
  `${knives.map(k => `${k.id}→${famOf(k.expect)}`).join(' ')} · 族 ${[...families].join('/')}`);

// ---- 规矩 5：不带刀整跑（副本 + 仓里各一次），绿，且两边条数一致 ----
const control = runDoctest(SHADOW);
writeFileSync(join(ROOT, `_tmp-dosun-sab-control.log`), `${DOCTEST_CMD}（无刀副本 ${SHADOW}）\nrc=${control.rc} 用时 ${control.secs.toFixed(2)}s\n${'='.repeat(60)}\n${control.out}`);
ok(control.rc === 0 && control.labels.length === 0 && !control.timedOut,
  'S2 不带刀时副本里的 doctest 全绿（红了就不是"刀弄红的"）',
  `rc=${control.rc} 红行 ${control.labels.length} 条 · 用时 ${control.secs.toFixed(2)}s · ${control.out.split('\n').filter(l => /^FAIL|^doctest: /.test(l)).slice(0, 3).join(' / ').slice(0, 160)}`);
const inRoot = runDoctest(ROOT);
ok(control.rowCount > 0 && control.rowCount === inRoot.rowCount,
  'S2b 副本不是残树：副本里的 doctest 与仓里的数出同一个条数',
  `副本 ${control.rowCount} 条 vs 仓里 ${inRoot.rowCount} 条（README 那句 doctest 条数就是这一个数，由 D14c 钉住）`);

// ---- 落刀：一把一把打，每把都只动它自己那一个文件，打完在副本里还原 ----
const sha = p => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex').slice(0, 16);
const before = Object.fromEntries(knives.map(k => [k.file, sha(k.file)]));
const results = [];
for (const k of knives) {
  const src = shadowRead(k.file);
  const at = hits(src, k.needle);
  if (at.length !== 1) die(`${k.id} 落刀前针在副本里的命中数变成 ${at.length} 了（预检之后树被人改过）`);
  writeFileSync(join(SHADOW, k.file), src.slice(0, at[0]) + k.repl + src.slice(at[0] + k.needle.length));
  const r = runDoctest(SHADOW);
  writeFileSync(join(SHADOW, `_sab-${k.id}.log`), `${DOCTEST_CMD}（副本，打了 ${k.id}）\nrc=${r.rc} 用时 ${r.secs.toFixed(2)}s\n${'='.repeat(60)}\n${r.out}`);
  writeFileSync(join(ROOT, `_tmp-dosun-sab-${k.id}.log`), `${DOCTEST_CMD}（副本，打了 ${k.id}：${k.file} 「${k.needle}」→「${k.repl}」）\nrc=${r.rc} 用时 ${r.secs.toFixed(2)}s\n${'='.repeat(60)}\n${r.out}`);
  writeFileSync(join(SHADOW, k.file), src);   // 副本内还原，下一把刀从干净状态起步
  const named = r.labels.filter(l => l.includes(k.expect));
  const fam = famOf(k.expect);
  const strays = r.labels.filter(l => famOf(l) !== fam);
  results.push({ id: k.id, rc: r.rc, named: named.length, total: r.labels.length, strays: strays.length, secs: r.secs });
  console.log(`  ${k.id} · ${k.where} · rc=${r.rc} 点名「${k.expect}」${named.length} 行 · 共红 ${r.labels.length} 条 · ${r.secs.toFixed(2)}s`);
  for (const l of named.slice(0, 3)) console.log(`      FAIL 行 → ${l.slice(0, 120)}`);
  if (r.timedOut) console.log(`      （超时被掐：这不是闸红）`);
  ok(!r.timedOut && r.rc === k.rc && named.length > 0,
    `S3 ${k.id} 把闸弄红了：rc=${k.rc} 且点名「${k.expect}」`,
    `实测 rc=${r.rc}（台账写的 ${k.rc}）· 点名 ${named.length} 行 · 红行共 ${r.labels.length} 条`);
  ok(r.labels.length > 0 && strays.length === 0,
    `S3b ${k.id} 只把它那一族（${fam}）弄红`,
    strays.length ? `越界的红行：${strays.slice(0, 2).join(' / ').slice(0, 140)}` : `${r.labels.length} 条红行全在 ${fam} 族里`);
}

const touched = knives.map(k => k.file).filter((f, i, a) => a.indexOf(f) === i);
const changed = touched.filter(f => sha(f) !== before[f]);
ok(changed.length === 0, 'S4 刀只在副本里飞：仓里的真文件一个字节都没变',
  changed.length ? `被改动了：${changed.join(' ')}` : `${touched.length} 个被动过的文件逐个 sha256 对回原值（${touched.map(f => `${f}:${before[f]}`).join(' ')}）`);
cleanup();
ok(!existsSync(SHADOW), 'S5 临时副本已删净', `副本目录 ${SHADOW} ${existsSync(SHADOW) ? '还在' : '已不在'}`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`FAIL sabotage :: ${f}`);
  console.log(`sabotage: ${fail.length}/${rows} 条红`);
  process.exit(1);
}
console.log(`sabotage: PASS（${rows} 条断言）`);
