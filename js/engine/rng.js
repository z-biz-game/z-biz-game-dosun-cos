// 确定性随机源。引擎里**只**允许这一处熵源：
//   1) mulberry32 —— 纯整数运算（|0 / Math.imul / >>>），位级语义写进 ECMA-262，
//      node 与 V8-in-Chrome 逐位一致，也不依赖任何浮点超越函数。
//   2) shuffled / pick —— 一律 Fisher-Yates + 注入的 rnd。
// 为什么强调这条：只要有一次"在 sort 的比较函数里调 rnd"，同一颗种子在 node 和 Chrome
// 就能长出两张不同的盘（比较次数随排序实现走，稳定性救不回来），复现性当场作废。
// 反过来说，比较函数只要不掺随机数，V8 排序是否稳定都不影响结果。
// 这一条不是靠人盯：tools/golden-test.mjs 会静态扫引擎源码（不许出现 Math.random /
// Date.now / performance.now / 比较函数里的 rnd），并且拿固定种子重放整盘。

/** mulberry32：给定整数种子，返回一个消费 [0,1) 序列的确定性发生器。 */
export const mulberry = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

/** 等概率取一个元素（只在 rnd() ∈ [0,1) 的前提下成立）。 */
export const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];

/** Fisher-Yates（自尾向前），不改原数组。 */
export const shuffled = (a, rnd) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

/** FNV-1a 32 位：盘面指纹，给"同种子重放"的闸用。纯整数，跨引擎一致。 */
export const fnv1a = s => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
};
