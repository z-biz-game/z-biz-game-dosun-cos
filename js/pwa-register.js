'use strict';
// PWA 注册单独一个文件：不动 js/main.js 的任何接线，也不假设运行环境有 navigator。
//
// 三条边界都是实测过的坑：
//  * file:// 下打开（把仓 clone 下来双击 index.html）时注册 service worker 会抛
//    NotSupportedError —— 那是不支持，不是坏了，所以整段跳过且不留未捕获异常。
//  * 只在 http/https 注册；本地 127.0.0.1 也算 http，闸与开发都吃这一条。
//  * 注册失败不能影响游戏：整个 IIFE 自己 catch 掉，页面照常可玩。
(function () {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  var proto = typeof location !== 'undefined' ? location.protocol : '';
  if (proto !== 'http:' && proto !== 'https:') return;
  if (typeof window === 'undefined' || window.__dosunNoSW) return;
  // sw.js 与页面同源，且路径要跟着 Pages 的子目录前缀走 ⇒ 相对当前文档解析。
  var base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : './';
  var url = new URL('sw.js', base).href;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register(url, { scope: new URL('./', base).pathname }).catch(function () {
      /* 注册不上（无 SW 支持/被策略拒绝）只是少了离线能力，不当错误抛 */
    });
  });
})();
