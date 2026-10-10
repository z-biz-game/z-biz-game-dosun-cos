// 文档是被断言的面：README/DESIGN 印出去的每一个「现值」都必须等于代码或脚本里的现在值。
//
// 为什么要有这个文件：判据、计数器、铅笔、出题台阶都有命令去重测，散文没有。
// 它可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。
// 本仓的 README 里有一整类这样的数——七档表、腿与报告的条数、端口、计数器预算、
// CI 里到底跑了哪几条门禁、`SAMPLE` 旋钮的值——每一个都能由一条等式钉住，于是这里钉住它们。
//
// 规矩（和 tools/generator-probe.mjs 的贴回对表一样）：
//   * 每一条等式都配一条「解析到的条数」的反空转断言——正则没命中不是绿，是红；
//   * 只比现值，不比读数：ms、出货率、节点数这类本机测量在这里只作为「文档写的数
//     与代码里的界」的关系出现（D5），不去复测它们；
//   * 破坏试验台账（README 最后一节）逐条验过这里的刀真的会红。
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS, TIERS_MEASURED, DIG } from '../js/engine/tiers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};
// 不进 rows 的两类线：line（口径说明）与 skip（这一种运行模式下没法比的东西）。
// 它们必须是 console.log 而不是 ok()，否则 D14c 那条"文档抄的本闸条数 == 本轮实测"
// 会随调用方式（npm test / 单跑 / --counts）变化，等于让文档去追一个会跳的数。
const skip = (label, why) => console.log(`  SKIP ${label} · ${why}`);

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const PENCIL = read('js/engine/pencil.js');
const MAIN = read('js/main.js');
const PROBE = read('tools/generator-probe.mjs');
const KIT = read('tools/kit.mjs');
const PLAYTEST = read('tools/playtest.cjs');
const SCEN = read('tools/scenarios.js');
const HTML = read('index.html');

// 闸的名单只有一份：verify.sh 里 `LEGS=${LEGS:-…}` 的默认值加上 `reports_of` 的那些分支。
// 这里从**脚本现值**把名字推出来，不写死 engine/gen/play —— 一条腿加进脚本、README 忘了跟着加数，
// 写死名单的闸会照样绿（它读的是自己那份名单）。这一类"缩样看不出来"的洞正是本文件存在的理由。
const SHAPE = (() => {
  const m = VERIFY.match(/^LEGS=\$\{LEGS:-([^}]*)\}/m);
  const legs = m ? m[1].trim().split(/\s+/) : [];
  const map = {};
  for (const x of VERIFY.matchAll(/^ {4}([a-z][a-z0-9_-]*)\)\s+echo "([^"]*)"/gm)) map[x[1]] = x[2].trim().split(/\s+/);
  const reports = [...new Set(legs.flatMap(l => map[l] || []))];
  const names = [...new Set(reports.map(t => t.split('/').pop()))];
  return { legs, map, reports, names };
})();
const ITEMS_RE = () => new RegExp(`\\b(${SHAPE.names.join('|')}) (\\d+)(?=\\s*\\/|\\s*，|\\s*\\()`, 'g');

