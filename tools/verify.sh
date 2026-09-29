#!/usr/bin/env bash
# 一条命令跑全部闸。每道闸单独退码，红要能点名是哪道闸（各 tool 自己印 FAIL <gate> :: …）。
#
#   bash tools/verify.sh                 # 默认：五道 node 逻辑闸（npm test 走的就是这一条，快且稳）
#   BROWSER=1 bash tools/verify.sh       # 再加真浏览器闸：engine / gen / play 三条腿 × 两种 URL 形态
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
#  * 端口 5267 与 CDP 9367 是本仓自己的；开工前还要 pre-flight 证明服务中的字节就是这个仓的 app。
set -u
cd "$(dirname "$0")/.."
GATES="rule-test counter-test pencil-test golden-test generator-probe"
[ $# -gt 0 ] && GATES="$*"
rc=0
for gate in $GATES; do
  printf '\n===== %s =====\n' "$gate"
  if node "tools/$gate.mjs"; then
    printf 'ok   %s\n' "$gate"
  else
    printf 'RED  %s (rc=%s)\n' "$gate" "$?"
    rc=1
  fi
done
printf '\nlogic: %s（闸：%s）\n' "$([ $rc -eq 0 ] && echo PASS || echo FAIL)" "$GATES"

if [ "${BROWSER:-0}" != 1 ]; then
  echo "browser: SKIP（npm test 只跑逻辑闸；浏览器闸走 BROWSER=1 / npm run verify）"
  exit $rc
fi

# ---------------- 真浏览器闸 ----------------
PORT=${CDP_PORT:-9367}
HTTP=${HTTP_PORT:-5267}
SELF=${SELF:-${GATE_SELFTEST:-0}}
# 种单人要把标记真的递给台架：playtest.cjs / scenarios.js 读的是 GATE_SELFTEST，
# 只留 SELF=1 在 shell 里，planted 行一条都不会出现（阴性自证就变成空转）。
export GATE_SELFTEST=$SELF
TMPD="_tmp-verify"
rm -rf "$TMPD"; mkdir -p "$TMPD"
GEN_SEED=${GEN_SEED:-7}
LEGS=${LEGS:-engine gen play}

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
node server.cjs "$HTTP" >"$TMPD/server.log" 2>&1 &
SPID=$!
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$HTTP/" >/dev/null 2>&1 && break
  sleep 0.25
done

SHAPES=("http://127.0.0.1:$HTTP/" "http://127.0.0.1:$HTTP/z-biz-game-dosun-cos/")

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

echo "  出货 node 侧指纹（GEN_SEED=$GEN_SEED，每档 attempts=档位表上限）…"
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
  grep -q '^RESULT ' "$RESULT_FILE" && parse "$leg" "$shape"
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
        echo "  RED 未知的腿：$leg" >&2; FAILED=1 ;;
    esac
  done
done

# 两种 URL 形态必须报出**同样条数**的断言：少一条就是那一形态上有东西没跑到。
echo
echo "===== 两种 URL 形态的断言条数对表 ====="
python3 -c "
import os, collections
rows = collections.defaultdict(dict)
for line in open(os.environ['COUNTS']):
    shape, tag, n = line.split()
    rows[tag][shape] = int(n)
bad = 0
for tag, d in sorted(rows.items()):
    a, b = d.get('1'), d.get('2')
    same = a is not None and a == b
    print('  %-16s 形态1=%s 形态2=%s %s' % (tag, a, b, 'ok 相同' if same else 'RED 不同'))
    bad += 0 if same else 1
print('  两种形态各自跑满 %d 条 / %d 条' % (sum(v.get('1',0) for v in rows.values()), sum(v.get('2',0) for v in rows.values())))
raise SystemExit(1 if bad else 0)
" || FAILED=1

if [ "$SELF" = 1 ]; then
  echo
  echo "=== SELF（GATE_SELFTEST）：种下的期望必须点名变红 ==="
  echo "  planted rows: scenarios.js 与 playtest.cjs 在 __selftest 为真时各加一条 1==2，测试名写着腿名"
  sort -u "$TMPD/planted.err" 2>/dev/null | sed 's/^/  /'
  HIT=$(sort -u "$TMPD/planted.err" 2>/dev/null | grep -c 'SELFTEST·')
  echo "  种下的错被 $HIT 条腿点名吃下（engine/menu/gen/play）"
  if [ "$FAILED" = 0 ]; then
    echo "  RED 阴性自证失败：闸没能把种下的错期望跑红（这个闸证明不了自己会红）" >&2
    FAILED=1
  elif [ "$HIT" -lt 4 ]; then
    echo "  RED 阴性自证只被 $HIT 条腿点名（应有 engine/menu/gen/play 四条）" >&2
    FAILED=1
  else
    echo "  ok 闸确实会红，且 rc 非 0"
  fi
fi

kill $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE (rc=$FAILED) ==="
exit $FAILED
