#!/usr/bin/env bash
# 一条命令跑全部闸。每道闸单独退码，红要能点名是哪道闸（各 tool 自己印 FAIL <gate> :: …）。
# 用法：bash tools/verify.sh [闸名…]     默认全跑
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
printf '\nverify: %s（闸：%s）\n' "$([ $rc -eq 0 ] && echo PASS || echo FAIL)" "$GATES"
exit $rc
