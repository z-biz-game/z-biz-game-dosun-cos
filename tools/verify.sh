#!/usr/bin/env bash
# 一条命令跑全部闸。每道闸单独退码，红要能点名是哪道闸（各 tool 自己印 FAIL <gate> :: …）。
#
#   bash tools/verify.sh                 # 默认：七道 node 逻辑闸（npm test 走的就是这一条，快且稳）
#   BROWSER=1 bash tools/verify.sh       # 再加真浏览器闸：engine / gen / play 三条腿 × 两种 URL 形态
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-dosun-cos/ BROWSER=1 bash tools/verify.sh
#                                       # 追加第三种形态：线上已部署站点（本地两种全绿不等于 Pages 上那份是对的）
#   SELF=1 … BROWSER=1 bash tools/verify.sh   # 阴性自证：种一条注定错的期望，必须点名变红、rc 非 0
#   LEGS="engine play" …                 # 只跑其中几条腿
#
# 浏览器闸的规矩（照着 z-biz-game-hebi-cos 那套血换来的一条不改）：
#  * 每一腿一个自己的 --user-data-dir（mktemp -d 在 _tmp-verify 里），跑完立刻删：
#    共用 profile 会让后一条腿读到前一条腿留下的档，看着像绿其实什么都没测。
#  * 指针/键盘断言走 CDP Input.dispatch*（真事件），并且断言点击之前先断言 hit box：
#    getBoundingClientRect() 的中心要与 document.elementFromPoint() 对得上；
#    "幕布藏起来了"由 getClientRects() 作证，不假设 hidden 属性有效（display:grid 会盖掉它）。
#  * 片段导航不算重载；要落在新文档就走 Page.reload。
#  * 不要加 --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader：软件光栅占满每个核，
#    而且没有 CDP 客户端 attached 时 Chrome 根本不会自己退。
#  * macOS 没有 timeout：看门狗用后台子 shell + trap。
#  * 端口 5273 与 CDP 9473 是本仓自己的；开工前还要 pre-flight 证明服务中的字节就是这个仓的 app，
#    以及 CDP 端口在起 Chrome 之前是空的。
#    CDP 为什么不是 9373：9373 是 5273 的镜像位（本仓族里 HTTP 52NN 对应 CDP 93NN 的写法），
#    但 2026-09-30 实测它被兄弟车道 skyscraper 的一个长期 Chrome 占着
#    （lsof → pid 5109，--user-data-dir=/tmp/sky-chrome-profile，cwd=z-biz-game-skyscraper-cos）。
#    在那种端口上起 Chrome，"devtools bound" 会照样成立、attach 到的却是别人的浏览器，
#    那种绿比红更糟，所以本仓的 CDP 用 9473，并且下面那条 pre-flight 会直接拒绝抢端口。
set -u
cd "$(dirname "$0")/.."
# doctest 必须是这条名单里的**最后一条**：它读的是前面每条闸本轮自己打印的断言条数（D14d）。台账 sabotage 排在它前一条。
GATES="rule-test counter-test pencil-test golden-test generator-probe sabotage doctest"
[ $# -gt 0 ] && GATES="$*"
rc=0
# 每条闸的输出同时落到 _tmp-verify-logic/<gate>.log，这里从它自己的那行 PASS 里现读条数，
# 写成 manifest 交给 doctest 对表：README 那句「逻辑闸本轮合计 N 条断言全绿：a + b + …」
# 抄的就是这份 manifest。写死数字一定漂——加一条断言，文档就少一次真相。
# 路径不带 _tmp-verify：那个目录在浏览器段开头会被整个 rm -rf，manifest 得活到那时之后。
LOGD="_tmp-verify-logic"
rm -rf "$LOGD"; mkdir -p "$LOGD"
GATE_ROWS="$LOGD/gate-rows.txt"; : >"$GATE_ROWS"
export GATE_ROWS_FILE="$GATE_ROWS"
for gate in $GATES; do
  printf '\n===== %s =====\n' "$gate"
  node "tools/$gate.mjs" >"$LOGD/$gate.log" 2>&1
  grc=$?
  sed 's/^/  /' "$LOGD/$gate.log"
  N=$(sed -n "s/^$gate: PASS（\([0-9]*\) 条断言）$/\1/p" "$LOGD/$gate.log" | head -1)
  printf '%s %s\n' "$gate" "${N:-NA}" >>"$GATE_ROWS"
  if [ "$grc" = 0 ]; then
    printf 'ok   %s\n' "$gate"
  else
    printf 'RED  %s (rc=%s)\n' "$gate" "$grc"
    rc=1
  fi
done
printf '\ngate-rows（本轮每条闸自己报的条数）：%s\n' "$(tr '\n' ' ' <"$GATE_ROWS")"
printf 'logic: %s（闸：%s）\n' "$([ $rc -eq 0 ] && echo PASS || echo FAIL)" "$GATES"

if [ "${BROWSER:-0}" != 1 ]; then
  echo "browser: SKIP（npm test 只跑逻辑闸；浏览器闸走 BROWSER=1 / npm run verify）"
  exit $rc
fi

# ---------------- 真浏览器闸 ----------------
PORT=${CDP_PORT:-9473}
HTTP=${HTTP_PORT:-5273}
SELF=${SELF:-${GATE_SELFTEST:-0}}
# 种单人要把标记真的递给台架：playtest.cjs / scenarios.js 读的是 GATE_SELFTEST，
# 只留 SELF=1 在 shell 里，planted 行一条都不会出现（阴性自证就变成空转）。
export GATE_SELFTEST=$SELF
TMPD="_tmp-verify"
rm -rf "$TMPD"; mkdir -p "$TMPD"
GEN_SEED=${GEN_SEED:-7}
LEGS=${LEGS:-engine gen play}
# 一条腿应当落地哪几份**报告标签**，只有这一处定义：腿循环、条数对表、阴性自证的分母都从它现算。
# 写死数字会静默缩样——加一条腿忘了种错、或某条腿整条没跑，对表照样打印"各形态条数相同"。
# （标签形状就是下面 parse 的调用处：run_scenario 印 "<腿>/<场景>"，run_cmd 只印腿名。）
reports_of() {
  case $1 in
    engine) echo "engine/engine engine/menu" ;;
    gen)    echo "gen/gen" ;;
    play)   echo "play" ;;
    *)      echo "" ;;          # 未知腿由腿循环点名，这里不重复
  esac
}
EXPECT_TAGS=""
for _leg in $LEGS; do EXPECT_TAGS="$EXPECT_TAGS $(reports_of "$_leg")"; done
EXPECT_TAGS=$(echo $EXPECT_TAGS | tr ' ' '\n' | grep -v '^$' | sort -u)
[ -n "$EXPECT_TAGS" ] || { echo "LEGS=[$LEGS] 一条腿都不认：没有报告可等，闸不许空跑" >&2; exit 1; }
export LEGS
echo "闸的形状：腿 $(echo $LEGS | tr ' ' '/') → 报告 $(echo $EXPECT_TAGS | tr '\n' ' ')"

CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

# 端口上坐的必须是本仓的 server：先探一次，占了就点名是谁占的，绝不"换个端口继续跑"。
if curl -fsS -m 2 "http://127.0.0.1:$HTTP/" >/dev/null 2>&1; then
  echo "端口 $HTTP 上已经有东西在服务，本仓的 verify.sh 不抢端口：" >&2
  lsof -nP -iTCP:"$HTTP" -sTCP:LISTEN >&2 || true
  exit 2
fi
# CDP 端口同理：上面还坐着别的车道那个长期 Chrome 的话，"devtools bound" 照样成立，
# 而每条腿 attach 到的是别人的浏览器——读数是别人的页面，绿是假的。
if curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "CDP 端口 $PORT 上已经有一个 DevTools 在服务，本仓的 verify.sh 不抢：" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  exit 2
fi
node server.cjs "$HTTP" >"$TMPD/server.log" 2>&1 &
SPID=$!
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$HTTP/" >/dev/null 2>&1 && break
  sleep 0.25
done

SHAPES=("http://127.0.0.1:$HTTP/" "http://127.0.0.1:$HTTP/z-biz-game-dosun-cos/")
# 线上那一形态只能对着真站点测：前缀、缓存、Pages 发的 Content-Type 都不在本地 server 上。
# 给了 BASE_URL 就追加进同一个循环、同一套腿，下面的条数对表按形态数逐条比，不多不少。
if [ -n "${BASE_URL:-}" ]; then SHAPES+=("$BASE_URL"); fi

