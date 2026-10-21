# どすんふわり Dosun-Fuwari - 交付报告

## 0. 基线 → 本次提交

| | |
|---|---|
| 仓 | `z-biz-game-dosun-cos`（本仓自己的名字是「どすんふわり Dosun-Fuwari」，见 `index.html:7`） |
| 基线 | `9b99980`（"Merge branch 'main' of github.com:z-biz-game/z-biz-game-dosun-cos"） |
| 修复提交 | `ec70663`（"fix(dosun): 修好整局打不开的并线破坏 —— 重复声明、丢掉的 el 键、重复 id 与重复接线"）<br>`d72c589`（"fix(dosun): 补回并线丢掉的 Store.data 出口（原样存档视图）"） |
| 交付物提交 | 本文件所在的那一次提交 |
| 基线状态 | **整局不可玩**：`js/main.js` 是 SyntaxError，ES module 根本不加载 ⇒ 页面一片空白；node 侧 doctest 2/68 红、deploy-set 2 项红、sabotage 8/19 红；浏览器腿连页面都开不出来 |
| 修完状态 | 语法门 `check OK`；node 侧 17 + 26 + 24 + 46 + 42 + 19 + 68 = **242 条断言 0 失败**；浏览器闸 root 与 prefix 两种形态各 5 份报告、每形态 297 条、合计 594 条 **0 失败**；部署集 32 条引用 / 51 行 0 失败；部署集自检 `rc=0`；整闸 `=== ALL GREEN ===`（`VERIFY_RC=0`） |

### 整局不可玩的根因

V8 先报撞名，所以下面的第 2、3 条要等第 1 条被拿掉才露出来。

1. **`js/main.js` 里有两份 `function setPaused`（113 行与 274 行）。**
   一份带 `sim.setPaused` + 暂停卡片 + 读数刷新，一份只停表 + 改按钮。
   两份同名顶层函数声明 ⇒ `SyntaxError: Identifier 'setPaused' has already been declared`
   ⇒ 模块不加载 ⇒ 整局打不开（基线取证见第 6 节）。

2. **`el` 映射被并线截断，缺 9 个键。**
   页面上的 id 都还在，JS 侧照用不误，于是「表里没有」直接变成 `undefined.xxx` 的 TypeError，
   模块一加载就死：漏掉的是 `pauseVeil / full / helpVeil / help / helpFacts / resume / hint /
   pauseResume / helpClose`（基线 el 表 22 条 → 修完 31 条）。

3. **导出面与接线各坏一处。**
   `el.full` 在基线上根本没有被定义，而 `init` 末尾调 `syncFullscreen()` ⇒ 又是 TypeError；
   另有两份 `toggleFullscreen`（134 行无参版 / 667 行带 root 版），后定义者胜 ⇒
   `el.full.addEventListener('click', toggleFullscreen)` 把 MouseEvent 当 root 传进去，
   全屏按了没反应。

> 判据不是时间戳，是「哪一侧是完整产品」+「本仓的闸怎么写」。
> 远端侧（`9b99980^2`，`e2a61f3`）语法通过、暂停只有一套、全屏只有一套、**没有** `js/save.js`
> 与 `js/ui/game.js`；本地侧（`9b99980^1`，`4dc283d`）是上一次有机并线的产物，能力强
> （两段式存档解码、暂停卡片、续局、教学页）但带着上面三条。于是**冲突处以闸为准**
> （`tools/playtest.cjs` 钉着名册 11 只控件、暂停的 19 刀电池、全屏的进出场、坏档那一族），
> **不冲突的增量留着**（`js/save.js` 的两段式解码、暂停卡片、续局、教学页、触屏回落）。

## 1. 改动表：旧代码错在哪 → 新代码为什么对

