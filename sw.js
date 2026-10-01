'use strict';
// Service worker：network-first，断网才回落到上次成功抓取的资源。
//
// 为什么不是 cache-first（本仓踩过的那次教训）：手工 VERSION 号 + cache-first 会把
// js/css 永久钉死在旧版 —— 出新 HTML 配旧 JS 的鬼状态，页面看着"装上了"其实跑的是上一次的代码。
// 这里每个同源 GET 都先问网络，命中就顺手回填；只有网络失败（离线/断网）才读缓存。
// 缓存名单独带版本号：改协议时把 VERSION 提一位，activate 里清掉不属于本版本的旧壳。
const VERSION = 'dosun-v0.3.0';
const CACHE = 'dosun-shell-' + VERSION;
const SHELL = ['./', './index.html', './css/game.css', './js/main.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './assets/textures/paper-256.png', './assets/sprites/pieces-128.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，离线时回落到缓存里的 shell（Pages 的前缀形态与本地根形态同一条路）。
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }

  e.respondWith(fetch(req).then(res => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req)));
});
