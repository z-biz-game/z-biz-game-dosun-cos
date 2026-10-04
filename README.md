# どすんふわり · Dosun-Fuwari（零猜测气球与铁球）

浏览器原生的 **Dosun-Fuwari / どすんふわり**（Nikoli）：无构建步骤、无打包器、运行时不装任何包，
棋盘、粗线区界、气球与铁球都由 `<canvas>` 现画（`index.html:71`，`js/render/board.js`）。
玩法是粗线把格子分成若干区，**每个区恰好放一只气球和一只铁球**：气球（白圈）沿列往上浮，
铁球（黑圈）往下沉，题面涂黑的格子不属于任何一个区（`index.html:27-31`、`js/engine/rules.js:19-21`）。

"浮起来"是被判据钉住的，不是形容词：气球上面那一格必须是**气球**、**题面黑格**，或者它就是这一段
的最上面一格——**气球停在铁球下面不算浮起来**（`js/engine/rules.js:12`、`index.html:31`、`:99`）。

每一局在出货前都被**只用命名规则**的铅笔求解器从空盘推到底，再由不含任何推理逻辑的**穷尽计数器**
（`js/engine/counter.js`）证明唯一解：计数器一旦"没数完"（`bounded`）或与铅笔打架，这张盘直接退货
（`js/engine/generate.js:152`）。所以"零猜测"是准入门槛，不是文案。页面上写的每个数字都取自引擎导出的
同一个字段（`js/main.js:26-31`），底部那句话点名它的出处（`index.html:125`）。

命名规则一共 10 个标签：N1 浮 · N1c 浮(撞区) · N1 浮(倒推) · N2 沉 · N2c 沉(撞区) · N2 沉(倒推) · N3 配对(气球) · N3 配对(铁球) · N3 配对(已满) · N4 三态

这 10 个标签不是注释里的清单：每一个都由铅笔自己印出来（`js/engine/pencil.js:8-15` 是声明、
非注释行里各出现 ≥1 次），`tools/doctest.mjs` 的 D2 把文档点到的每个名字对回 `js/engine/pencil.js`。

规则来源、设计取舍、以及**哪些话没有被任何闸守住**，都在 `DESIGN.md`。

## 快速开始

```bash
npm run serve        # 零依赖静态服务 → http://127.0.0.1:5273/（package.json:14）
# 两种 URL 形态都 serve（本地开发与 Pages 子路径一致，server.cjs 自己就是这条承诺的实现）：
#   http://127.0.0.1:5273/
#   http://127.0.0.1:5273/z-biz-game-dosun-cos/
```

一格点下去循环 未定 → 气球 → 铁球 → 钉空 → 未定（`js/ui/game.js:21-23`）；另有 未定 / 撤销 /
重摆 / 换一局 四个按钮（`index.html:88-97`）。**换一局取的 seed 来自存档里的自增游标，绝不取墙钟**
（`js/main.js:4`）——页面上印着 "seed 7" 就必须能按 7 复现这一局。

**暂停（P 键或「暂停」按钮）冻住的是两样东西：表针，和盘面**。本仓的纪录只按 `ms` 一个数排
（`js/main.js:45`），只停表不停盘的暂停就成了免费的思考时间 —— 想多久都行，按「继续」再一路摆到赢，
用时照样顶掉旧纪录。所以暂停期间 摆子 / 撤销 / 选格 / 重摆 / 提示 这五条写手一律原样退回，
键盘那一路在 `keydown` 处整体挡（只放行 P，它就是用来解冻的那一只，`js/main.js:389`），
每一刀都挡在状态行里说明原因（`js/main.js:146`），而不是把控件弄灰。
重摆不换题（黑格与区界一个字不动），所以也不换表。
换一局要是这一档连着几号种子都没出货，屏幕上留着的还是上一局那块盘：那种时候不接手新局，也就不会顺手
抹掉它的表和它的冻（新局重置只落在真接手新盘的那两处，`js/main.js:233`）。