// ---- 另一种入口：--counts（由 verify.sh 的浏览器段在对表之后调一次）----
// 文档里那句"逐报告条数"抄的是浏览器腿本轮真报出来的数。逻辑段跑不到浏览器，所以那几个数
// 由这里比对：COUNTS_FILE 指向刚才那份 counts.txt（<形态> <腿/场景> <条数>），逐形态必须等量、
// 且每一份都等于文档抄的那个值。这一模式不跑别的检查，也不进 rows——
// 否则同一份文档在两种入口下会数出两个不同的条数，D14c 那条自证就成了追一个会跳的数。
if (process.argv.includes('--counts')) {
  const path = process.env.COUNTS_FILE;
  const say = (cond, label, detail) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`); return cond ? 0 : 1; };
  let bad = 0;
  if (!path) {
    bad += say(false, 'counts :: 没有 COUNTS_FILE', '这一模式要的是浏览器段刚写出的 counts.txt（由 tools/verify.sh 递进来）');
  } else {
    const seen = {};
    for (const l of read(path).split('\n').filter(Boolean)) {
      const [shape, tag, n] = l.split(/\s+/);
      (seen[tag] = seen[tag] || {})[shape] = +n;
    }
    const expect2 = SHAPE.reports;
    const items2 = [...README.matchAll(ITEMS_RE())].map(m => [m[1], +m[2]]);
    bad += say(expect2.length >= 4 && items2.length === expect2.length,
      'counts :: 文档的逐报告条数与脚本的名单一样长',
      `脚本 ${expect2.join('/')} vs 文档 ${items2.map(([n]) => n).join('/')}`);
    for (const full of expect2) {
      const who = full.split('/').pop();
      const doc = items2.find(([n]) => n === who)?.[1];
      const per = seen[full] || {};
      const vals = Object.keys(per).sort().map(k => per[k]);
      bad += say(vals.length > 0 && doc !== undefined && vals.every(v => v === doc),
        `counts ${full}：文档 ${doc} == 本轮每个形态报出的条数`,
        vals.length ? `本轮 ${Object.keys(per).sort().map(k => `形态${k}=${per[k]}`).join(' ')}` : '这一份报告本轮没落地');
    }
    for (const t of Object.keys(seen)) if (!expect2.includes(t)) bad += say(false, `counts ${t}：落地了但不在名单上`, 'reports_of 与腿循环不同源');
  }
  console.log(bad ? `\ncounts: ${bad} 处对不上` : '\ncounts: PASS');
  process.exit(bad ? 1 : 0);
}

// ---- D1 七档表：页面印给玩家的那张表 == TIERS / TIERS_MEASURED 的现值 ----
const tierRows = [...README.matchAll(/^\| (?:\S+) (s4|s5|s6|s7|h6|h7|h8) \| (\d+)×(\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| 第 (\d+) 次 · \d+ ms \| (\d+) \/ (\d+) \|/gm)];
ok(tierRows.length === TIERS.length, 'D1a README 的档位表解析到的行数等于 TIERS 的档数',
  `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档（解析不到不等于通过）`);
for (const t of TIERS) {
  const m = TIERS_MEASURED[t.id];
  const row = tierRows.find(r => r[1] === t.id);
  const dims = row && +row[2] === t.R && +row[3] === t.C && +row[4] === t.NB && +row[5] === t.NR && +row[6] === t.ship.attempts;
  const meas = row && +row[7] === m.made && +row[8] === m.uniq && +row[9] === m.uniqSolved
    && +row[10] === m.shipAttempt && +row[11] === m.nodesMedP95[0] && +row[12] === m.nodesMedP95[1];
  ok(!!row && !!dims && !!meas, `D1 ${t.id}：文档那一行等于 TIERS + TIERS_MEASURED`,
    row ? `文档 ${row[2]}×${row[3]} 黑格${row[4]} 区${row[5]} 试${row[6]} · 造成${row[7]} 唯一${row[8]} 推满${row[9]} 第${row[10]}次 节点${row[11]}/${row[12]} vs `
        + `代码 ${t.R}×${t.C} 黑格${t.NB} 区${t.NR} 试${t.ship.attempts} · 造成${m.made} 唯一${m.uniq} 推满${m.uniqSolved} 第${m.shipAttempt}次 节点${m.nodesMedP95.join('/')}`
      : 'README 的档位表里没有这一档');
}
// 表里那一列 ms 是墙钟观测值，不进等式——但它必须被**说成**观测值，否则读者以为闸读过它。
ok(/观测值[^。\n]*不进等式|不进等式[^。\n]*观测值/.test(README), 'D1b 文档把 ms 那一列标成"观测值、不进等式"',
  'README 里那句关于墙钟的话还在不在');

// ---- D2 铅笔的命名规则：文档列的名字集 == pencil.js 真的打印出来的那些 ----
// 标签要从**字符串字面量**里取：注释里的清单会跟着散文漂，代码里印出来的才是玩家能看到的。
const codeLabels = [...new Set([...PENCIL.matchAll(/[`']((?:N[1-4][a-z]?) ([^`'：(]+)(?:\([^)]*\))?)/g)].map(m => m[1].trim()))];
const roster = README.match(/命名规则一共 (\d+) 个标签：([^。\n]+)/);
const docLabels = roster && roster[2];
// 分隔符只有 ` · ` 一种：按空格再切一刀会把 "N1 浮" 拆成 "N1" 和 "浮"，
// 于是"浮"永远匹配不到任何代码标签——那条 D2 会永远红，红得毫无意义。
const docList = docLabels ? docLabels.trim().split(/\s*·\s*/).filter(Boolean) : [];
ok(codeLabels.length >= 6 && docList.length >= 6, 'D2a 两边都解析到了规则名（少一条就是解析器空转）',
  `代码标签 ${codeLabels.length} 条 · 文档 ${docList.length} 条`);
ok(!!roster && +roster[1] === docList.length && docList.length === new Set(docList).size,
  'D2c 文档说"一共 N 个标签"，后面就真列了 N 个（且不重复）',
  roster ? `写了 ${roster[1]} · 列了 ${docList.length} · 去重后 ${new Set(docList).size}` : '解析不到那句名单');
const missingInCode = docList.filter(l => !codeLabels.some(c => c.startsWith(l.split('(')[0])));
ok(missingInCode.length === 0, 'D2 README 点名的每条规则在 pencil.js 里都真被打印',
  missingInCode.length ? `文档引用了代码里印不出来的名字：${missingInCode.join(' ')}` : `${docList.join(' ')} 全部有出处`);
const PENCIL_BODY = PENCIL.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const ghost = codeLabels.filter(l => PENCIL_BODY.split(l).length - 1 < 1);
ok(ghost.length === 0, 'D2b 每条标签都不只活在注释里（非注释行里至少出现一次）',
  ghost.length ? `只有声明没有实现：${ghost.join(' ')}` : `${codeLabels.length} 条标签在 pencil.js 的非注释行里各出现 ≥1 次`);

// ---- D3 闸的形状：腿数、每腿报告数、形态数、合计，全部从 verify.sh 现值推 ----
const { legs, map: reportMap, reports } = SHAPE;
const shapesM = VERIFY.match(/^SHAPES=\((.*)\)$/m);
const shapes = shapesM ? (shapesM[1].match(/"([^"]+)"/g) || []).length : 0;
const shapeDoc = DOCS.match(/闸的形状：腿 (\d+) 条 · 报告 (\d+) 份 · 形态 (\d+) 种 · 合计 (\d+) 份/);
ok(legs.length >= 3 && Object.keys(reportMap).length >= legs.length && reports.length >= legs.length + 1 && shapes >= 2 && !!shapeDoc,
  'D3a 脚本与文档两边都解析到了闸的形状',
  `verify.sh: ${legs.length} 腿 → ${reports.length} 份报告 × ${shapes} 形态 · 文档句 ${shapeDoc ? '在' : '不在'}`);