# Pre-flight：证明接下来测的字节就是这个仓的 app，而不是同一端口上另一个仓的 index.html。
for base in "${SHAPES[@]}"; do
  SERVED=$(curl -fsS -m 5 "$base" 2>/dev/null || true)
  case "$SERVED" in *js/main.js*) ;; *) echo "nothing served at $base (see $TMPD/server.log)" >&2; exit 2 ;; esac
  echo "$SERVED" | grep -qi dosun || { echo "$base 不是 dosun：端口上坐着别的仓" >&2; exit 2; }
  echo "$SERVED" | grep -q どすんふわり || { echo "$base 的 HTML 里没有 どすんふわり" >&2; exit 2; }
  curl -fsS -m 5 "${base}js/engine/rules.js" >/dev/null || { echo "$base 下取不到 js/engine/rules.js" >&2; exit 2; }
  curl -fsS -m 5 "${base}js/engine/tiers.js" >/dev/null || { echo "$base 下取不到 js/engine/tiers.js" >&2; exit 2; }
done
echo "preflight: ${#SHAPES[@]} 个 URL 形态都 served 且带 dosun/どすんふわり 标记 — ${SHAPES[*]}"

# node 侧证人：官方 4×4 的夹具读数 + 每一档在同一颗种子下 node 出的盘指纹。
# 页面里那些断言比的就是这一份 —— "Chrome 与 node 长同一张盘"才是跨引擎的证人，不是自说自话。
EXPECT_OFFICIAL=$(node --input-type=module -e "
import fs from 'fs';
const j = JSON.parse(fs.readFileSync('tools/fixtures/golden.json','utf8'));
process.stdout.write(JSON.stringify(j.official));
") || { echo "RED 取不到 tools/fixtures/golden.json 的 official 读数" >&2; exit 1; }
export EXPECT_OFFICIAL GEN_SEED
echo "  witness(official) $EXPECT_OFFICIAL"

echo "  出货 node 侧指纹（GEN_SEED=${GEN_SEED}，每档 attempts=档位表上限）…"
( node --input-type=module -e "
import { shipOne, boardKey } from './js/engine/generate.js';
import { fnv1a } from './js/engine/rng.js';
import { TIERS, DIG } from './js/engine/tiers.js';
const SEED = Number(process.env.GEN_SEED || 7);
const out = { __seed: SEED };
for (const t of TIERS) {
  const s = shipOne({ R: t.R, C: t.C, NB: t.NB, NR: t.NR, seed: SEED, attempts: t.ship.attempts, ...DIG });
  out[t.id] = s ? { key: fnv1a(boardKey(s.B_, s.reg)), read: s.r.read, forced: s.p.forced + '/' + s.p.total } : null;
  process.stderr.write('  node 出货 ' + t.id + ' ' + (s ? 'ok' : 'NULL') + '\n');
}
process.stdout.write(JSON.stringify(out));
" >"$TMPD/node-keys.json" ) 2>"$TMPD/node-keys.err"
EXPECT_KEYS=$(cat "$TMPD/node-keys.json")
[ -n "$EXPECT_KEYS" ] || { echo "RED node 侧算不出出货指纹（见 $TMPD/node-keys.err）" >&2; exit 1; }
export EXPECT_KEYS
sed 's/^/  /' "$TMPD/node-keys.err"

CPID=0
UDD=""
cleanup() {
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$CPID" != 0 ] && kill -9 $CPID 2>/dev/null
  [ -n "$UDD" ] && rm -rf "$UDD"
}
trap cleanup EXIT
( sleep ${WD_TIMEOUT:-1500}; echo "  RED 看门狗到点收尸（WD_TIMEOUT=${WD_TIMEOUT:-1500}s）" >&2; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

FAILED=$rc
PLANT_HITS=""

leg_start() {   # $1 = leg, $2 = base url
  UDD=$(mktemp -d "$TMPD/udd-$1.XXXXXX")
  "$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir="$UDD" \
    --window-size=980,1020 --no-first-run --no-default-browser-check about:blank >"$TMPD/chrome-$1.log" 2>&1 &
  CPID=$!
  for i in $(seq 1 120); do
    curl -fsS -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
    sleep 0.25
  done
  curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
    echo "  RED devtools never bound on :$PORT (leg $1)" >&2; FAILED=1; return 1; }
  # 绑在这个端口上的必须就是本腿刚起的那一个 Chrome（实测：lsof -t 出来的 pid == $!）。
  # 只查"端口上有 DevTools"的话，抢在别人 Chrome 上跑的每条腿都会绿——那是别人的页面。
  LPID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
  [ "$LPID" = "$CPID" ] || {
    echo "  RED :$PORT 上的 DevTools 不是本腿起的 Chrome（listener=${LPID:-none} / 本腿 pid=${CPID}）" >&2
    FAILED=1; return 1; }
  export CDP_PORT=$PORT BASE_URL="$2"
  echo "--- leg $1 @ $2 (profile $UDD)"
  # open 必须在 DevTools 绑好之后发：在 leg_start 之前跑会先撞上"devtools never bound"。
  node tools/playtest.cjs open "$2" | head -2
}
leg_stop() {
  [ "$CPID" != 0 ] && kill -9 $CPID 2>/dev/null
  wait $CPID 2>/dev/null
  [ -n "$UDD" ] && rm -rf "$UDD"
  CPID=0; UDD=""
}

parse() {   # $1 = 标签（腿名/场景名），$2 = 形态序号（用来比对两种形态的条数）
  python3 -c "
import sys, json, os
tag, shape, path = sys.argv[1], sys.argv[2], os.environ['RESULT_FILE']
raw = ''
try:
    with open(path) as f:
        for line in f:
            if line.startswith('RESULT '): raw = line[7:].strip()
except FileNotFoundError:
    pass
if not raw:
    print('  RED %s：没有 RESULT 行（这一腿一条断言都没跑到）' % tag); sys.exit(1)
try:
    d = json.loads(raw)
except Exception as e:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
for r in d['rows']:
    if not r['pass']:
        print('  FAIL %-58s %s' % (r['test'], r['detail']))
        if r['test'].startswith('SELFTEST·'):
            print('PLANTED ' + r['test'], file=sys.stderr)
if not d['rows']:
    print('  RED %s：NO CHECKS RUN — a leg that asserts nothing cannot be green' % tag); sys.exit(1)
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
n = len(d['rows'])
print('  %s: %d checks, %d failed  %s' % (tag, n, d['fail'], extra if extra else ''))
open(os.environ['COUNTS'],'a').write('%s %s %d\n' % (shape, tag, n))
sys.exit(1 if d['fail'] else 0)
" "$1" "$2" 2>>"$TMPD/planted.err" || FAILED=1
}

run_scenario() {   # $1 name, $2 leg, $3 shape index
  export RESULT_FILE="$TMPD/$2-$1-$3.out"
  node tools/playtest.cjs scenario "$1" >"$RESULT_FILE" 2>"$TMPD/$2-$1-$3.console.log"
  sed -n 's/^EVIDENCE /  EVID /p' "$RESULT_FILE"
  parse "$2/$1" "$3"
  if [ -s "$TMPD/$2-$1-$3.console.log" ]; then
    echo "  --- console ($2/$1) ---"
    sed 's/^/  /' "$TMPD/$2-$1-$3.console.log" | tail -8
  fi
}
run_cmd() {   # $1 tag, $2 leg, $3 shape index, 其余 = playtest 参数
  local tag="$1"; shift
  local leg="$1"; shift
  local shape="$1"; shift
  export RESULT_FILE="$TMPD/$tag.cmd.$shape.out"
  node tools/playtest.cjs "$@" >"$RESULT_FILE" 2>"$TMPD/$tag.cmd.$shape.console.log"
  sed -n 's/^EVIDENCE /  EVID /p' "$RESULT_FILE"
  # 没有 RESULT 行 = 这一腿一声不响地没落地。以前是 `grep -q && parse`，
  # 于是"整条 play 腿崩了"在对表里只是少一行，其余形态照样条数相同、照样 ALL GREEN。
  if grep -q '^RESULT ' "$RESULT_FILE"; then parse "$leg" "$shape"; else
    echo "  RED ${leg}（形态 ${shape}）：没有 RESULT 行（这一腿一条断言都没跑到）" >&2
    FAILED=1
  fi
  return 0
}

export COUNTS="$TMPD/counts.txt"
: >"$COUNTS"

shape_idx=0
for base in "${SHAPES[@]}"; do
  shape_idx=$((shape_idx + 1))
  echo
  echo "########## URL 形态 $shape_idx: $base ##########"
  for leg in $LEGS; do
    case $leg in
      engine)
        leg_start engine "$base" || continue
        run_scenario engine engine "$shape_idx"
        run_scenario menu engine "$shape_idx"
        leg_stop ;;
      gen)
        leg_start gen "$base" || continue
        run_scenario gen gen "$shape_idx"
        leg_stop ;;
      play)
        leg_start play "$base" || continue
        run_cmd playleg play "$shape_idx" leg play
        leg_stop ;;
      *)
        # 未知腿名必须红，不能"匹配不到就算跑完了"（LEGS=menu 看着像跑完，其实一份报告都没有：
        # menu 是 engine 腿里的一个场景名，不是腿名）。花括号不是装饰：没有 LANG 的环境里
        # 裸写 `$leg（` 会把全角括号的首字节算进变量名，报 unbound variable——红了也点不出是谁。
        echo "  RED 未知的腿：${leg}（LEGS 只认 engine gen play）" >&2; FAILED=1 ;;
    esac
  done