## 验证：四条命令与它们本轮的读数

下面每一个数都是本仓本轮（2026-10-04）跑出来的，括号里是打印它的那行代码。
**散文不再靠人抄**：压轴那道逻辑闸 `tools/doctest.mjs`（`npm run doctest`）把这一节和 `DESIGN.md` 里的
每一个"现值"对回代码——档位表、端口、计数器预算、CI 门禁名单、`SAMPLE` 旋钮、每条闸本轮自己报出的
断言条数。正则解析不到东西同样算红（"0 行"不是绿灯，见 `tools/doctest.mjs:100` 的 `D1a`）。它自己也被这条规矩量着——
覆盖表多一行，它就多一条断言，那一个数由本轮现算（`D14c`）。
**它报全绿只说明这一轮没有东西坏，没说这把闸会不会红**：`tools/sabotage.mjs`（`npm run sabotage`）把每一类谎
各写回一份临时副本再跑一次 doctest，断言它必须点名变红——刀谱写在下面最后一节那张台账表里，任何人 clone 下来都能复跑。

```bash
npm run check        # → check OK（package.json:7 逐文件 node --check，含 server.cjs 与 tools）
npm test             # → logic: PASS（tools/verify.sh:57）+ 部署集双闸（tools/verify.sh:64-66），rc=0
npm run verify       # → === ALL GREEN ===（tools/verify.sh:415），rc=0（退出码在 :416）
npm run selftest     # → rc=1，五份报告各点名吃下一条种下的错（tools/verify.sh:383-410）
```

- **逻辑闸 `npm test`**：七道，名单只有一份——`tools/verify.sh:31` 的 `GATES`，`doctest` 排在**最后**
  是刻意的：它读前面每条闸本轮自己打印的条数（`tools/verify.sh:44-48` 把每条闸的 stdout 落到
  `_tmp-verify-logic/<gate>.log` 并写进 `_tmp-verify-logic/gate-rows.txt`）。
  逻辑闸本轮合计 236 条断言全绿：rule-test 17 counter-test 26 pencil-test 24 golden-test 46 generator-probe 42 sabotage 19 doctest 62
  那一句里的七个数逐个对表本轮 manifest（`tools/doctest.mjs` 的 `D19`；doctest 自己那一个由 `D14c` 对），**不是手抄的**。
  `npm test` **不跑浏览器腿**，并且把这件事打印出来（`tools/verify.sh:69` 的 `browser: SKIP`），
  浏览器闸走 `npm run verify` / CI 的 `browser` job。
- **产物闸（部署集）两条出口都跑**：`node tools/deploy-set.mjs` 加它自己的台架（`tools/verify.sh:64-66`）。
  它查 assemble 出来的清单/`sw.js`/图标与页面实际要取的那些 URL 同源，不碰 Chrome、不读页面。
  这两步原先只坐在 ci.yml 里，而本仓的 `npm test` 就是 `bash tools/verify.sh`（`package.json:15`），
  它在 `tools/verify.sh:68` 那条 `BROWSER` 早退里 `exit $rc` 就走完了——块挂在文件尾巴时
  默认整闸一次都碰不到它，"只有 CI 查"这个洞只是换了个位置。所以现在块排在早退**之前**、
  红并进 `rc`，浏览器那一路再由 `FAILED=$rc`（`tools/verify.sh:189`）把它带到结论横幅
  （`tools/verify.sh:415`）与 `exit $FAILED`（`tools/verify.sh:416`）之前——横幅在后面，
  它的红先把 `=== ALL GREEN ===` 压成 `=== FAILURES ABOVE ===`，不会被盖住。