ok(!!shapeDoc && +shapeDoc[1] === legs.length, `D3 文档写的腿数等于 LEGS 默认值（${legs.join(' ')}）`,
  shapeDoc ? `文档 ${shapeDoc[1]} vs 脚本 ${legs.length}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[2] === reports.length, `D3b 文档写的报告份数等于 reports_of 现算的名单（${reports.join(' ')}）`,
  shapeDoc ? `文档 ${shapeDoc[2]} vs 脚本 ${reports.length}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[3] === shapes, 'D3c 文档写的形态数等于 SHAPES 的条目数',
  shapeDoc ? `文档 ${shapeDoc[3]} vs 脚本 ${shapes}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[4] === reports.length * shapes, 'D3d 合计份数 == 报告数 × 形态数',
  shapeDoc ? `文档 ${shapeDoc[4]} vs ${reports.length}×${shapes}=${reports.length * shapes}` : '解析不到');
// reports_of 是唯一的名单来源：腿循环与对表都必须从它现算，不许另写一份数字。
ok(!/for tag in (?:engine\/engine|engine\/menu)/.test(VERIFY) && !/HIT -lt \d/.test(VERIFY),
  'D3e verify.sh 里没有第二份写死的报告名单（分母只能由 reports_of 现算）',
  VERIFY.match(/HIT -lt \d|for tag in engine/g) ? `还留着：${(VERIFY.match(/HIT -lt \d|for tag in engine/g) || []).join(' / ')}` : '没有');

// ---- D3f 第三种形态（已部署站点）：它是脚本里那句 BASE_URL 追加，不是文档自己数的 ----
// SHAPES 的字面量只有本地两种（CI 就按这两种跑，线上形态在部署完成前根本不存在），
// 所以"本轮真跑三遍"这件事要能被机器重算：追加条款在不在脚本里、文档写的形态数等不等于 字面量 + 1。
const appendsLive = /SHAPES\+=\("\$BASE_URL"\)/.test(VERIFY);
const liveDoc = DOCS.match(/第三形态真跑：(\d+) 种形态 × (\d+) 份报告 = (\d+) 份读数/);
ok(appendsLive && !!liveDoc && +liveDoc[1] === shapes + 1 && +liveDoc[2] === reports.length &&
  +liveDoc[3] === (shapes + 1) * reports.length,
  'D3f 文档写的三形态读数份数 == （SHAPES 字面量 + BASE_URL 那一条追加）× 报告数',
  `脚本 ${shapes} 种字面量 + 追加条款${appendsLive ? '在' : '不在'} → ${shapes + 1} × ${reports.length} vs 文档 ${liveDoc ? liveDoc.slice(1, 4).join('/') : '解析不到'}`);

// ---- D4 端口：文档那一句 == package.json / verify.sh / playtest.cjs 的现值 ----
const httpM = VERIFY.match(/HTTP=\$\{HTTP_PORT:-(\d+)\}/);
const cdpM = VERIFY.match(/PORT=\$\{CDP_PORT:-(\d+)\}/);
const serveM = (PKG.scripts?.serve || '').match(/server\.cjs\s+(\d+)/);
const pbM = PLAYTEST.match(/BASE_URL \|\| 'http:\/\/127\.0\.0\.1:(\d+)/);
const phM = PLAYTEST.match(/CDP_PORT \|\| (\d+)/);
const portDoc = DOCS.match(/端口：本地 (\d+) · CDP (\d+)/);
ok(httpM && cdpM && serveM && pbM && phM && portDoc,
  'D4a 五个来源与文档都解析到了端口（少一个就说明接线改了形状）',
  `verify ${httpM?.[1]}/${cdpM?.[1]} · package ${serveM?.[1]} · playtest ${pbM?.[1]}/${phM?.[1]} · 文档 ${portDoc?.[1]}/${portDoc?.[2]}`);
const httpVals = [httpM?.[1], serveM?.[1], pbM?.[1]];
const cdpVals = [cdpM?.[1], phM?.[1]];
ok(!!portDoc && httpVals.every(v => +v === +portDoc[1]), `D4 HTTP 端口三处一致且等于文档（${httpVals.join('/')}）`,
  portDoc ? `文档 ${portDoc[1]}` : '解析不到');
ok(!!portDoc && cdpVals.every(v => +v === +portDoc[2]), `D4b CDP 端口两处一致且等于文档（${cdpVals.join('/')}）`,
  portDoc ? `文档 ${portDoc[2]}` : '解析不到');

// ---- D5 计数器预算：文档写的读数必须真的小于代码里的 cap ----
const capDoc = README.match(/节点预算 (\d+)[^。\n]*本轮最大观测 (\d+)/);
ok(!!capDoc && !!DIG.cap, 'D5a 两边都读到了节点预算', `代码 DIG.cap ${DIG.cap} · 文档 预算 ${capDoc?.[1]} / 读数 ${capDoc?.[2]}`);
ok(!!capDoc && +capDoc[1] === DIG.cap, 'D5 文档写的预算等于 tiers.js 的 DIG.cap',
  capDoc ? `文档 ${capDoc[1]} vs 代码 ${DIG.cap}` : '解析不到');
ok(!!capDoc && +capDoc[2] < +capDoc[1], 'D5b 「远没花完预算」这句散文是真的：读数 < cap',
  capDoc ? `${capDoc[2]} < ${capDoc[1]}，余量 ${((1 - +capDoc[2] / +capDoc[1]) * 100).toFixed(1)}%` : '解析不到');
// 那一个读数不是"随便挑的一个数"：文档说"本轮最大观测"，就必须等于表里最大的那个节点 p95。
const maxNodes = Math.max(...Object.values(TIERS_MEASURED).map(m => m.nodesMedP95[1]));
ok(!!capDoc && +capDoc[2] === maxNodes, `D5c 文档那个"最大观测"等于表里的最大节点 p95（${maxNodes}）`,
  capDoc ? `文档 ${capDoc[2]} vs 表 ${maxNodes}` : '解析不到');

// ---- D6 CI 覆盖表：文档声称在 CI 跑的门禁，必须真在那个 job 里 ----
const jobsSrc = CI.slice(CI.indexOf('\njobs:'));
const jobBlocks = {};
// 只在 jobs: 那一段里找 job——`on:` 与 `permissions:` 下也是两空格缩进的 key，
// 整份文件一起匹配会把 push/pull_request 当成 job 名。
for (const m of jobsSrc.matchAll(/^ {2}([A-Za-z0-9_-]+):([\s\S]*?)(?=\n {2}[A-Za-z0-9_-]+:|\n(?=\S)|(?![\s\S]))/gm)) jobBlocks[m[1]] = m[2];
const ciRows = [...README.matchAll(/^\| (`[^`]+`) \| (check|browser) \| `([^`]+)` \|/gm)];
ok(Object.keys(jobBlocks).length >= 2 && ciRows.length >= 3,
  'D6a CI 的 job 块与文档的覆盖表都解析到了东西', `job ${Object.keys(jobBlocks).join('/')} · 覆盖表 ${ciRows.length} 行`);
for (const r of ciRows) {
  const block = jobBlocks[r[2]] || '';
  const cmd = r[1].replace(/`/g, '');
  ok(block.includes(r[3]) && block.includes(cmd.split(' ').slice(-2).join(' ')),
    `D6 覆盖表那一行真在 ${r[2]} job 里：${cmd}`, `步骤名 ${r[3]}`);
}
const ciCommands = [...CI.matchAll(/(?:npm run|npm test|bash tools\/verify\.sh)/g)].map(m => m[0]);
const declared = new Set(ciRows.map(r => r[1].replace(/`/g, '')));
ok(ciCommands.length >= 3 && [...declared].some(c => /verify/.test(c)),
  'D6b 覆盖表把 verify/selftest 都算上了（浏览器闸不是只在本地跑的东西）',
  `CI 里的命令读数 ${ciCommands.length} 处 · 表上 ${[...declared].join(' / ')}`);

// ---- D7 SAMPLE 旋钮：ci/package 引用的默认值 == 文档引用的值 == 不接线时的默认，且 env 真的接得上 ----
const defSample = (PROBE.match(/const SAMPLE = envInt\('SAMPLE', (\d+)\)/) || [])[1];
const docSample = README.match(/每档 (\d+) 次尝试/);
const tableSample = [...new Set(Object.values(TIERS_MEASURED).map(m => m.sample))];
ok(!!defSample && !!docSample && tableSample.length === 1, 'D7a 三处都读到了样本数',
  `probe 默认 ${defSample} · 文档 ${docSample?.[1]} · 表里 ${tableSample.join('/')}`);
ok(!!defSample && !!docSample && +defSample === +docSample[1] && +defSample === tableSample[0],
  'D7 probe 的默认 SAMPLE == 文档引用的那个值 == TIERS_MEASURED 记的样本数',
  `${defSample} / ${docSample?.[1]} / ${tableSample.join('/')}`);
const probe = await new Promise(resolve => {
  const child = spawn(process.execPath, [join(ROOT, 'tools/generator-probe.mjs'), 'TIERS=s4', 'SAMPLE=3'],
    { env: { ...process.env, SAMPLE: '3', TIERS: 's4' } });
  let buf = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(buf || '(no output)'); }, 60000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d;
    if (/每档 \d+ 次尝试/.test(buf)) { clearTimeout(timer); child.kill('SIGKILL'); resolve(buf.split('\n').find(l => /每档 \d+ 次尝试/.test(l)) || buf); }
  });
  child.on('close', () => { clearTimeout(timer); resolve(buf.split('\n').find(l => /每档 \d+ 次尝试/.test(l)) || buf.split('\n')[0] || '(exited silently)'); });
});
ok(/每档 3 次尝试/.test(probe), 'D7b 子进程探针：SAMPLE=3 必须真的改成 3 次（env 是接上的，不是装饰）',
  `probe 口径行：${probe.trim().slice(0, 120)}`);

// ---- D8 逐报告条数的自洽：文档列的每个数加起来，必须等于它自己写的两个总数 ----
const items = [...README.matchAll(ITEMS_RE())].map(m => ({ name: m[1], n: +m[2] }));
const totals = README.match(/每形态 (\d+) 条 · 合计 (\d+) 条/);
ok(items.length === reports.length && !!totals, 'D8a 逐报告条数与总数都解析到了',
  `解析 ${items.length} 项 / 期望 ${reports.length} 份 · 总句 ${totals ? '在' : '不在'}`);
const perShape = items.reduce((a, b) => a + b.n, 0);
ok(!!totals && perShape === +totals[1], 'D8 文档列的逐报告条数加起来 == 它写的每形态条数',
  totals ? `加起来 ${perShape} vs 文档 ${totals[1]}` : '解析不到');
ok(!!totals && perShape * shapes === +totals[2], 'D8b 每形态条数 × 形态数 == 文档写的合计（各形态必须等量）',
  totals ? `${perShape}×${shapes} vs ${totals[2]}` : '解析不到');

// ---- D9 引用不漂：文档里每一个 path:NN 都指向真实文件里真实存在的那一行 ----
// 只查"行数在范围内"不够：往文件中间插几行，引用就集体往后挪一格，而越界检查一声不响地全绿
// （本轮 js/main.js 加了 49 行，README/DESIGN 里 5 处引用就这么指到了隔壁代码）。
// 补两条能机器判的：区间两头不许落在空行上，单行引用更不许整行只写着块闭合符
// （`done` / `fi` / `}` / `else:`）—— 散文引的是那句实现，指到闭合符上说明它已经漂走了。
// 只判"整行就是一个闭合符"：`elif COUNTS_FILE=… node tools/doctest.mjs --counts` 是实句，不是闭合符。
const CLOSER = /^(?:[)\]};]+|done|fi|else|elif|esac|end|then|else:)$/;
// 台账那几行（`| K… |`）的"针"与"改成"两格里抄的就是引用本身，它描述的是**副本里将要出现的那个状态**，
// 不是仓里的现值——K5 那一格写的就是"把引用打到空行上"。sabotage 数命中的时候同样先把这些行摘掉
// （`tools/sabotage.mjs` 的 `hits`），这里用同一条规矩，否则台账自己会被 D9 判红。
const DOCS_NOLEDGER = DOCS.split('\n').filter(l => !/^\| K\d+ \| /.test(l)).join('\n');
const cites = [...DOCS_NOLEDGER.matchAll(/((?:\.github\/workflows\/)?[\w./-]+\.(?:js|mjs|cjs|sh|json|html|md|yml)):(\d+)(?:-(\d+))?/g)];
const bad = [];
for (const c of cites) {
  let src;
  try { src = read(c[1]); } catch { bad.push(`${c[1]}:${c[2]}（文件不存在）`); continue; }
  const lines = src.split('\n');
  const n = lines.length;
  if (+c[2] > n || (+c[3] && +c[3] > n)) { bad.push(`${c[1]}:${c[2]}${c[3] ? '-' + c[3] : ''}（该文件只有 ${n} 行）`); continue; }
  for (const [k, what] of [[c[2], '首'], [c[3] || c[2], '尾']]) {
    const L = lines[+k - 1].trim();
    if (!L) bad.push(`${c[1]}:${k}（${what}行是空行——引用早已漂走）`);
    else if (!c[3] && CLOSER.test(L)) bad.push(`${c[1]}:${k}（整行只写着块闭合符 ${JSON.stringify(L)}，散文引的不是这里）`);
  }
}
ok(cites.length >= 20, 'D9a 文档里的行号引用解析到了一大堆（少于 20 条说明引用格式改了）', `${cites.length} 条引用`);
ok(bad.length === 0, 'D9 每一条 path:NN 都落在真实文件的行数内，且指到的那一行不是空行、不是块闭合符',
  bad.length ? `漂了：${bad.join('，')}` : `${cites.length} 条引用逐条开过文件、对到了行内容`);

// ---- D10 红线标签双向：文档点名的每条红线都得存在，存在的每条红线都得有人写 ----
// 取**整条标签**再比关键字：早先在这里先 split('：')[0]，于是"红线：…（打架）"被截成"红线"，
// D10b 拿着截断后的东西去找"打架"，永远找不到——一条永远红、也永远抓不到东西的闸。
const KW = /liar|打架|出货|空转|推满|一致/;
const probeLabels = [...new Set([...PROBE.matchAll(/g\.(?:eq|ok)\((['`])([^'`]+)\1/g)].map(m => m[2].replace(/\$\{[^}]*\}/g, '').trim()))];
// 分母从探针自己现数，不写死：早前这里钉的是 ">= 12"，而探针只有 11 处调用——
// 那是一条永远红、且永远抓不到东西的闸。等式两边都取自同一个文件才叫解析器不空转。
const probeCalls = (PROBE.match(/g\.(?:eq|ok)\(/g) || []).length;
const realLabels = probeLabels.filter(l => KW.test(l));
const knifeLabels = ['liar', '打架', '出货', '空转'];
const docHits = knifeLabels.filter(l => DOCS.includes(l));
ok(probeLabels.length === probeCalls && realLabels.length >= 3 && docHits.length === knifeLabels.length,
  'D10a 出题器的四条红线都在文档里被点名，且探针每条断言的标签都被解析到（少一条就是解析器空转）',
  `探针调用 ${probeCalls} 处 · 解析到标签 ${probeLabels.length} 条 · 带关键字 ${realLabels.length} 条 · 文档点到 ${docHits.join('/')}`);
const unprobed = knifeLabels.filter(l => !realLabels.some(r => r.includes(l)));
ok(unprobed.length === 0, 'D10b 文档点名的每条红线在 generator-probe 里都真有那条断言',
  unprobed.length ? `文档引用了不存在的红线：${unprobed.join(' ')}（探针标签：${realLabels.join(' / ').slice(0, 160)}）` : `${knifeLabels.join(' ')} 都有断言`)

// ---- D11 红必须点名它的闸：每个 mkGate 都带 tag，FAIL 行必须把 tag 印出来 ----
const gateFiles = ['tools/generator-probe.mjs', 'tools/rule-test.mjs', 'tools/counter-test.mjs', 'tools/pencil-test.mjs', 'tools/golden-test.mjs'];
const noTag = [];
for (const f of gateFiles) {
  const src = read(f);
  const m = src.match(/mkGate\(([^)]*)\)/);
  if (!m || !/^'[^']+'$/.test(m[1].trim())) noTag.push(`${f}: ${m ? JSON.stringify(m[1]) : '没有 mkGate 调用'}`);
}
ok(noTag.length === 0, 'D11 每条闸都给自己的 tag 传了字面量（FAIL 行才不会是 undefined）',
  noTag.length ? `这些闸没名字：${noTag.join('，')}` : `${gateFiles.length} 个闸都有 tag`);
ok(/FAIL \$\{tag\}/.test(KIT) && /tag, ok, eq, line, finish/.test(KIT),
  'D11b kit.mjs 的红行里印着 tag（读数带得出门）', 'FAIL ${tag} :: … 那一句还在');

// ---- D12 页面上那句「实测」只引用表里的字段，不自己算 ----
const ml = (MAIN.match(/export function measuredLine\(id\) \{([\s\S]*?)\n\}/) || [])[1] || '';
const usedFields = [...new Set([...ml.matchAll(/m\.([A-Za-z][\w]*)/g)].map(m => m[1]))];
const tableKeys = new Set(Object.keys(TIERS_MEASURED.s4));
const bogus = usedFields.filter(f => !tableKeys.has(f) && f !== 'nodesMedP95');
ok(!!ml && usedFields.length >= 6 && bogus.length === 0,
  'D12 measuredLine 读的每个字段都在 TIERS_MEASURED 里', `用了 ${usedFields.join(' ')} · 不在表里：${bogus.join(' ') || '无'}`);
// 把 `${…}` 表达式与坐标轴名 p95 都遮掉，剩下的字面文案里不该再有数字：
// 早先写的是 `!/\d\d/`，它把字段名 nodesMedP95 里的 95 当成"硬编码读数"，红得没有道理。
const mlLit = ml.replace(/\$\{[^}]*\}/g, '◆').replace(/p95/gi, '');
const stray = [...mlLit.matchAll(/\d+/g)].map(x => x[0]);
ok(stray.length === 0, 'D12b measuredLine 的字面文案里没有读数（页面上的每个数都来自表）',
  stray.length ? `字面量里写着：${stray.join('/')}` : '遮掉 ${…} 与 p95 之后一个数字都没有');
// 选档页那句披露也不许自己带百分数：出货率只有各档实测行那一个出处。
const disclose = (HTML.match(/id="tier-disclose">([\s\S]*?)<\/p>/) || [])[1] || '';
ok(!!disclose && !/\d+(\.\d+)?\s*%/.test(disclose) && /造成/.test(disclose),
  'D12c index.html 的那句披露不自己写出货率（只指向各档实测行的字段）',
  disclose ? (/\d+%/.test(disclose) ? '散文里又冒出了一个百分数' : '指向 造成/样本') : '解析不到那句披露');
// 档名旁那句说明也算页面文案：它的百分数必须由表里的字段算出来，源码里不许留字面量。
const literalPct = MAIN.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /^\s*[^/]*\d+(\.\d+)?\s*%/.test(l) && !/\/\/|\/\*/.test(l));
ok(literalPct.length === 0, 'D12d js/main.js 的页面文案里没有写死的百分数（要就现场算）',
  literalPct.length ? `这些行自带没有证人的读数：${literalPct.map(([n]) => `js/main.js:${n}`).join('，')}` : '每一个百分数都是算出来的');

