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

## 验证：四条命令与它们本轮的读数

下面每一个数都是本仓本轮（2026-10-02）跑出来的，括号里是打印它的那行代码。
**散文不再靠人抄**：第六道逻辑闸 `tools/doctest.mjs`（`npm run doctest`）把这一节和 `DESIGN.md` 里的
每一个"现值"对回代码——档位表、端口、计数器预算、CI 门禁名单、`SAMPLE` 旋钮、每条闸本轮自己报出的
断言条数。正则解析不到东西同样算红（"0 行"不是绿灯，见 `tools/doctest.mjs:89` 的 `D1a`）。

```bash
npm run check        # → check OK（package.json:7 逐文件 node --check，含 server.cjs 与 tools）
npm test             # → logic: PASS（tools/verify.sh:57），rc=0
npm run verify       # → === ALL GREEN ===（tools/verify.sh:398），rc=0（退出码在 :399）
npm run selftest     # → rc=1，四条腿各点名吃下一条种下的错（tools/verify.sh:368-395）
```

- **逻辑闸 `npm test`**：六道，名单只有一份——`tools/verify.sh:31` 的 `GATES`，`doctest` 排在**最后**
  是刻意的：它读前面每条闸本轮自己打印的条数（`tools/verify.sh:44-48` 把每条闸的 stdout 落到
  `_tmp-verify-logic/<gate>.log` 并写进 `_tmp-verify-logic/gate-rows.txt`）。
  逻辑闸本轮合计 215 条断言全绿：rule-test 17 counter-test 26 pencil-test 24 golden-test 46 generator-probe 42 doctest 60
  那一句里的六个数逐个对表本轮 manifest（`tools/doctest.mjs` 的 `D19`），**不是手抄的**。
  `npm test` **不跑浏览器腿**，并且把这件事打印出来（`tools/verify.sh:60` 的 `browser: SKIP`），
  浏览器闸走 `npm run verify` / CI 的 `browser` job。
- **出题台阶 `npm run probe`**：口径 `ARM=greedy MAXMUT=40 cap=400000 maxSol=400`，每档 20 次尝试、
  `SEED=1`（`tools/generator-probe.mjs:24` 的默认值、`:31` 的口径行）。
  本轮合计 7 档 · 造成 111 · 唯一 52 · 其中铅笔推满 52 · 可供验谎 59（`tools/generator-probe.mjs:86`）。
  三条红线都在 `tools/generator-probe.mjs`：铅笔从不把没证成唯一的盘推满（`:73` liar=0）、
  铅笔的解与计数器的唯一解从不打架（`:77` 打架=0）、以及配对给 liar 红线的反空转断言——
  样本里必须真有没证成唯一的盘可验谎，`:75` 断言 造成−唯一 ≥ 3，本轮 111−52 = 59 张。