- **出题台阶 `npm run probe`**：口径 `ARM=greedy MAXMUT=40 cap=400000 maxSol=400`，每档 20 次尝试、
  `SEED=1`（`tools/generator-probe.mjs:24` 的默认值、`:31` 的口径行）。
  本轮合计 7 档 · 造成 111 · 唯一 52 · 其中铅笔推满 52 · 可供验谎 59（`tools/generator-probe.mjs:86`）。
  三条红线都在 `tools/generator-probe.mjs`：铅笔从不把没证成唯一的盘推满（`:73` liar=0）、
  铅笔的解与计数器的唯一解从不打架（`:77` 打架=0）、以及配对给 liar 红线的反空转断言——
  样本里必须真有没证成唯一的盘可验谎，`:75` 断言 造成−唯一 ≥ 3，本轮 111−52 = 59 张。
- **浏览器闸 `npm run verify`**：真 Chrome + CDP，读 DOM 文本/几何、真 `Input.dispatch*` 事件与引擎读数，
  不读内部标志位。端口：本地 5273 · CDP 9473（`tools/verify.sh:75-76`、`package.json:14`）——
  9473 而不是族内镜像位 9373：2026-09-30 实测（`tools/verify.sh:121-125` 的 lsof 取证）9373 上坐着
  兄弟车道 skyscraper 的一个长期 Chrome，attach 到别人的浏览器那种绿比红更糟，pre-flight 直接拒绝抢端口
  （`tools/verify.sh:204-207`）。
  闸的形状：腿 4 条 · 报告 5 份 · 形态 2 种 · 合计 10 份（`tools/verify.sh:84` 的 `LEGS`、
  `:88-96` 的 `reports_of`、`:134` 的 `SHAPES`；报告名单只有 `reports_of` 这一处，分母由它现算，
  连 `tools/doctest.mjs` 里那一份也是从这两行**现读**出来的——腿加了、文档没改，它就红）。
  本轮逐报告条数：engine 26 / menu 45 / gen 69 / play 84 / pause 73，每形态 297 条 · 合计 594 条，逐形态完全相同
  （对表打印在 `tools/verify.sh:318`，落到 `_tmp-verify/counts.txt`）。
  本地根 `/`、本地 Pages 前缀形态 `/z-biz-game-dosun-cos/`，`BASE_URL=…` 再追加**已部署站点**
  （`tools/verify.sh:137` 把它并入同一个形态循环，形态数由 `${#SHAPES[@]}` 现取，不是写死的 2）：
  第三形态真跑：3 种形态 × 5 份报告 = 15 份读数（本轮这一笔先在本地两种形态上跑，297/297；
  等它部署到 Pages 之后再对线上复跑第三形态，见 `DESIGN.md`）。
  "逐报告条数"这五个数不只自洽——`npm run verify` 跑完浏览器腿后拿本轮 `counts.txt` 再比一次
  （`tools/verify.sh:375` 调 `tools/doctest.mjs --counts`），少一份、多一份、两份不等量都红。
  CI 只跑前两种形态（`npm run verify` 不带 `BASE_URL`）——第三种要等部署完成才存在，只能在本地对线上跑。
  - `engine` 腿在页面台面里重放官方 4×4 例题，并断言页面拿到的是**引擎模块本身**
    （`tools/scenarios.js:57-59`）——胜负只由 `js/engine/rules.js` 的 R1/R2/R3 判，UI 没有第二套规则。
  - `menu` 腿把选档页每一档打印的 10 个数字逐个解析出来，与 `TIERS_MEASURED` 的字段逐个比相等
    （`tools/scenarios.js:91` 那条 `LINE` 正则、`:113` 与 `:119` 的断言）。
  - `gen` 腿逐档在浏览器里真出货，并把 node 与 Chrome 两侧算出的盘面指纹逐张对比——
    同一种子在两边必须长同一张盘。
  - `play` 腿用真指针事件下子，每次点击前先断言命中盒到得了那一格；填满整盘**不算赢**
    （判据 `errs ≠ 0` 就不给过关），只有官方答案被真点击摆出来才触发胜利。
  - `pause` 腿量的就是"暂停冻住两样东西"这句话：先正对照证表在走（两次读数差 ≥150ms、
    ticker 那句 mm:ss 在 2.2 秒里一定变），再按真指针进暂停，跑一条 **19 刀的电池**
    （5 真点击 + 9 真按键 + 5 台面 API，含 1.2 秒真的睡着的"思考时间"），要求逐格指纹 / 步数 /
    光标 / 违反条数 / 题面一个字不动、`elapsedMs` 恒等（这两个读数由腿自己印在 `EVID` 行的
    `wall=` / `batteryMs=` 上，跑一次印一次，散文不抄它）、挡回的刀数等于台账数；
    再按「继续」，同一格这回落得下去（对照组），且恢复的第一帧不补账
    （`jump<500ms`，没有 dt 尖峰）。名册 11 只控件逐个先量命中盒再点。