// ---- D13 shell 里裸写的 $VAR 后面不能紧跟多字节字符 ----
// 破坏试验 K2 撞出来的真坑：`echo "…GEN_SEED=$GEN_SEED，…"` 在某些 bash/locale 组合下把全角逗号
// 的首字节算进变量名，set -u 当场 unbound variable——**闸自己炸了，一条断言都没跑**，
// rc 非 0 看着像"闸很严"，其实是台架在骗人。写文档的人看不见这一层，所以由这里钉住。
const SHELLS = ['tools/verify.sh'];
const rawHit = [];
for (const f of SHELLS) {
  const buf = Buffer.from(read(f), 'utf8');
  for (const [n, line] of buf.toString('utf8').split('\n').entries()) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/);
    if (m) rawHit.push(`${f}:${n + 1} ${JSON.stringify(m[0].slice(0, 14))}`);
  }
}
ok(rawHit.length === 0, 'D13 verify.sh 里每个紧跟中文标点的变量都写了 ${…}',
  rawHit.length ? `裸写会随 locale 变成另一个变量名：${rawHit.join('，')}` : `${SHELLS.length} 个 shell 文件干净`);

// ---- D14 本闸自己的条数也被钉住：文档抄的是一个会随断言增减漂的数 ----
// 加一条断言、删一条解析器，README 里那句"本轮 N 条"就过期了——而这一份文档正是被这个文件读的。
// 所以让最后一条等式拿 rows 现算的总数去比文档：这个闸证明自己数得对。
// 名单与每条闸的条数都写在同一句里（档名 + 数字），因为写"合计 155"而下面不列明细的话，
// 那一个数既没人重算、也没人知道自己该跟着变。
const gateRoster = (VERIFY.match(/^GATES="([^"]+)"/m) || [])[1];
const gateList = gateRoster ? gateRoster.trim().split(/\s+/) : [];
const sumM = README.match(/逻辑闸本轮合计 (\d+) 条断言全绿：([^\n]+)/);
const terms = sumM ? [...sumM[2].matchAll(/([a-z][a-z-]*) (\d+)/g)].map(m => [m[1], +m[2]]) : [];
const di = terms.findIndex(([n]) => n === 'doctest');
ok(gateList.length >= 6 && !!sumM && terms.length === gateList.length &&
  terms.map(([n]) => n).join(',') === gateList.join(','),
  'D14a 文档那条合计列出的闸名 == verify.sh 的 GATES 名单（每条闸一项、顺序一致、不许漏）',
  `GATES ${gateList.join('/')} · 文档列了 ${terms.length} 项：${terms.map(([n]) => n).join('/')}`);