| # | 旧代码错在哪 | 新代码为什么对 |
|---|---|---|
| 1 | 两份 `function setPaused` 并存 ⇒ ES module 顶层同名声明直接 SyntaxError ⇒ 整局打不开 | 合成一份（`js/main.js:278`），能力取两边并集：停表（`stopClock` 落账 + ticker 停）+ 冻仿真（`sim.setPaused`）+ 按钮三处改口（文案/`aria-pressed`/`title`）+ 暂停卡片显隐 + 读数刷新 |
| 2 | `el` 表被截断，缺 9 个键 ⇒ 模块一加载就 `undefined.xxx` TypeError | 补齐 9 条（`js/main.js:26-32`），并把「表必须与 index.html 一一对应」写在注释里 |
| 3 | `el.help` 指向的 `#btn-help` 在 `index.html` 里**根本不存在** ⇒ 教学页没有开页入口，玩法说明不可达 | 顶栏补一颗 `#btn-help`（`index.html:25`），接到 `showHelp` |
| 4 | `#btn-pause` 在顶栏与牌桌 `.acts` **各有一颗**（重复 id）⇒ `getElementById` 只认先出现的那颗，另一颗成死按钮；闸还数「页面上有几只写着暂停/继续的按钮」 | 牌桌那颗删掉，只留顶栏（`index.html:27`）。牌桌那排换成「提示 / 撤销 / 换一局 / 重摆 / 回选档」 |
| 5 | 暂停键被绑两次（`setPaused(!sim.paused)` + `togglePause`）⇒ 一次点击切两次，净效果是「按了没反应」 | 只留一条（`js/main.js:564`） |
| 6 | 两份 `toggleFullscreen`：134 行无参版、667 行带 root 版。后者胜 ⇒ click 事件被当成 root 传进去，全屏按了没反应；且 `init` 的 `syncFullscreen()` 因 `el.full` 未定义直接 TypeError | 删掉第一套（`fullscreenActive` / `syncFullscreen` / 无参 `toggleFullscreen` 及其两个 listener），只留文件末尾那份 `bindFullscreen`（特性探测三套 API + `fullscreenchange` 回写 + F 键 + 不支持时禁用并说明原因） |
| 7 | 教学页与暂停卡片在 CSS 里**没有任何样式**（两侧都没有 `#pause-veil` / `.veil-card` / `.kbd`）⇒ 两张卡片是没样式的裸块 | 补齐（`css/game.css:87-110`）。教学页是整页对话框；**暂停卡片贴在盘下面、不遮盘**——闸要求暂停中真点击仍要逐刀计数，盖住盘面就分不清「挡住」和「坏了」 |
| 8 | 玩法说明里写着 `R` 换一局 / `M` 静音 / `?` 玩法说明 / `Esc` 关闭，代码里**一颗都没有** ⇒ 那张卡片是一张反着的说明书 | 键链补齐（`js/main.js:607-609`）：`R` 换一局、`M` 静音（与按钮共用同一个 `toggleSound`）、`?` 开合说明、`Esc` 关说明（排在暂停总闸之前——模态对话框关不掉就成了一扇锁着的门） |
| 9 | 选档页按方向键 / `W`/`B`/`X` / `Z` 时 `game` 还是 null ⇒ 读 `game.cursor` 直接 TypeError，控制台一条红、页面「按了没反应」 | 局外一律不收玩法键（`js/main.js:583` 的 `inGame` 判定）；菜单里 `Enter`/空格是「开局」（原生 button 有焦点时让它自己派发 click，没有焦点就开默认档） |
| 10 | service worker 注册了两份：`js/pwa-register.js`（index.html 挂）+ `js/sw-register.js`（也挂）⇒ 同一个 SW 注册两次 | 删掉 `js/sw-register.js` 与它的 script 标签，只由 `js/pwa-register.js` 注册（它认 `file://`、scope 跟着 Pages 前缀走） |
| 11 | 存档读回没有 `Store.data` 这个出口 ⇒ 浏览器腿的坏档那一族读到 `undefined`（`JSON.stringify` 得 `undefined`，断言拿到 `",,"` 而不是 `"{},{},{}"`），`play` 腿两种形态各红一次 | 补回 `get data()`（`js/save.js:127`），是**原样存档**（回答「存档里此刻放着什么」）；`cursor`/`best`/`game` 仍走解码视图（回答「哪些记录还能用」）。闸一个字节没改 |
| 12 | 文档里的行号钉漂了 21 处（`doctest` 只抓到 2 条红，其余是它抓不到的静默漂）；其中 `r.ms < prev.ms` 实际在 `js/save.js` 而不是 `js/main.js` | 逐条重钉到当前代码上（详见第 3 节）。指认要指到真的那一行，不能硬凑行号 |
| 13 | `DESIGN.md` 的「不承诺」四条已被并线改写的现况说反了：提示「页面上没有按钮接它」（实际有 `#btn-hint` 且已接）、音效「没有音频模块」（实际有 `js/audio.js`，真 `suspend`/`resume`）、触屏「只有 pointerdown 一条真事件路」（实际有 `touchstart`/`mousedown` 回落）、续局「Store 只存 seed 游标与各档最佳时间」（实际还存进行中的一局） | 按现况重写四条（`DESIGN.md:258-272`）：该说的说，不该说的仍然不说（闸没量的那一半照旧不承诺） |
| 14 | 部署集闸钉的实数（29 条引用 / 48 行断言）早就是旧的：基线上实数已是 35 / 54 ⇒ **那道闸在基线上就是红的** | 随这次改动把实数更新为 32 / 51（`tools/deploy-set.mjs:35`、`tools/deploy-set.mjs:39`）：删掉重复的 `sw-register.js` 正好少三条引用（`index.html→sw-register.js`、`sw-register.js→'./'`、`sw-register.js→'sw.js'`）。并在闸里写明「钉的是实数，强度不变」 |
| 15 | `DESIGN.md` 的闸地图里 doctest 写「62 断言」，实测是 68 | 改成 68（`DESIGN.md:233`） |