- **闸必须能红**：`npm run selftest` 时 `scenarios.js` 与 `playtest.cjs` 各往每一条腿塞一条注定错的
  `1==2`，本轮五份报告（engine/menu/gen/play/pause）各红一次、`rc=1`。CI 同时要求 `rc≠0` **和**日志里有 `FAIL`
  （`.github/workflows/ci.yml:68`、`:69`）：一条没点名的红不算红。
  另一侧，只红不点名到腿也不行（`tools/verify.sh:404-406`：planted 腿数少于名单长度就判失败）。

## CI 覆盖表：哪条命令在哪个 job 里被跑

这张表也是被断言的：`tools/doctest.mjs` 的 `D6` 把每一行拿回 `.github/workflows/ci.yml` 的对应 job 块里
找那个步骤名，找不到就红——文档不许声称某条闸在 CI 跑过而其实没跑。

| 命令 | job | CI 里的步骤名 | 守住什么 |
| --- | --- | --- | --- |
| `npm run check` | check | `Syntax check every source` | 每个源文件 parse 得过 |
| `npm test` | check | `Logic gates` | 七道逻辑闸（含文档对表与破坏试验台账） |
| `npm run sabotage` | check | `Sabotage ledger proves doctest can go red` | 台账每一把刀都必须把 doctest 弄红 |
| `npm run verify` | browser | `Browser gate, both local URL shapes` | 两种 URL 形态 × 四条腿 |
| `npm run selftest` | browser | `Gate proves it can fail` | 闸必须能红，且 rc≠0 与 FAIL 同时成立 |

## 七档菜单：印出来的数字与本轮的读数

菜单档位与标称读数都只有一份，写在 `js/engine/tiers.js:39`（`TIERS`）与 `:60`（`TIERS_MEASURED`）。
下表就是这两份现值的转印（`tools/doctest.mjs` 的 `D1` 逐格比，行数和列都不许漂）：

| 档 | 尺寸 | 题面黑格 | 区数 | 尝试上限 | 造成 | 证成唯一 | 其中铅笔推满 | 首次出货 | 计数器节点 med/p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 入门 s4 | 5×5 | 4 | 4 | 12 | 20 | 11 | 11 | 第 1 次 · 44 ms | 153 / 2145 |
| 轻松 s5 | 5×5 | 4 | 5 | 12 | 20 | 10 | 10 | 第 1 次 · 8 ms | 420 / 2580 |
| 标准 s6 | 5×5 | 4 | 6 | 12 | 17 | 7 | 7 | 第 2 次 · 54 ms | 264 / 386 |
| 进阶 s7 | 5×5 | 4 | 7 | 12 | 10 | 4 | 4 | 第 1 次 · 34 ms | 1584 / 2571 |
| 困难 h6 | 6×6 | 5 | 6 | 24 | 19 | 8 | 8 | 第 3 次 · 645 ms | 1093 / 6022 |
| 专家 h7 | 6×6 | 5 | 7 | 24 | 18 | 10 | 10 | 第 2 次 · 443 ms | 1463 / 11223 |
| 大师 h8 | 6×6 | 5 | 8 | 30 | 7 | 2 | 2 | 第 5 次 · 543 ms | 778 / 778 |