ok(!!sumM && terms.length > 0 && terms.reduce((a, [, b]) => a + b, 0) === +sumM[1],
  'D14b 文档写的合计 == 它自己列出的那几项加起来',
  sumM ? `${terms.map(([n, v]) => `${n} ${v}`).join(' + ')} = ${terms.reduce((a, [, b]) => a + b, 0)} vs 写了 ${sumM[1]}` : '解析不到那句合计');

// ---- D15 出题台阶那句「合计」：文档抄的是表里七个字段的和，不是探针的一次输出 ----
const pSum = README.match(/合计 (\d+) 档 · 造成 (\d+) · 唯一 (\d+) · 其中铅笔推满 (\d+) · 可供验谎 (\d+)/);
const sMade = Object.values(TIERS_MEASURED).reduce((a, m) => a + m.made, 0);
const sUniq = Object.values(TIERS_MEASURED).reduce((a, m) => a + m.uniq, 0);
const sSolved = Object.values(TIERS_MEASURED).reduce((a, m) => a + m.uniqSolved, 0);
ok(!!pSum && +pSum[1] === TIERS.length && +pSum[2] === sMade && +pSum[3] === sUniq &&
  +pSum[4] === sSolved && +pSum[5] === sMade - sUniq,
  'D15 台阶合计的五个数全部由 TIERS / TIERS_MEASURED 现算（造成−唯一就是 liar 的验谎样本）',
  pSum ? `文档 ${pSum.slice(1, 6).join('/')} vs 现算 ${[TIERS.length, sMade, sUniq, sSolved, sMade - sUniq].join('/')}` : '解析不到那句合计');
