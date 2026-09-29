# どすんふわり · Dosun-Fuwari（零猜测气球与铁球）

浏览器原生的 **Dosun-Fuwari / どすんふわり**（Nikoli）：无构建步骤、无打包器、运行时不装任何包，
棋盘、粗线区界、气球与铁球都由 `<canvas>` 现画（`index.html:70`，`js/render/board.js`）。
玩法是粗线把格子分成若干区，**每个区恰好放一只气球和一只铁球**：气球（白圈）沿列往上浮，
铁球（黑圈）往下沉，题面涂黑的格子不属于任何一个区（`index.html:27-31`、`js/engine/rules.js:19-21`）。

"浮起来"是被判据钉住的，不是形容词：气球上面那一格必须是**气球**、**题面黑格**，或者它就是这一段
的最上面一格——**气球停在铁球下面不算浮起来**（`js/engine/rules.js:12`、`index.html:31`）。

每一局在出货前都被**只用命名规则**的铅笔求解器（N1/N1c/N2/N2c/N3/N4，`js/engine/pencil.js:8-15`）
从空盘推到底，再由不含任何推理逻辑的**穷尽计数器**（`js/engine/counter.js`）证明唯一解：
计数器一旦"没数完"（`bounded`）或与铅笔打架，这张盘直接退货（`js/engine/generate.js:152`）。
所以"零猜测"是准入门槛，不是文案。页面上写的每个数字都取自引擎导出的同一个字段
（`js/main.js:26-30`），底部那句话点名它的出处（`index.html:124`）。

规则来源、设计取舍、以及**哪些话没有被任何闸守住**，都在 `DESIGN.md`。

## 快速开始

```bash
npm run serve        # 零依赖静态服务 → http://127.0.0.1:5267/（package.json:13）
# 两种 URL 形态都 serve（本地开发与 Pages 子路径一致，server.cjs 自己就是这条承诺的实现）：
#   http://127.0.0.1:5267/
#   http://127.0.0.1:5267/z-biz-game-dosun-cos/
```

一格点下去循环 未定 → 气球 → 铁球 → 钉空 → 未定（`js/ui/game.js:21-23`）；另有 未定 / 撤销 /
重摆 / 换一局 四个按钮（`index.html:88-97`）。**换一局取的 seed 来自存档里的自增游标，绝不取墙钟**
（`js/main.js:4`）——页面上印着 "seed 7" 就必须能按 7 复现这一局。

## 验证：四条命令与它们本轮实测的输出

下面每一个数字都是本仓本轮（2026-09-29）跑出来的，括号里是打印它的那行代码。

```bash
npm run check        # → check OK（package.json:7 逐文件 node --check，含 server.cjs 与 tools）
npm test             # → logic: PASS，rc=0（tools/verify.sh:36、:41）
npm run verify       # → === ALL GREEN ===，rc=0（tools/verify.sh:289）
npm run selftest     # → rc=1，四条腿各点名吃下一条种下的错（tools/verify.sh:271-279）
```

- **逻辑闸 `npm test`**：五条，本轮 **154 条断言全绿** —— rule-test 17（`tools/rule-test.mjs`）、
  counter-test 26、pencil-test 24、golden-test 46（官方 4×4 夹具）、generator-probe 41。
  `npm test` **不跑浏览器腿**，并且把这件事打印出来（`tools/verify.sh:39` 的 `browser: SKIP`），
  浏览器闸走 `npm run verify` / CI 的 `browser` job。
- **出题台阶 `npm run probe`**：口径 `ARM=greedy MAXMUT=40 cap=400000 maxSol=400`，每档 20 次尝试、
  `SEED=1`。本轮合计 **7 档 · 造成 111 · 唯一 52 · 其中铅笔推满 52 · liar 0 · 打架 0**
  （`tools/generator-probe.mjs:85`）。两条红线都是"必须为 0"：铅笔从不把没证成唯一的盘推满
  （`tools/generator-probe.mjs:72`）、铅笔的解与计数器的唯一解从不打架（`:76`）；
  再加一条防空转的配对断言——样本里必须真有没证成唯一的盘可验谎，本轮 111−52 = **59 张**
  （`tools/generator-probe.mjs:74`）。