**哪些数字被闸守住、哪些没有**：`made` / `uniq` / `uniqSolved` / `nodesMedP95` / `shipAttempt`
由贴回对表线逐档核对（`tools/generator-probe.mjs:104`）——手抄进 `TIERS_MEASURED` 的读数与本轮实测
不等就红。**首次出货那一列里的 ms 是墙钟观测值，它不进等式**（`shipMs`、`msMedP95` 同），因为那是机器
速度；它受的是护栏而不是等式：每档"出货累计耗时在 N ms 内"（`TIERS.ship.ms` = 4000 / 12000 / 20000，
`js/engine/tiers.js:40-46`）。所以那一列的 ms 与别的机器上跑出来的数字之差是同一把尺子上的抖动，
不算回归，也不是闸读过的承诺。

计数器在每一档都远没花完预算就数完了：节点预算 400000（`js/engine/tiers.js:37` 的 `DIG.cap`），本轮最大观测 11223 —— 余量八成以上，
所以"穷尽"这两个字在表里每一档都成立（`D5` 断言读数 < 预算，且那个"最大观测"必须等于表里最大的节点 p95）。

菜单停在 6×6 区8，**出局理由印在页面上**（`index.html:40-43`）：本轮造成 7/20 = 35%，而且 20 次尝试里
只有 2 张盘被证成唯一——按一次"换一局"要平均刷 5 次以上才出货。这是能玩性的下限，不是难度上限
（`js/engine/tiers.js:24-28`）。页面上那句话现在不写百分数，它指向各档自己那一行的读数
（`js/main.js:30`、`js/main.js:332`）——少一个散文自带的第二个出处。

7×7 也测了，读数在仓里可复跑（`tools/generator-probe.mjs:122-145` 的观测段，默认 `OBS=6`），
并且**落在仓里的一份夹具上**（`tools/fixtures/obs-7x7.json`，由 `tools/generator-probe.mjs --bless-obs` 打印、
默认口径逐字段对表）：观测 7×7 黑格6 区8（不在菜单）/ 6 次尝试：造成 3 · 唯一 2 · 铅笔推满 2 · 首次出货 第 3 次 · 出口 出货=2 步数用完=1 造不出盘=3
观测段上照设 liar / 打架两条红线（`:144`、`:145`），但**出货率与推满率故意不设红线**——
哪天 7×7 推得满是进步，不该让闸变红。表里没有 7×7 那一行：不进菜单的两条理由写在 `js/engine/tiers.js:25-27`，
想上档要先做什么写在 `:29`。

## 破坏试验台账：doctest 不是空转

`tools/doctest.mjs` 报全绿，说明的是**这一轮没有东西坏**，没说**这把闸会不会红**。
`tools/sabotage.mjs`（`npm run sabotage`，也在 `npm test` 的 `GATES` 名单里、`doctest` 之前一条）补的就是这一句：
把每一类谎各写回一份临时副本、重跑 doctest，断言它**必须**点名变红；任何一把刀没把闸弄红，整条台账判红并点名是哪一把。
下面这张表就是刀谱——`tools/sabotage.mjs` 从这些 `| K… |` 行里读刀（文档改了，跑的就是改后的那一版），
每行末尾那一个 rc 是脚本读回来的退出码，不是抄的。

- **刀只打在临时副本里**：仓中的真文件一个字节都不改，也不 `git stash` / `git checkout` / `git restore`
  （共享工作区，别的车道在同一个 workspace 里跑）；跑完逐文件对 sha256、把副本删净——这两件事本身就是台账的断言。
- **针必须唯一命中**：命中 0 次或多于 1 次直接 ERROR 停下。台账那一行自己会把针抄一遍，所以数命中的时候
  把 `| K… |` 那些行摘掉再数——"打不中却一声不响跑完"是台账最坏的失败。
- **退码要等于表里写的那一个，红行只能落在它自己那一族**（`D1` / `D4` / `D5` / `D14` 这一族前缀）：
  把别的东西也弄红了说明副本没建全，那种红不算命中；语法炸了、超时也是 rc 非 0，但那不是闸红。