// 页面上"造成率掉到 X%"那句也在文档里复述了一遍：百分数必须由那一对数算出来，且这对数真是某一档的。
const pct = README.match(/造成 (\d+)\/(\d+) = (\d+)%/);
const pctTier = pct && Object.values(TIERS_MEASURED).find(m => m.made === +pct[1] && m.sample === +pct[2]);
ok(!!pct && Math.round((+pct[1] / +pct[2]) * 100) === +pct[3] && !!pctTier,
  'D15b 文档那句造成率的百分数 == 某一档的 made/sample（没有第二个出处）',
  pct ? `${pct[1]}/${pct[2]} = ${pct[3]}% · 对上的档：${pctTier ? TIERS.find(t => TIERS_MEASURED[t.id] === pctTier).id : '无'}` : '解析不到那句百分数');

// ---- D16 7×7 观测段：文档那串读数 == 探针贴回的夹具（墙钟不在里面） ----
const OBSF = JSON.parse(read('tools/fixtures/obs-7x7.json'));
const obsDoc = README.match(/观测 7×7 黑格(\d+) 区(\d+)（不在菜单）\/ (\d+) 次尝试：造成 (\d+) · 唯一 (\d+) · 铅笔推满 (\d+) · 首次出货 第 (\d+) 次 · 出口 ([^\n。]+)/);
ok(!!obsDoc && +obsDoc[1] === OBSF.nb && +obsDoc[2] === OBSF.nr && +obsDoc[3] === OBSF.obs &&
  +obsDoc[4] === OBSF.made && +obsDoc[5] === OBSF.uniq && +obsDoc[6] === OBSF.solved &&
  +obsDoc[7] === OBSF.firstAtt && obsDoc[8].trim() === OBSF.exits,
  'D16 文档的 7×7 观测读数 == tools/fixtures/obs-7x7.json（探针默认口径逐字段对过表）',
  obsDoc ? `文档 ${obsDoc.slice(4, 8).join('/')} · 出口 ${obsDoc[8].trim()} vs 夹具 ${OBSF.made}/${OBSF.uniq}/${OBSF.solved}/第${OBSF.firstAtt}次 · 出口 ${OBSF.exits}` : '解析不到那句观测读数');
