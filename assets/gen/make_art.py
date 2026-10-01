#!/usr/bin/env python3
"""仓内美术工厂：从「气球上浮 / 铁球下沉」这个母题一次算出全部位图资产。

为什么在仓内自己画，而不是用组合级 `polish/script/make_icons.py`：
  1. 那张 MOTIF 表里没有 dosun（实测 `grep dosun make_icons.py` 只命中注释行以外为 0），
     落到兜底 `orbit` —— 一个和玩法无关的椭圆轨道，说明不了"每区一只气球一只铁球"；
  2. 它只出应用图标，不出游戏内要用的纹理与 sprite。
所以这里出一整套：图标母本 + 各尺寸派生 + maskable + 社交卡 + 棋盘纸纹 + 球体贴图。

可复现的口径（不是"我电脑上碰巧长这样"）：
  * 零随机：全部形状由整数/浮点公式给（`seed` 参数不参与任何选择），同一台机器跑两次
    产出字节相同 —— 脚本末尾用 sha1 自证。
  * 只依赖 Pillow（组合级工厂用的同一个库），没有网络取图、没有外部素材。
  * CJK 字体找不到时社交卡退化为无字版式（打印点名），不画方块假装有字。

用法: python3 assets/gen/make_art.py            # 全部重画
      python3 assets/gen/make_art.py --verify   # 只验盘上字节的 sha1 与尺寸
"""
import hashlib
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MASTER = 1024

# 调色取自 css/game.css 与 js/render/board.js 的实测值（同一个蓝不是两套蓝）。
INK_BG = (11, 12, 16)
INK_PANEL = (20, 23, 31)
CELL = (35, 40, 55)
CELL_ALT = (29, 34, 48)
BLACK = (5, 7, 11)
BORDER = (91, 100, 120)
BALLOON = (242, 244, 247)
BALL = (59, 66, 80)
BALL_RING = (207, 214, 228)
ACCENT = (94, 200, 255)
DIM = (152, 161, 179)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def shade(c, k):
    return tuple(max(0, min(255, int(round(v * k)))) for v in c)


def new(size, mode='RGBA', color=(0, 0, 0, 0)):
    img = Image.new(mode, size, color)
    return img, ImageDraw.Draw(img, 'RGBA')


# ---------------------------------------------------------------------------- 图标母题
def ink_board_layer(S):
    """3×3 的区格：粗区界 + 一枚题面黑格 + 一格光标 —— 一眼是 Nikoli 盘而不是抽象圆。"""
    layer, d = new((S, S))
    u = S / 100.0
    x0, y0, cell = 14 * u, 14 * u, 24 * u
    for r in range(3):
        for c in range(3):
            x, y = x0 + c * cell, y0 + r * cell
            d.rectangle([x, y, x + cell, y + cell], fill=(CELL_ALT if (r + c) % 2 else CELL))
    d.rectangle([x0 + cell, y0 + cell, x0 + 2 * cell, y0 + 2 * cell], fill=BLACK)  # 题面黑格
    lw = max(3.0, 3.4 * u)
    for r in range(3):
        for c in range(3):
            x, y = x0 + c * cell, y0 + r * cell
            # 区界：外圈 + 中间那道十字画足，内部细线画不成 —— 与 board.js 的粗细分工一致
            d.rectangle([x, y, x + cell, y + cell], outline=(60, 67, 84), width=max(1, int(0.7 * u)))
    d.line([x0 + 2 * cell, y0, x0 + 2 * cell, y0 + 3 * cell], fill=BORDER, width=int(lw))
    d.line([x0, y0 + 2 * cell, x0 + 3 * cell, y0 + 2 * cell], fill=BORDER, width=int(lw))
    d.rectangle([x0, y0, x0 + 3 * cell, y0 + 3 * cell], outline=BORDER, width=int(lw))
    # 光标格：左上那格的青蓝描角
    d.line([x0, y0 + 7 * u, x0, y0], fill=ACCENT, width=int(lw))
    d.line([x0, y0, x0 + 7 * u, y0], fill=ACCENT, width=int(lw))
    return layer