- **落第一把刀之前先不带刀整跑一遍**：副本里的 doctest 必须全绿，且与仓里的数出同一个条数——
  红了才是刀弄的，不是台架自己坏的。
- **这把闸自己也挨过一次反证**：`SABOTAGE_TWIST=K3.expect=D5a node tools/sabotage.mjs` 把一把刀期望点名的
  断言改错，台账必须判红（它要是还报绿，才是台账在骗人）。

| 刀 | 打在哪一类谎 | 文件 | 针 | 改成 | 期望点名的 FAIL 行 | 跑什么 | rc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K1 | 文档把表里那一格抄漂一位 | `README.md` | `1463 / 11223` | `1463 / 11224` | `D1 h7` | `node tools/doctest.mjs` | 1 |
| K2 | 文档把端口那句删掉 | `README.md` | `端口：本地 5273` | `端口写在别处` | `D4` | `node tools/doctest.mjs` | 1 |
| K3 | 代码侧的现值动一格（计数器预算） | `js/engine/tiers.js` | `cap: 400000` | `cap: 400001` | `D5 文档写的预算` | `node tools/doctest.mjs` | 1 |
| K4 | 闸的名单被改（`GATES` 里换一个名） | `tools/verify.sh` | `generator-probe` | `probe-renamed` | `D14a` | `node tools/doctest.mjs` | 1 |
| K5 | 文档里那条 `path:NN` 指到了空行（行号漂走） | `README.md` | `tools/verify.sh:57` | `tools/verify.sh:417` | `D9 每一条` | `node tools/doctest.mjs` | 1 |
| K6 | 形状那句的腿数被抄少一条 | `README.md` | `闸的形状：腿 4 条` | `闸的形状：腿 3 条` | `D3 文档写的腿数` | `node tools/doctest.mjs` | 1 |
| K7 | 有人把新局重置裸写回 `begin()` 里 | `js/main.js` | `  const spec = tierFor(tier);` | `  paused = false; const spec = tierFor(tier);` | `D20 新局重置只落在` | `node tools/doctest.mjs` | 1 |

K1、K2 是上一轮那条车道在 scratch 里做过、但没留在树上的两次试验（当时改的是同一个数字、同一句话）；
K3、K4 打在代码侧与接线侧的现值上；K5、K6、K7 打在**本轮真的发生过**的三类坏上——
`js/main.js` 被加过之后，README/DESIGN 里有一批 `path:NN` 集体往后漂了一格，而"越界才算红"的
老 `D9` 一声不响（现在它还会把指到空行、整行只剩块闭合符的引用判红，K5 打的就是这一条）；
加一条 `pause` 腿时 `D3` 先红后绿，K6 就是那一类"形状那几个数被抄少一条"；
把新局重置往 `begin()` 头上一贴（第一版就是这么写的，它顺带把"没出货"那条出口的旧盘也解冻清零），
K7 打的就是这一类裸写回来的重置。七把刀各点一族，`tools/sabotage.mjs` 逐条打印它命中的 FAIL 行原文。

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高。
- **钉住两个数**：`EXPECT_CHECKS=29`（R 段实际检查的路径条数）与 `EXPECT_ROWS=47`
  （这一次跑的断言条数）。没改页面却掉了，说明解析断了；删掉一张图标会同时少一条 R10 与那张的
  P1/P2，所以两个数一起钉，rows 能漂就是闸在缩水的信号。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸），要求每一刀都让闸**点名**变红；X10 是阴性对照——往入口 JS 追加一行只写在注释里
的假路径，闸必须仍然绿、条数仍然 `29`、rows 仍然 `47`。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑，所以页面改了、仓与仓不同，台架跟着走。

`npm run deploy-set` 与 `npm run deploy-set:selftest` 是同两条命令的本地入口；这两步也已经接进本仓
那条整闸（`tools/verify.sh:64-66`，接法与为什么要接在 `BROWSER` 早退之前见 §门禁清单 那条产物闸）。
