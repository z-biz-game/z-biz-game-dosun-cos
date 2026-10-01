// 资产闸：盘上的位图必须是真的 PNG、真的那个尺寸、真的被页面/清单/CSS 引用到。
//
// 为什么要有这道闸（而不是"我看了一眼图标挺好看"）：
//   * 组合级 sellability 的 `图标` 与 `可安装` 判据在 2026-09 之后读的是**盘上字节**，
//     0 字节占位、SVG 冒充 PNG、manifest 指向不存在的文件，都算缺项。
//   * 本仓的美术由 assets/gen/make_art.py 现画（组合级 make_icons.py 的 MOTIF 表里没有
//     dosun，落兜底 orbit，与玩法无关），所以"工厂应有清单"与"盘上实到"必须逐条对表 ——
//     少一个文件、尺寸不对、被谁引用不到，都要点名。
// 纯 node + 自己读 PNG IHDR：CI 里没有 Pillow，闸不能因为缺库就跳过。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = [];
const ok = (test, detail = '') => rows.push({ test, pass: true, detail });
const bad = (test, detail) => rows.push({ test, pass: false, detail });
const rel = p => p.replace(/^\.\//, '').replace(/^\//, '');

/** 读 PNG 头部：签名 + IHDR 宽高 + bit depth/color type。非 PNG 直接返回 null。 */
function pngInfo(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25], bytes: buf.length };
}

// ---- 1) 工厂应有清单 ↔ 盘上实到 --------------------------------------------------
const gen = fs.readFileSync(path.join(ROOT, 'assets/gen/make_art.py'), 'utf8');
const block = /EXPECTED = \{([\s\S]*?)\n\}/.exec(gen);
if (!block) bad('assets::工厂声明了应有清单', 'assets/gen/make_art.py 里找不到 EXPECTED');
else {
  const want = [...block[1].matchAll(/'([^']+\.(?:png|webp|jpg))':\s*\{\s*'size':\s*\[(\d+),\s*(\d+)\]/g)]
    .map(m => ({ file: m[1], w: +m[2], h: +m[3] }));
  if (!want.length) bad('assets::清单可解析', 'EXPECTED 里一条尺寸都没解析出来');
  for (const e of want) {
    const f = path.join(ROOT, e.file);
    if (!fs.existsSync(f)) { bad(`assets::存在 ${e.file}`, '盘上没有'); continue; }
    const info = pngInfo(f);
    if (!info) { bad(`assets::真PNG ${e.file}`, '签名/IHDR 不对（SVG 冒充或截断）'); continue; }
    if (info.w !== e.w || info.h !== e.h) { bad(`assets::尺寸 ${e.file}`, `盘上 ${info.w}x${info.h}，清单 ${e.w}x${e.h}`); continue; }
    if (info.bytes < 400) { bad(`assets::非占位 ${e.file}`, `${info.bytes} 字节，不像一张真图`); continue; }
    ok(`assets::${e.file}`, `${info.w}x${info.h} ${info.bytes}B depth${info.bitDepth} ct${info.colorType}`);
  }
}