// 那份夹具不是文档的私有副本：它得真是 generator-probe 写出来、并自己比过的那一份。
ok(/--bless-obs/.test(PROBE) && /fixtures\/obs-7x7\.json/.test(PROBE),
  'D16b 7×7 夹具由 generator-probe 自己产出并逐字段对表（不是手抄的第二份数）',
  `probe 里 bless 出口 ${/--bless-obs/.test(PROBE) ? '在' : '不在'}、读夹具 ${/fixtures\/obs-7x7\.json/.test(PROBE) ? '在' : '不在'}`);

// ---- D17 选档页那一行有几个数字：文档说的个数 == 腿里那条正则真的解析出几个 ----
const lineSrc = (SCEN.match(/const LINE = \/(.*)\/;/) || [])[1] || '';
const lineGroups = (lineSrc.match(/\(\\d\+\)/g) || []).length;
const numDoc = README.match(/打印的 (\d+) 个数字/);
ok(!!lineSrc && lineGroups >= 8 && !!numDoc && +numDoc[1] === lineGroups,
  'D17 文档说"打印的 N 个数字"== menu 腿那条 LINE 正则的捕获组数（腿改了口径文档必须跟着改）',
  `正则 ${lineGroups} 组 vs 文档 ${numDoc?.[1]}`);

// ---- D18 每一个「实测」都得指得出证人 ----
// 表行由 D1 逐格钉住，不在这里重复；剩下的散文里凡是写着"实测 + 一个数"的句子，
// 都得在同一句里给出复跑的东西（一条命令或一个文件），否则那句话就是"抄来的形容词"。
const bare = [];
for (const [name, src] of [['README.md', README], ['DESIGN.md', DESIGN]]) {
  for (const [i, line] of src.split('\n').entries()) {
    if (/^\s*\|/.test(line)) continue;
    if (!/实测/.test(line) || !/\d/.test(line)) continue;
    if (!/`(npm [^`]*|node [^`]*|tools\/[^`]*|js\/[^`]*|\.github\/[^`]*|package\.json[^`]*|index\.html[^`]*)/.test(line)) bare.push(`${name}:${i + 1}`);
  }
}
ok(bare.length === 0, 'D18 文档里每句带数字的「实测」都点名了复跑它的命令或文件',
  bare.length ? `没有证人：${bare.join('，')}` : '每一句都带着出处');