## 2. 真实文件清单

| 文件 | 改了什么 | 增 / 删 |
|---|---|---|
| `js/main.js` | 整仓不可玩的三条根因 + 重复接线各收一份 + el 表补 9 条 + 键链补 R/M/?/Esc + 菜单期不再崩 | +92 / −60 |
| `js/save.js` | 补回 `Store.data` 出口（原样存档视图） | +12 / −0 |
| `index.html` | 补 `#btn-help`、删重复的 `#btn-pause`、删重复的 sw-register 标签、暂停卡按钮改口 | +3 / −3 |
| `css/game.css` | 补 `#help-veil` / `#pause-veil` / `.veil-card` / `.kbd` 两张卡片的样式 | +25 / −0 |
| `js/sw-register.js` | **整份删除**（重复的 service worker 注册） | −12 |
| `tools/deploy-set.mjs` | 钉的实数 29 / 48 → 32 / 51，附「钉的是实数，强度不变」的说明 | +7 / −2 |
| `README.md` | 21 处行号钉重钉 + 部署集两个实数（29/48 → 32/51） | +13 / −13 |
| `DESIGN.md` | 9 处行号钉重钉 + 「不承诺」四条按现况重写 + doctest 条数 62 → 68 | +22 / −20 |
| `deliverable.md` | 本文件（新建） | — |

合计 `8 files changed, 174 insertions(+), 110 deletions(-)`。

### 删行审计（没有删功能）

- **整份删除的只有 1 个文件**：`js/sw-register.js`（12 行）。它与 `js/pwa-register.js` 做的是同一件事
  （注册同一个 `sw.js`），后者更完整（认 `file://`、scope 跟着 Pages 前缀走、失败不抛）。删的是重复项，不是功能。
- `js/main.js` 删掉的 60 行里，**没有一行是功能**：
  - 27 行是第一套 `setPaused` + `fullscreenActive` + `syncFullscreen` + 无参 `toggleFullscreen`（重复实现，另一份仍在）；
  - 12 行是 `el.full.addEventListener('click', toggleFullscreen)` 这条**错**的接线（把 MouseEvent 当 root）；
  - 4 行是重复的暂停 click 绑定；
  - 2 行是 `init` 末尾那句会抛 TypeError 的 `syncFullscreen()`；
  - 其余是并排的注释。