- **浏览器闸 `npm run verify`**：真 Chrome + CDP，读 DOM 文本/几何、真 `Input.dispatch*` 事件与引擎读数，
  不读内部标志位。端口：本地 5273 · CDP 9473（`tools/verify.sh:65-66`、`package.json:14`）——
  9473 而不是族内镜像位 9373：2026-09-30 实测（`tools/verify.sh:111-115` 的 lsof 取证）9373 上坐着
  兄弟车道 skyscraper 的一个长期 Chrome，attach 到别人的浏览器那种绿比红更糟，pre-flight 直接拒绝抢端口
  （`tools/verify.sh:194-197`）。
  闸的形状：腿 3 条 · 报告 4 份 · 形态 2 种 · 合计 8 份（`tools/verify.sh:74` 的 `LEGS`、
  `:78-85` 的 `reports_of`、`:123` 的 `SHAPES`；报告名单只有 `reports_of` 这一处，分母由它现算）。
  本轮逐报告条数：engine 26 / menu 45 / gen 69 / play 84，每形态 224 条 · 合计 448 条，逐形态完全相同
  （对表打印在 `tools/verify.sh:303`，落到 `_tmp-verify/counts.txt`）。
  本地根 `/`、本地 Pages 前缀形态 `/z-biz-game-dosun-cos/`，`BASE_URL=…` 再追加**已部署站点**
  （`tools/verify.sh:126` 把它并入同一个形态循环，形态数由 `${#SHAPES[@]}` 现取，不是写死的 2）：
  第三形态真跑：3 种形态 × 4 份报告 = 12 份读数（本轮 224/224/224，见 `DESIGN.md`）。
  "逐报告条数"这四个数不只自洽——`npm run verify` 跑完浏览器腿后拿本轮 `counts.txt` 再比一次
  （`tools/verify.sh:360` 调 `tools/doctest.mjs --counts`），少一份、多一份、两份不等量都红。
  CI 只跑前两种形态（`npm run verify` 不带 `BASE_URL`）——第三种要等部署完成才存在，只能在本地对线上跑。
  - `engine` 腿在页面台面里重放官方 4×4 例题，并断言页面拿到的是**引擎模块本身**
    （`tools/scenarios.js:57-59`）——胜负只由 `js/engine/rules.js` 的 R1/R2/R3 判，UI 没有第二套规则。
  - `menu` 腿把选档页每一档打印的 10 个数字逐个解析出来，与 `TIERS_MEASURED` 的字段逐个比相等
    （`tools/scenarios.js:91` 那条 `LINE` 正则、`:113` 与 `:119` 的断言）。
  - `gen` 腿逐档在浏览器里真出货，并把 node 与 Chrome 两侧算出的盘面指纹逐张对比——
    同一种子在两边必须长同一张盘。
  - `play` 腿用真指针事件下子，每次点击前先断言命中盒到得了那一格；填满整盘**不算赢**
    （判据 `errs ≠ 0` 就不给过关），只有官方答案被真点击摆出来才触发胜利。
- **闸必须能红**：`npm run selftest` 时 `scenarios.js` 与 `playtest.cjs` 各往每一条腿塞一条注定错的
  `1==2`，本轮四条腿（engine/menu/gen/play）各红一次、`rc=1`。CI 同时要求 `rc≠0` **和**日志里有 `FAIL`
  （`.github/workflows/ci.yml:62`、`:63`）：一条没点名的红不算红。
  另一侧，只红不点名到腿也不行（`tools/verify.sh:389-391`：planted 腿数少于名单长度就判失败）。

## CI 覆盖表：哪条命令在哪个 job 里被跑

这张表也是被断言的：`tools/doctest.mjs` 的 `D6` 把每一行拿回 `.github/workflows/ci.yml` 的对应 job 块里
找那个步骤名，找不到就红——文档不许声称某条闸在 CI 跑过而其实没跑。

| 命令 | job | CI 里的步骤名 | 守住什么 |
| --- | --- | --- | --- |
| `npm run check` | check | `Syntax check every source` | 每个源文件 parse 得过 |
| `npm test` | check | `Logic gates` | 六道逻辑闸（含文档对表） |
| `npm run verify` | browser | `Browser gate, both local URL shapes` | 两种 URL 形态 × 三条腿 |
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
（`js/main.js:29`、`js/main.js:245`）——少一个散文自带的第二个出处。

7×7 也测了，读数在仓里可复跑（`tools/generator-probe.mjs:122-145` 的观测段，默认 `OBS=6`），
并且**落在仓里的一份夹具上**（`tools/fixtures/obs-7x7.json`，由 `tools/generator-probe.mjs --bless-obs` 打印、
默认口径逐字段对表）：观测 7×7 黑格6 区8（不在菜单）/ 6 次尝试：造成 3 · 唯一 2 · 铅笔推满 2 · 首次出货 第 3 次 · 出口 出货=2 步数用完=1 造不出盘=3
观测段上照设 liar / 打架两条红线（`:144`、`:145`），但**出货率与推满率故意不设红线**——
哪天 7×7 推得满是进步，不该让闸变红。表里没有 7×7 那一行：不进菜单的两条理由写在 `js/engine/tiers.js:25-27`，
想上档要先做什么写在 `:29`。