// ---- D19 闸的条数逐条对表：只在 verify.sh 的逻辑段里能比（manifest 由它自己写） ----
const MANIFEST = process.env.GATE_ROWS_FILE;
if (MANIFEST) {
  const m = {};
  for (const l of read(MANIFEST).split('\n').filter(Boolean)) { const [k, v] = l.split(/\s+/); m[k] = v; }
  const bad = [];
  for (const name of gateList) {
    if (name === 'doctest') continue;   // 本闸那一项由 D14c 自己钉（它跑的时候还没打印）
    if (!(name in m) || m[name] === 'NA') bad.push(`${name}（manifest 里没条数：那条闸没跑或红了）`);
    else {
      const doc = terms.find(([n]) => n === name)?.[1];
      if (doc !== +m[name]) bad.push(`${name} 文档 ${doc} vs 本轮 ${m[name]}`);
    }
  }
  ok(bad.length === 0, 'D19 文档列的每条闸的断言条数 == 那条闸本轮自己打印的条数',
    bad.length ? `对不上：${bad.join('，')}` : `manifest ${gateList.filter(n => n !== 'doctest').map(n => `${n}=${m[n]}`).join(' ')}`);
} else {
  // 这一行在两种入口下都必须占一个条数名。以前这里走 skip()（不进 rows），于是本闸单跑是 55 条、
  // 由 verify.sh 跑是 56 条——而 D14c 要文档抄住"本闸本轮实测条数"，那一个数永远只在一种入口下对，
  // 正是本文件开头说要消灭的"让文档去追一个会跳的数"。所以单跑时这里改成一条**真的**静态断言：
  // 证明 manifest 确实由 verify.sh 导出（数值对表在有 manifest 的那条路里跑）。
  ok(/^export GATE_ROWS_FILE=/m.test(VERIFY) && /GATE_ROWS="\$LOGD\/gate-rows\.txt"/.test(VERIFY),
    'D19 单跑口径：manifest 由 verify.sh 现写现导出（本轮没有 manifest，逐条数值对表在 npm test / CI 里跑）',
    '这一行不随调用入口漂：有 manifest 时对表五条闸的条数，没有时对表接线本身');
}

// ---- D20 新局的重置只落在"真接手了新盘"的那两处 ----
// 这一轮修的是一个把重置写在 begin() 开头的做法：那条函数有三条出口，其中"连着 5 号 seed 都没出货"
// 那条**不起新局**，屏幕上是上一局那块盘——把 paused / baseElapsed 抹成新局的样子，等于给旧盘解冻
// 并把表清零，赢下去记的是 ms≈0（正是这一轮要堵的那条洗时间的路）。浏览器腿够不着它：那条出口要一整窗
// 种子都不出货才走得到（每号种子的 shipOne 预算见 js/engine/tiers.js 的 ship 字段），而"这一窗会不会空"
// 没有确定答案——在这台机器上连试的几个窗口全都出货，等不来一个能钉进腿里的确定空窗。
// 所以这条承诺由结构闸守着，而不是由注释守着。
const BEGIN_AT = MAIN.search(/^function begin\(/m);
const BEGIN_BODY = BEGIN_AT < 0 ? '' : (MAIN.slice(BEGIN_AT).match(/^[\s\S]*?\n\}/m) || [''])[0];
const ADOPT_BODY = (MAIN.match(/^function adoptFreshBoard\(\)[\s\S]*?\n\}/m) || [''])[0];
const idxAll = (src, re) => src.split('\n').map((l, i) => (re.test(l) ? i : -1)).filter(i => i >= 0);
{
  const bad = [];
  const writes = [[/^\s*paused\s*=\s*false;/m, 'paused = false'], [/^\s*baseElapsed\s*=\s*0;/m, 'baseElapsed = 0'],
    [/winVeil\.hidden\s*=\s*true;/, 'winVeil.hidden = true'], [/setAttribute\('aria-pressed'/, '暂停按钮的 aria-pressed']];
  for (const [re, what] of writes) if (!re.test(ADOPT_BODY)) bad.push(`重置函数里没有${what}`);
  for (const [re, what] of writes) if (re.test(BEGIN_BODY)) bad.push(`begin() 里还留着裸写的${what}`);
  const g = idxAll(BEGIN_BODY, /game = new Game\(/);
  const a = idxAll(BEGIN_BODY, /^\s*adoptFreshBoard\(\);/);
  const s = idxAll(BEGIN_BODY, /^\s*startClock\(\);/);
  if (!(g.length === 2 && a.length === 2 && s.length === 2)) bad.push(`接手新盘的分支要有 2 处、重置 2 处、起表 2 处，实测 ${g.length}/${a.length}/${s.length}`);
  else for (let i = 0; i < 2; i++) {
    if (!(g[i] < a[i] && a[i] < s[i])) bad.push(`第 ${i + 1} 条分支的顺序不是「接盘 → 重置 → 起表」（${g[i]}/${a[i]}/${s[i]}）`);
  }
  const out = BEGIN_BODY.slice(BEGIN_BODY.indexOf('if (!puzzle) {'));
  const exit = out.slice(0, (out.indexOf('return null;') + 1) || out.length);
  if (!/if \(!puzzle\) \{/.test(BEGIN_BODY)) bad.push('读不到"没出货"那条出口');
  else if (/adoptFreshBoard\(\);|startClock\(\);|game = new Game\(/.test(exit)) bad.push('「没出货」那条出口里出现了重置或起表');
  ok(bad.length === 0, 'D20 新局重置只落在接手新盘的两条分支上，"没出货"那条出口不抹旧盘的表与冻',
    bad.length ? `越界：${bad.join('，')}` : `重置函数 4 项写手齐、begin() 内 0 处裸写、两条分支各按「接盘→重置→起表」排序、空仓出口干净`);
}

// ---- D14c 末项就是本闸本轮真打印的条数（这一条自己也算在内，所以放在最后一次 ok）----
const SELF = rows + 1;
ok(!!sumM && di >= 0 && terms[di][1] === SELF, 'D14c 文档抄的 doctest 条数等于本轮实测（含这一条）',
  sumM && di >= 0 ? `文档 ${terms[di][1]} vs 本轮 ${SELF}` : '解析不到');

// ---- 收尾：红要能点名是哪道闸（与 tools/kit.mjs 的 FAIL <tag> :: … 同一形状），----
// ---- 并且把自己这一轮的条数用同一行格式打印出来，verify.sh 的 manifest 就是从这行读的。 ----
console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`FAIL doctest :: ${f}`);
  console.log(`doctest: ${fail.length}/${rows} 条红`);
  process.exit(1);
}
console.log(`doctest: PASS（${rows} 条断言）`);