- **浏览器闸 `npm run verify`**：真 Chrome + CDP，读 DOM 文本/几何、真 `Input.dispatch*` 事件与引擎读数，
  不读内部标志位。本轮跑了**三种 URL 形态**，各 **193 条断言**、逐腿条数完全相同
  （engine 21 / menu 39 / gen 69 / play 64），对表打印见 `tools/verify.sh:261`：
  本地根 `/`、本地 Pages 前缀形态 `/z-biz-game-dosun-cos/`，以及 `BASE_URL=…` 追加进来的**已部署站点**
  （`tools/verify.sh:81` 把它并入同一个形态循环，形态数由 `${#SHAPES[@]}` 现取，不是写死的 2）。
  CI 只跑前两种（`npm run verify` 不带 `BASE_URL`）——第三种要等部署完成才存在，只能在本地对线上跑。
  - `engine` 腿在页面台面里重放官方 4×4 例题，并断言页面拿到的是**引擎模块本身**
    （`tools/scenarios.js:57-58`）——胜负只由 `js/engine/rules.js` 的 R1/R2/R3 判，UI 没有第二套规则。
  - `menu` 腿把选档页上打印的 8 个数字逐个解析出来，与 `TIERS_MEASURED` 的 8 个字段比相等
    （`tools/scenarios.js:77`、`tools/scenarios.js:98`）。
  - `gen` 腿逐档在浏览器里真出货，并把 node 与 Chrome 两侧算出的盘面指纹逐张对比——
    同一种子在两边必须长同一张盘。
  - `play` 腿用真指针事件下子，每次点击前先断言命中盒到得了那一格；填满整盘**不算赢**
    （判据 `errs ≠ 0` 就不给过关），只有官方答案被真点击摆出来才触发胜利。
- **闸必须能红**：`npm run selftest` 时 `scenarios.js` 与 `playtest.cjs` 各往每一条腿塞一条注定错的
  `1==2`，本轮四条腿（engine/menu/gen/play）各红一次、`rc=1`。CI 同时要求 `rc≠0` **和**日志里有 `FAIL`
  （`.github/workflows/ci.yml:63`、`.github/workflows/ci.yml:64`）：一条没点名的红不算红。
  另一侧，只红不点名到腿也不行（`tools/verify.sh:279`：planted 腿数 < 4 就判失败）。

## 七档菜单：印出来的数字与本轮实测的读数

菜单档位与标称读数都只有一份，写在 `js/engine/tiers.js:39`（`TIERS`）与 `:59`（`TIERS_MEASURED`）。
下表最后一列是本轮 `npm run probe` 的读数：

| 档 | 尺寸 | 题面黑格 | 区数 | 造成/20 | 证成唯一 | 其中铅笔推满 | 首次出货 | 计数器节点 med/p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 入门 s4 | 5×5 | 4 | 4 | 20 | 11 | 11/11 | 第 1 次 · 46 ms | 153 / 2145 |
| 轻松 s5 | 5×5 | 4 | 5 | 20 | 10 | 10/10 | 第 1 次 · 8 ms | 420 / 2580 |
| 标准 s6 | 5×5 | 4 | 6 | 17 | 7 | 7/7 | 第 2 次 · 57 ms | 264 / 386 |
| 进阶 s7 | 5×5 | 4 | 7 | 10 | 4 | 4/4 | 第 1 次 · 38 ms | 1584 / 2571 |
| 困难 h6 | 6×6 | 5 | 6 | 19 | 8 | 8/8 | 第 3 次 · 756 ms | 1093 / 6022 |
| 专家 h7 | 6×6 | 5 | 7 | 18 | 10 | 10/10 | 第 2 次 · 474 ms | 1463 / 11223 |
| 大师 h8 | 6×6 | 5 | 8 | 7 | 2 | 2/2 | 第 5 次 · 567 ms | 778 / 778 |

**哪些数字被闸守住、哪些没有**：`uniq` / `uniqSolved` / `stepMedP95` / `nodesMedP95` / `shipAttempt`
由贴回对表线逐档核对（`tools/generator-probe.mjs:101`）——手抄进 `TIERS_MEASURED` 的读数与本轮实测
不等就红。**耗时（`shipMs`、`msMedP95`）不进等式**，因为那是机器速度；它受的是护栏而不是等式：
每档"出货累计耗时在 N ms 内"（`TIERS.ship.ms` = 4000 / 12000 / 20000）。所以上表里的 46/8/57 ms
与表里贴的 44/8/54 ms 之差是同一把尺子上的机器抖动，不算回归，也不是闸读过的承诺。

菜单停在 6×6 区8，**出局理由印在页面上**（`index.html:42`）：本轮实测 6×6 区8 的造成率已经掉到
7/20 = 35%，而且 20 次尝试里只有 2 张盘被证成唯一——按一次"换一局"要平均刷 5 次以上才出货。
这是能玩性的下限，不是难度上限（`js/engine/tiers.js:11-19`）。

7×7 也实测了，读数在仓里可复跑（`tools/generator-probe.mjs:110-136` 的观测段，默认 `OBS=6`）：
本轮 `造成 3 · 唯一 2 · 铅笔推满 2 · 首次出货 第 3 次（累计 1402ms）· 出口 {"步数用完":1,"造不出盘":3,"出货":2}`，
观测段上照设 liar / 打架两条红线（`:135`、`:136`），但**出货率与推满率故意不设红线**——
哪天 7×7 推得满是进步，不该让闸变红。7×7 不进菜单的两条理由（样本薄、造成率非单调过渡）
写在 `js/engine/tiers.js:25-27`，想上档要先做什么写在 `:29`。