// ---- 2) 引用面：index.html / manifest / css 指到的每个位图都要在盘上 ---------------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/game.css'), 'utf8');
const manPath = path.join(ROOT, 'manifest.webmanifest');
const refs = new Set();
for (const m of html.matchAll(/(?:href|src|content)="([^"]+\.(?:png|webp|jpg))"/g)) refs.add(rel(m[1]));
for (const m of css.matchAll(/url\(['"]?([^'")]+\.(?:png|webp|jpg))['"]?\)/g)) {
  refs.add(rel(m[1]).replace(/^\.\.\//, ''));
}
let manifest = null;
if (fs.existsSync(manPath)) {
  try { manifest = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch (e) { bad('pwa::manifest 可解析', e.message); }
} else bad('pwa::manifest 存在', '盘上没有 manifest.webmanifest');
if (manifest) {
  for (const i of manifest.icons || []) refs.add(rel(i.src));
  if (manifest.picture) refs.add(rel(manifest.picture));
}
for (const r of refs) {
  const f = path.join(ROOT, r);
  const info = fs.existsSync(f) ? pngInfo(f) : null;
  if (!info) bad(`ref::盘上真有 ${r}`, fs.existsSync(f) ? '不是合法 PNG' : '文件不存在');
  else ok(`ref::盘上真有 ${r}`, `${info.w}x${info.h}`);
}
ok('ref::引用面清点', `index+css+manifest 共 ${refs.size} 个位图引用`);

// ---- 3) 可安装四件套（sellability 从"有 manifest 就算"改严之后的口径）--------------
if (manifest) {
  for (const k of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'background_color']) {
    (manifest[k] ? ok : bad)(`pwa::字段 ${k}`, `实到 ${JSON.stringify(manifest[k])}`);
  }
  const icons = (manifest.icons || []).map(i => ({ ...i, src: rel(i.src) }));
  const big = icons.filter(i => /\d+x\d+/.test(i.sizes || '') && +(/(\d+)x/.exec(i.sizes)[1]) >= 180);
  (big.length ? ok : bad)('pwa::有 ≥180 的图标', `icons ${icons.map(i => i.sizes).join(',')}`);
  const has192 = icons.some(i => i.sizes === '192x192'), has512 = icons.some(i => i.sizes === '512x512');
  (has192 && has512 ? ok : bad)('pwa::192 与 512 齐', `192=${has192} 512=${has512}`);
  (icons.some(i => /maskable/.test((i.purpose || '') + i.src)) ? ok : bad)('pwa::有 maskable');
  for (const i of icons) {
    const info = fs.existsSync(path.join(ROOT, i.src)) ? pngInfo(path.join(ROOT, i.src)) : null;
    const declared = /(\d+)x(\d+)/.exec(i.sizes || '');
    const match = info && declared && info.w === +declared[1] && info.h === +declared[2];
    (match ? ok : bad)(`pwa::图标字节 ${i.src}`, match ? `${info.w}x${info.h}` : `manifest 写 ${i.sizes}，盘上 ${info ? info.w + 'x' + info.h : '取不到'}`);
  }
}
const linkManifest = /<link[^>]+rel=["']?manifest["']?[^>]*>/i.test(html);
(!/apple-touch-icon/.test(html) || (html.match(/apple-touch-icon/g) || []).length > 1 ? ok : bad)('html::apple-touch-icon 只有一条', `${(html.match(/apple-touch-icon/g) || []).length} 条`);
(linkManifest ? ok : bad)('html::link rel=manifest');
(/viewport-fit=cover/.test(html) ? ok : bad)('html::viewport-fit=cover');
(/env\(safe-area-inset-/.test(css) ? ok : bad)('css::用了 env(safe-area-inset-*)');
(/prefers-reduced-motion/.test(css) ? ok : bad)('css::有 prefers-reduced-motion 分支');

const swPath = path.join(ROOT, 'sw.js');
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  const cacheLine = (sw.match(/(VERSION|CACHE)\s*=\s*[^\n]*/g) || []).join(' ; ');
  (/(VERSION|CACHE)\s*=\s*['"][^'"]*v\d/i.test(sw) ? ok : bad)('sw::cache 名带版本号', cacheLine);
  // 注册点单独一个文件：那里必须先看 protocol，否则 file:// 双击打开就是一页未捕获异常。
  const reg = fs.existsSync(path.join(ROOT, 'js/pwa-register.js')) ? fs.readFileSync(path.join(ROOT, 'js/pwa-register.js'), 'utf8') : '';
  (/serviceWorker\.register/.test(reg) && /protocol[\s\S]{0,200}?!==\s*['"]https?:['"]/.test(reg) && /catch\s*\(/.test(reg)
    ? ok : bad)('sw::file:// 下整段跳过注册且不抛未捕获异常',
    `register=${/serviceWorker\.register/.test(reg)} protocol=${/protocol[\s\S]{0,200}?!==\s*['"]https?:['"]/.test(reg)} catch=${/catch\s*\(/.test(reg)}`);
  (/network-first|网络优先/i.test(sw) && !/caches\.match[^;]*\)[\s\S]{0,80}?\.then\([\s\S]{0,40}?fetch\(\s*req/.test(sw)
    ? ok : bad)('sw::同源子资源不走 cache-first');
} else bad('sw::sw.js 存在', '盘上没有 sw.js ⇒ "可安装"是空壳');

// ---- 报告 ---------------------------------------------------------------------
const fail = rows.filter(r => !r.pass);
for (const r of fail) console.log(`FAIL ${r.test} :: ${r.detail}`);
console.log(`assets-test: ${rows.length - fail.length}/${rows.length} ok`);
if (!rows.length) { console.log('FAIL assets::NO CHECKS RUN'); process.exit(1); }
process.exit(fail.length ? 1 : 0);