- 删掉的 3 行 `index.html`：重复的 `#btn-pause`、重复的 sw-register script 标签、以及被并线拼在一起的 head 里那行空 script。
- **没有任何一处靠删功能来让闸变绿**：闸的断言一条没改、强度一条没降；
  唯一改到闸里的是 `tools/deploy-set.mjs` 那两个**实数钉**（29/48 → 32/51），并注明「钉的是实数，强度不变」。

## 3. 文档行号钉的重钉清单

| 位置 | 旧钉 | 新钉 | 钉到的东西 |
|---|---|---|---|
| `README.md:4` | `index.html:71` | `index.html:80` | `<canvas id="board">` |
| `README.md:6` | `index.html:27-31`、`js/engine/rules.js:19-21` | `index.html:38-39`、`js/engine/rules.js:80-90`、`js/engine/rules.js:100-102` | 菜单里铁球/黑格那两句 + 判据的 R1 与 R3 源码 |
| `README.md:9` | `index.html:31`、`:99` | `index.html:39`、`:148` | 「气球停在铁球下面不算浮起来」+ 帮助卡 R2 浮 |
| `README.md:14` | `js/main.js:26-31`、`index.html:125` | `js/main.js:36-39`、`index.html:167` | `measuredLine` + 页脚那句点名出处 |
| `README.md:33` | `index.html:88-97` | `index.html:106-117` | 未定/撤销/换一局/重摆四个按钮 |
| `README.md:37` | `js/main.js:45` | `js/save.js:141` | `r.ms < prev.ms`（**实际在 save.js，不在 main.js**） |
| `README.md:39` | `js/main.js:389` | `js/main.js:566` | `keydown` 总闸 |
| `README.md:40` | `js/main.js:146` | `js/main.js:295` | `blockedWhilePaused()` |
| `README.md:43` | `js/main.js:233` | `js/main.js:391` | `adoptFreshBoard()` |
| `README.md:158` | `index.html:40-43` | `index.html:49-53` | 选档页那段「最高档的读数已经把天花板指出来了」 |
| `README.md:161` | `js/main.js:30`、`js/main.js:332` | `js/main.js:36`、`js/main.js:462` | `measuredLine` + `TIER_NOTE` |
| `README.md:37` / `DESIGN.md:132` | `js/save.js:129` | `js/save.js:141` | 补 `Store.data` 之后行号上移 |
| `DESIGN.md:21` | `index.html:31`、`index.html:112` | `index.html:39`、`index.html:60` | 菜单那句 + 判据 R2 浮那行 |
| `DESIGN.md:118` | `index.html:40-43` | `index.html:49-53` | 同上 |
| `DESIGN.md:120` | `js/main.js:30` | `js/main.js:36` | `measuredLine` |
| `DESIGN.md:135` | `js/main.js:146` | `js/main.js:295` | `blockedWhilePaused()` |
| `DESIGN.md:136` | `js/main.js:389` | `js/main.js:566` | `keydown` |
| `DESIGN.md:151` | `js/main.js:233` | `js/main.js:391` | `adoptFreshBoard()` |
| `DESIGN.md:152` | `js/main.js:249`、`js/main.js:269` | `js/main.js:407`、`js/main.js:430` | 两条分支各自的 `game = new Game(…)` |
| `DESIGN.md:155` | `js/main.js:261` | `js/main.js:424` | 「没出货」那条出口 |
| `DESIGN.md:259` | `js/main.js:223` | `js/main.js:381` | `hint()` |
| `DESIGN.md:262` | `js/main.js:369-374` | `js/main.js:139` | `setMuted()`（音效那条整段重写） |
| `DESIGN.md:267` | `js/main.js:33-48` | `js/main.js:44-49`、`js/save.js:136` | 存档口 + `setGame`（续局那条整段重写） |
| `DESIGN.md:271` | — | `js/main.js:516` | 触屏三条真事件路（该条整段重写） |
| `DESIGN.md:233` | `62 断言` | `68 断言` | doctest 自己的条数 |
| `README.md:226` / `README.md:234` | `EXPECT_CHECKS=29` / `EXPECT_ROWS=47` | `32` / `51` | 部署集闸钉的实数 |

## 4. 验收命令与原样输出

