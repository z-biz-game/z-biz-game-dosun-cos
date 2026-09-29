// 闸的公共件。约定只有一条：**每条红都要点名它是哪道闸**（`FAIL <gate> :: <断言> —— <读数>`），
// 只印 "FAIL undefined" 的红要付两次往返的代价。
// 统计口径 med/p95 与原型逐项一致（升序后 a[len>>1] / a[floor(len*0.95)]），
// 比较函数只比数值、不掺随机数 —— 见 js/engine/rng.js 顶部。

import fs from 'fs';
import path from 'path';

export function mkGate(tag) {
  const fails = [];
  let checks = 0;
  const ok = (label, cond, detail = '') => {
    checks++;
    if (cond) console.log(`  ok   ${label}${detail ? ` —— ${detail}` : ''}`);
    else { fails.push(`${label}${detail ? ` —— ${detail}` : ''}`); console.log(`  RED  ${label}${detail ? ` —— ${detail}` : ''}`); }
  };
  const show = v => typeof v === 'string' ? JSON.stringify(v) : String(v);   // Infinity 走 JSON.stringify 会变成 null，读数就骗人了
  const eq = (label, got, want) => ok(label, got === want, `读数 ${show(got)}，应为 ${show(want)}`);
  const line = s => console.log(s);
  const finish = () => {
    if (fails.length) {
      for (const f of fails) console.log(`FAIL ${tag} :: ${f}`);
      console.log(`${tag}: ${fails.length}/${checks} 条红`);
      process.exit(1);
    }
    console.log(`${tag}: PASS（${checks} 条断言）`);
  };
  return { tag, ok, eq, line, finish, fails };
}

const asc = a => [...a].sort((x, y) => x - y);
export const med = a => a.length ? asc(a)[a.length >> 1] : NaN;
export const p95 = a => a.length ? asc(a)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : NaN;
export const fmt = a => a.length ? `${med(a)} / ${p95(a)}` : '—';

/** 环境变量读数：全部可覆盖，默认值就是提交前跑过的那组。 */
export const envInt = (k, d) => { const v = process.env[k]; return v === undefined || v === '' ? d : +v; };
export const envStr = (k, d) => process.env[k] || d;

export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
export const here = path.dirname(new URL(import.meta.url).pathname);