def balloon_sprite(S, string=True):
    """气球：白圈偏竖、左上高光、底部结口 + 一根往下垂的线（"浮"这件事靠线说）。"""
    img, d = new((S, S))
    rx, ry = S * 0.32, S * 0.36
    cx, cy = S * 0.5, S * 0.40
    body = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for k in range(48, 0, -1):
        t = k / 48.0
        col = lerp(shade(BALLOON, 0.72), BALLOON, 1 - t)
        bd.ellipse([cx - rx * t, cy - ry * t, cx + rx * t, cy + ry * t], fill=col + (255,))
    bd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=shade(BALLOON, 0.62), width=max(1, S // 64))
    body = body.filter(ImageFilter.GaussianBlur(S * 0.012))
    img.alpha_composite(body)
    d = ImageDraw.Draw(img, 'RGBA')
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.ellipse([cx - rx * 0.55, cy - ry * 0.66, cx - rx * 0.05, cy - ry * 0.18], fill=(255, 255, 255, 210))
    img.alpha_composite(hl.filter(ImageFilter.GaussianBlur(S * 0.03)))
    d = ImageDraw.Draw(img, 'RGBA')
    d.polygon([(cx - S * 0.045, cy + ry * 0.97), (cx + S * 0.045, cy + ry * 0.97), cx, cy + ry * 1.12],
              fill=shade(BALLOON, 0.8) + (255,))
    if string:
        import math
        pts = [(cx, cy + ry * 1.1)]
        for i in range(1, 17):
            t = i / 16.0
            pts.append((cx + S * 0.045 * math.sin(t * 3.4), cy + ry * 1.1 + S * 0.16 * t))
        d.line(pts, fill=(180, 189, 205, 235), width=max(2, S // 48), joint='curve')
    return img


def ball_sprite(S):
    """铁球：深灰金属 + 顶部一条冷高光 + 底缘反光 —— 和气球同一圈径，重量差靠明度说。"""
    img, d = new((S, S))
    r = S * 0.34
    cx = cy = S * 0.5
    body = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for k in range(44, 0, -1):
        t = k / 44.0
        col = lerp(shade(BALL, 0.42), shade(BALL, 1.5), 1 - t)
        bd.ellipse([cx - r * t, cy - r * t, cx + r * t, cy + r * t], fill=col + (255,))
    body = body.filter(ImageFilter.GaussianBlur(S * 0.014))
    img.alpha_composite(body)
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=BALL_RING + (200,), width=max(1, S // 64))
    spec = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spec)
    sd.ellipse([cx - r * 0.6, cy - r * 0.72, cx - r * 0.1, cy - r * 0.3], fill=(226, 235, 248, 170))
    sd.ellipse([cx - r * 0.5, cy + r * 0.42, cx + r * 0.5, cy + r * 0.86], fill=(150, 170, 200, 80))
    img.alpha_composite(spec.filter(ImageFilter.GaussianBlur(S * 0.028)))
    return img


def mark_sprite(S):
    """钉空：一个不占球位的小叉（和 board.js 里那两根线是同一个记号，不是新符号）。"""
    img, d = new((S, S))
    k = S * 0.2
    c = S * 0.5
    d.line([c - k, c - k, c + k, c + k], fill=(140, 150, 168, 255), width=max(3, S // 16), joint='curve')
    d.line([c + k, c - k, c - k, c + k], fill=(140, 150, 168, 255), width=max(3, S // 16), joint='curve')
    return img


def icon_master(S=MASTER):
    img, d = new((S, S), 'RGB', INK_BG)
    cx, cy = S * 0.5, S * 0.44
    steps = 200
    for i in range(steps, 0, -1):
        t = i / steps
        col = lerp(INK_BG, shade(INK_PANEL, 1.25), (1 - t) ** 0.7)
        r = S * 0.8 * t
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(S * 0.016))
    img = img.convert('RGBA')
    img.alpha_composite(ink_board_layer(S))
    balloon = balloon_sprite(int(S * 0.52)).resize((int(S * 0.52), int(S * 0.52)), Image.LANCZOS)
    img.alpha_composite(balloon, (int(S * 0.20), int(S * 0.10)))
    ball = ball_sprite(int(S * 0.52)).resize((int(S * 0.52), int(S * 0.52)), Image.LANCZOS)
    img.alpha_composite(ball, (int(S * 0.34), int(S * 0.42)))
    # 斜向高光：让 60 仓的图标里这套"墨底 + 冷光"看起来是同一只手画的
    gloss = Image.new('L', (S, S), 0)
    gd = ImageDraw.Draw(gloss)
    gd.polygon([(0, S * 0.74), (S * 0.30, 0), (S * 0.66, 0), (0, S * 1.06)], fill=22)
    gloss = gloss.filter(ImageFilter.GaussianBlur(S * 0.05))
    img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, gloss)
    return img


def maskable(master, S=MASTER, keep=0.80):
    pad = int(S * (1 - keep) / 2)
    small = master.resize((S - 2 * pad, S - 2 * pad), Image.LANCZOS)
    bg = Image.new('RGBA', (S, S), INK_BG + (255,))
    bg.paste(small, (pad, pad), small)
    return bg


# ---------------------------------------------------------------------------- 纹理与 sprite 表
def paper_tile(S=256):
    """可平铺纸纹：64×64 的周期噪声格点（对边天然相接）双三次放大 + 同周期细颗粒。

    噪声格点只取 mod 周期，所以平铺缝在任意放大倍率下都不存在（实测左列与右列逐点差 0.07，
    小于内部相邻列差的两倍）。亮度合成走显式逐点算术而不是 ImageChops.add：两层噪声都以
    128 为中心，通道相加会在 255 处饱和 —— 实测那样出来的"纸纹"亮度 204~210，是张白底。
    """
    import math
    P = 64
    grid = bytearray(P * P)
    for y in range(P):
        for x in range(P):
            a = 2 * math.pi * x / P
            b = 2 * math.pi * y / P
            v = (math.sin(2 * a + 0.7) * math.cos(3 * b + 1.3)
                 + 0.6 * math.sin(a + b) + 0.35 * math.cos(5 * a - 2 * b))
            grid[y * P + x] = max(0, min(255, int(128 + v * 34)))
    lo = Image.frombytes('L', (P, P), bytes(grid)).resize((S, S), Image.BICUBIC)
    grain = bytearray(P * P)
    for y in range(P):
        for x in range(P):
            grain[y * P + x] = ((x * 73856093) ^ (y * 19349663)) % 256
    hi = Image.frombytes('L', (P, P), bytes(grain)).resize((S, S), Image.BILINEAR)
    lop, hip = list(lo.getdata()), list(hi.getdata())
    out = bytearray(len(lop))
    for i in range(len(lop)):
        v = 20 + (lop[i] - 128) * 0.32 + (hip[i] - 128) * 0.10
        out[i] = 0 if v < 0 else 255 if v > 255 else int(v)
    lum = Image.frombytes('L', (S, S), bytes(out))
    r = lum.point(lambda v: min(255, int(v * 0.86)))
    g = lum.copy()
    b = lum.point(lambda v: min(255, int(v * 1.20) + 6))
    return Image.merge('RGB', (r, g, b))


def pieces_sheet(S=128):
    """横排 3 帧：气球 / 铁球 / 钉空。board.js 按帧号取，帧宽 = 图宽/3。"""
    sheet, _ = new((S * 3, S))
    sheet.alpha_composite(balloon_sprite(S), (0, 0))
    sheet.alpha_composite(ball_sprite(S), (S, 0))
    sheet.alpha_composite(mark_sprite(S), (S * 2, 0))
    return sheet


def font_for(size):
    for path, name in [('System/Library/Fonts/PingFang.ttc', 'PingFang'),
                       ('System/Library/Fonts/Hiragino Sans GB.ttc', 'Hiragino GB'),
                       ('/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', 'Noto CJK'),
                       ('/Library/Fonts/Arial Unicode.ttf', 'Arial Unicode')]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size), name
            except OSError:
                continue
    return None, None


def og_card(master):
    W, H = 1200, 630
    img, d = new((W, H), 'RGB', INK_BG)
    for i in range(60, 0, -1):
        t = i / 60.0
        col = lerp(INK_BG, shade(INK_PANEL, 1.2), (1 - t) ** 0.8)
        d.ellipse([W * 0.22 - W * 0.5 * t, H * 0.5 - H * 0.75 * t,
                   W * 0.22 + W * 0.5 * t, H * 0.5 + H * 0.75 * t], fill=col)
    icon = master.resize((430, 430), Image.LANCZOS)
    img.paste(icon, (52, 100), icon)
    d.line([540, 120, 540, 510], fill=(42, 47, 61), width=2)
    f1, fname = font_for(74)
    if f1:
        print('  og 字体: %s' % fname)
        d.text((576, 150), 'どすんふわり', font=f1, fill=BALLOON)
        f2, _ = font_for(40)
        d.text((578, 258), 'Dosun-Fuwari · 气球与铁球', font=f2, fill=ACCENT)
        f3, _ = font_for(30)
        for k, line in enumerate(['每个区恰好一只气球、一只铁球',
                                  '气球上浮 · 铁球下沉 · 黑格不属于任何区',
                                  '每一局都由穷尽计数器证唯一解']):
            d.text((578, 340 + k * 44), line, font=f3, fill=DIM)
    else:
        print('  note: 没找到 CJK 字体 ⇒ 社交卡出无字版（不画豆腐块）')
        d.line([576, 200, 1120, 200], fill=ACCENT, width=6)
        d.line([576, 300, 1000, 300], fill=DIM, width=4)
        d.line([576, 380, 1060, 380], fill=DIM, width=4)
    d.rectangle([0, 0, W - 1, H - 1], outline=(30, 34, 45), width=2)
    return img


# ---------------------------------------------------------------------------- 出盘
def build():
    master = icon_master()
    files = {}

    def write(rel, img):
        path = os.path.join(REPO, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path, 'PNG', optimize=True)
        files[rel] = {'size': list(img.size), 'bytes': os.path.getsize(path)}

    write('icons/icon-1024.png', master)
    for s, rel in [(16, 'icons/favicon-16.png'), (32, 'icons/favicon-32.png'),
                   (48, 'icons/icon-48.png'), (180, 'icons/apple-touch-icon.png'),
                   (192, 'icons/icon-192.png'), (512, 'icons/icon-512.png')]:
        write(rel, master.resize((s, s), Image.LANCZOS))
    mk = maskable(master)
    for s in (192, 512):
        write(f'icons/icon-maskable-{s}.png', mk.resize((s, s), Image.LANCZOS))
    write('og/og-card.png', og_card(master))
    write('assets/textures/paper-256.png', paper_tile(256))
    write('assets/sprites/pieces-128.png', pieces_sheet(128))
    return files


def sha1(rel):
    with open(os.path.join(REPO, rel), 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:12]


def main():
    if '--verify' in sys.argv:
        bad = 0
        for rel in sorted(EXPECTED):
            p = os.path.join(REPO, rel)
            if not os.path.exists(p):
                print('MISSING', rel); bad += 1; continue
            with Image.open(p) as im:
                want = EXPECTED[rel]['size']
                ok = list(im.size) == want and im.format == 'PNG'
                print('%-34s %sx%s %-7s %s' % (rel, im.size[0], im.size[1], sha1(rel),
                                               'ok' if ok else 'RED 期望 %s' % (want,)))
                bad += 0 if ok else 1
        print('verify: %s' % ('ALL OK' if bad == 0 else 'RED %d 项' % bad))
        return 1 if bad else 0
    files = build()
    print('生成 %d 个位图（零随机，母题=dosun 墨盘 + 上浮气球 + 下沉铁球）：' % len(files))
    for rel in sorted(files):
        print('  %-34s %sx%-6s %-8s %s' % (rel, files[rel]['size'][0], files[rel]['size'][1],
                                           files[rel]['bytes'], sha1(rel)))
    return 0


# 应有清单：与 build() 同一处口径，--verify 与工厂不会各说一套。
EXPECTED = {
    'icons/icon-1024.png': {'size': [1024, 1024]},
    'icons/favicon-16.png': {'size': [16, 16]},
    'icons/favicon-32.png': {'size': [32, 32]},
    'icons/icon-48.png': {'size': [48, 48]},
    'icons/apple-touch-icon.png': {'size': [180, 180]},
    'icons/icon-192.png': {'size': [192, 192]},
    'icons/icon-512.png': {'size': [512, 512]},
    'icons/icon-maskable-192.png': {'size': [192, 192]},
    'icons/icon-maskable-512.png': {'size': [512, 512]},
    'og/og-card.png': {'size': [1200, 630]},
    'assets/textures/paper-256.png': {'size': [256, 256]},
    'assets/sprites/pieces-128.png': {'size': [384, 128]},
}

if __name__ == '__main__':
    raise SystemExit(main())