```bash
# ① 语法门（package.json 的 check 脚本，逐文件 node --check）
$ npm run check
check OK
rc=0

# ② node 侧整闸（= npm test）
$ bash tools/verify.sh
...
  rule-test: PASS（17 条断言）
  counter-test: PASS（26 条断言）
  pencil-test: PASS（24 条断言）
  golden-test: PASS（46 条断言）
  generator-probe: PASS（42 条断言）
  sabotage: PASS（19 条断言）
  doctest: PASS（68 条断言）
gate-rows（本轮每条闸自己报的条数）：rule-test 17 counter-test 26 pencil-test 24 golden-test 46 generator-probe 42 sabotage 19 doctest 68
logic: PASS（闸：rule-test counter-test pencil-test golden-test generator-probe sabotage doctest）
=== deploy-set ===
部署集：32 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 51 fail: 0
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
browser: SKIP（npm test 只跑逻辑闸；浏览器闸走 BROWSER=1 / npm run verify）
=== ALL GREEN ===
VERIFY_RC=0

# ③ 整闸带浏览器腿（4 条腿 × 2 种 URL 形态）
$ BROWSER=1 bash tools/verify.sh
...
  engine/engine: 26 checks, 0 failed
  engine/menu: 45 checks, 0 failed
  gen/gen: 69 checks, 0 failed
  play: 84 checks, 0 failed  {'leg': 'play', 'clicks': 15, 'cells': 14, 'buttons': 8}
  pause: 73 checks, 0 failed  {'leg': 'pause', 'cuts': 19, 'controls': 11, 'cells': 14}
===== 2 个 URL 形态的断言条数对表 =====
  engine/engine    形态1=26 形态2=26 ok 相同
  engine/menu      形态1=45 形态2=45 ok 相同
  gen/gen          形态1=69 形态2=69 ok 相同
  pause            形态1=73 形态2=73 ok 相同
  play             形态1=84 形态2=84 ok 相同
  2 个形态 × 5 条读数 = 应有 10 个，实到 10；各形态合计 297 / 297
    ok   counts engine/engine：文档 26 == 本轮每个形态报出的条数 · 本轮 形态1=26 形态2=26
    ok   counts engine/menu：文档 45 == 本轮每个形态报出的条数 · 本轮 形态1=45 形态2=45
    ok   counts gen/gen：文档 69 == 本轮每个形态报出的条数 · 本轮 形态1=69 形态2=69
    ok   counts play：文档 84 == 本轮每个形态报出的条数 · 本轮 形态1=84 形态2=84
    ok   counts pause：文档 73 == 本轮每个形态报出的条数 · 本轮 形态1=73 形态2=73
  counts: PASS
=== ALL GREEN ===
VERIFY_RC=0
```

`play` 腿那条 `cuts: 19` 是闸自己的读数：暂停中 19 刀（5 真点击 + 9 真按键 + 5 台面 API）逐刀被挡、
盘面指纹一字未动、`elapsedMs` 恒等；`controls: 11` 是名册 11 只控件一只不缺、中心都落在自己身上。

## 5. 行为变化需知会

| 变化 | 以前 | 现在 | 为什么 |
|---|---|---|---|
| 选档页那颗续局按钮 | 「继续上一局」 | 「回到上一局」 | 浏览器腿断言「页面上只能有一只写着暂停/继续的按钮」（`[...document.querySelectorAll('button')].filter(b=>/暂停|继续/.test(b.textContent))` 只认暂停开关那一只）。功能没删，只是改了口 |
| 暂停卡片里那颗按钮 | 「继续（P）」 | 「接着摆（P）」 | 同上 |
| 顶栏 | 没有玩法说明入口 | 多一颗 `?` 按钮（`index.html:25`） | `el.help` 早就指向 `#btn-help`，但页面里没有这颗按钮 ⇒ 教学页不可达 |
| 键位 | `P` 暂停 | 另加 `R` 换一局、`M` 静音、`?` 玩法说明、`Esc` 关闭说明 | 说明页本来就写着这几颗键，代码里没有 |
| 选档页按方向键 / `W` `B` `X` / `Z` | 控制台一条 TypeError，页面看着像没反应 | 什么也不做（局外没有盘面） | 原来读的是还为 null 的 `game.cursor` |
| 选档页按 `Enter` / 空格 | 同样 TypeError | 开默认档（焦点在某一档按钮上时走那颗按钮） | 说明页写着「Enter/空格 在菜单里开局」 |
| 暂停时按 `Esc` | 无反应 | 关掉玩法说明（如果开着） | 模态对话框要能关；它排在暂停总闸之前 |
| service worker | 注册两次 | 只注册一次（`js/pwa-register.js`） | 重复注册 |
| `Store.data` | 不存在 | 原样存档对象 | 浏览器腿的坏档那一族读的就是它 |