done

# 每个 URL 形态必须报出**同样条数**的断言：少一条就是那一形态上有东西没跑到。
# 形态数是从 SHAPES 现取的，不是写死的 2 —— 加了线上形态却有腿没跑到，对表要能看见缺的那一列。
echo
echo "===== ${#SHAPES[@]} 个 URL 形态的断言条数对表 ====="
# 默认口径（脚本里那行 LEGS=${LEGS:-…}，不是环境变量）现读一遍：收窄的 LEGS 是开发用的
# 便利（上面注释写了），但它不许被读成"全绿"——所以这一行要把"本轮 2 份 / 默认 4 份"说出来。
DEFAULT_LEGS=$(sed -n 's/^LEGS=\${LEGS:-\(.*\)}$/\1/p' tools/verify.sh)
DEFAULT_TAGS=""
for _leg in $DEFAULT_LEGS; do DEFAULT_TAGS="$DEFAULT_TAGS $(reports_of "$_leg")"; done
DEFAULT_TAGS=$(echo $DEFAULT_TAGS | tr ' ' '\n' | grep -v '^$' | sort -u)
NSHAPES=${#SHAPES[@]} EXPECT="$EXPECT_TAGS" DEFAULT="$DEFAULT_TAGS" python3 -c "
import os, collections
n = int(os.environ['NSHAPES'])
expect = [t for t in os.environ['EXPECT'].split() if t]
rows = collections.defaultdict(dict)
for line in open(os.environ['COUNTS']):
    shape, tag, k = line.split()
    rows[tag][shape] = int(k)
shapes = [str(i) for i in range(1, n + 1)]
bad = 0
# 先问"该到的报告到了吗"：少一份是缩样，多一份是腿循环与这张表不同源。两种都不算绿。
for t in expect:
    if t not in rows:
        print('  RED 应有报告没落地：%s（LEGS=%s 里这条腿该报它）' % (t, os.environ.get('LEGS', '?'))); bad += 1
for t in sorted(rows):
    if t not in expect:
        print('  RED 报告落地了但不在名单上：%s（reports_of 与腿循环不同源）' % t); bad += 1
for tag, d in sorted(rows.items()):
    vals = [d.get(s) for s in shapes]
    same = all(v is not None for v in vals) and len(set(vals)) == 1
    print('  %-16s %s %s' % (tag, ' '.join('形态%s=%s' % (s, d.get(s)) for s in shapes),
                             'ok 相同' if same else 'RED 不齐'))
    bad += 0 if same else 1
got = sum(len(v) for v in rows.values())
print('  %d 个形态 × %d 条读数 = 应有 %d 个，实到 %d；各形态合计 %s'
      % (n, len(rows), n * len(rows), got,
         ' / '.join(str(sum(v.get(s, 0) for v in rows.values())) for s in shapes)))
print('  名单（由 LEGS 现算）：%s' % ' '.join(expect))
default = [t for t in os.environ.get('DEFAULT', '').split() if t]
missing_default = [t for t in default if t not in expect]
if missing_default:
    print('  注意：本轮 LEGS 被显式收窄（%s），少跑了 %d 份报告：%s —— 这一行不是全绿，默认口径是脚本里 LEGS=${LEGS:-…} 那一行'
          % (os.environ.get('LEGS', '?'), len(missing_default), ' '.join(missing_default)))
elif default and len(default) == len(expect):
    print('  本轮就是默认全套口径（%d 份报告，一条没少）' % len(default))
else:
    print('  RED 本轮报告名单与默认口径对不上：默认 %s / 本轮 %s' % (' '.join(default), ' '.join(expect)))
    bad += 1
if not rows:
    print('  RED 对表是空的：一条腿的读数都没落地'); bad += 1
raise SystemExit(1 if bad else 0)
" || FAILED=1

# 文档里那句"逐报告条数"抄的就是上面这份 counts.txt。逻辑段跑不到浏览器，所以在这里
# 把刚写出的那份递给文档闸再比一次：形态之间等量、每一份都等于文档抄的那个值。
# 单独 `node tools/doctest.mjs` 没有这一步（那时没有浏览器读数可比），
# 所以这句话只在 npm run verify / CI 的 browser job 里被守住——README 也照这一句写。
# 阴性自证（SELF=1）时不比：那一种跑法每条报告都被人为 +1 条 planted，比的是"会红"，不是条数。
if [ "$SELF" = 1 ]; then
  echo "  counts：SKIP（SELF=1：每条报告都被种了一条错，+1 是设计如此）"
elif COUNTS_FILE="$COUNTS" node tools/doctest.mjs --counts >"$TMPD/doctest-counts.log" 2>&1; then
  sed 's/^/  /' "$TMPD/doctest-counts.log"
else
  sed 's/^/  /' "$TMPD/doctest-counts.log"
  echo "  RED doctest --counts（文档抄的逐报告条数与本轮 counts.txt 对不上）" >&2
  FAILED=1
fi

if [ "$SELF" = 1 ]; then
  echo
  echo "=== SELF（GATE_SELFTEST）：种下的期望必须点名变红 ==="
  echo "  planted rows: scenarios.js 与 playtest.cjs 在 __selftest 为真时各加一条 1==2，测试名写着腿名"
  sort -u "$TMPD/planted.err" 2>/dev/null | sed 's/^/  /'
  # 分母由 EXPECT_TAGS（也就是 reports_of/LEGS 那份名单）现算，不写死 4：
  # 写死的话，加一条腿忘了种错会红得不明不白，而删一条腿会让"应有 4"变成永远达不到的门槛。
  HIT=0; MISS=""
  for tag in $EXPECT_TAGS; do
    who=${tag##*/}
    if grep -qF "SELFTEST·$who " "$TMPD/planted.err" 2>/dev/null; then
      HIT=$((HIT + 1))
    else
      MISS="$MISS $who"
    fi
  done
  NEXPECT=$(echo $EXPECT_TAGS | wc -w | tr -d ' ')
  echo "  种下的错被 $HIT/$NEXPECT 份报告点名吃下（名单：$(echo $EXPECT_TAGS | tr '\n' ' ')）"
  if [ "$FAILED" = 0 ]; then
    echo "  RED 阴性自证失败：闸没能把种下的错期望跑红（这个闸证明不了自己会红）" >&2
    FAILED=1
  elif [ -n "$MISS" ]; then
    echo "  RED 阴性自证有报告没吃到种下的错：${MISS}（应有 ${NEXPECT} 份）" >&2
    FAILED=1
  else
    echo "  ok 闸确实会红，且 rc 非 0"
  fi
fi

kill $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE (rc=$FAILED) ==="
exit $FAILED