## 6. 基线归因记录（哪些红是并线前就有的）

在 `git worktree add --detach /tmp/dosun-pre 9b99980` 上跑同一批闸，量到的基线：

| 闸 | 基线（9b99980） | 修完 | 判定 |
|---|---|---|---|
| `node --check js/main.js` | `SyntaxError: Identifier 'setPaused' has already been declared`（第 274 行） | 通过 | **整局不可玩，并线前就有** |
| `index.html` 重复 id | `id="btn-pause"` 出现两次 | 无重复 | 并线前就有 |
| `el` 表条数 | 22 条，缺 9 个键；其中 `btn-help` 在页面里根本不存在 | 31 条，无悬挂引用 | 并线前就有 |
| `tools/doctest.mjs` | **2/68 红**（D9 行号漂 7 处、D22 锚点漂 3 处） | 68/68 绿 | 并线前就有（本轮一并重钉） |
| `tools/sabotage.mjs` | **8/19 红**（因为它复制的副本里 doctest 本来就红，K1–K7 每把刀都「越界红了」） | 19/19 绿 | 并线前就有 |
| `tools/deploy-set.mjs` | **2 项红**（钉 29 / 48 vs 实 35 / 54） | 32 / 51 绿 | 并线前就有（实数钉随改动更新，强度不变） |
| 浏览器腿 `play` 腿 | 页面都开不出来（模块不加载），腿跑不到断言 | 84 条 0 失败 | 本轮修复 |

即：**基线上 node 侧与浏览器侧都是红的，没有一条红是本轮引入的。**

另有一条是「并线把远端的能力吃掉了」而不是「基线就坏」：
远端侧（`9b99980^2`）的 `Store` 上有 `get data()`，本地侧的 `js/save.js` 重写了存档实现但没有这个出口，
而 `tools/playtest.cjs`（两侧一模一样）断的就是它 ⇒ `play` 腿两种形态各红一条。
本轮补的是**出口**（`js/save.js:127`），闸的断言一个字节没改。

## 7. 未实现 / 需人接手

| 事项 | 状态 | 备注 |
|---|---|---|
| 第三形态（已部署站点）复跑 | **待本仓 push 之后做** | 本轮没有部署，所以没跑线上那 3 形态 × 5 份 = 15 份读数。`README.md:93-96` 里那句是上一轮部署后的历史记录；本次 push 触发 Pages 重新部署后应再复跑一次 `BASE_URL=https://z-biz-game.github.io/z-biz-game-dosun-cos/ BROWSER=1 bash tools/verify.sh` |
| 音效 | 有真模块，但**没有任何闸量它** | `DESIGN.md` 的「不承诺」里如实写着：闸不读 `AudioContext.state`、不数振荡器，所以「音效好不好听」这句话仍然不写 |
| 续局（退出再回来还是这一局） | 有实现（`resumeSaved`），但**没有腿** | 同样如实写进「不承诺」 |
| 触屏 | 三条真事件路都在，但**闸只走 `pointerdown`**，没有设备仿真腿 | 同上 |
| `js/save.js` 的两段式解码 | node 侧有测，**浏览器腿没碰过它** | 同上 |
| 仓内散落的临时文件（`_tmp-dosun-sab-*.log`、`_tmp-verify*`） | 未动 | 它们已被 git 跟踪或忽略，`git status` 干净；清理属于仓务，不在本次改动范围内 |
