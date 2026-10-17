#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_placeholders.py — Phoebe 粉絲網站「示範相簿」插圖產生器
============================================================
15 張 1200x900 (4:3) 手繪繪本風 / 粉彩 / 圓潤的示範照片，角色 Phoebe
（assets/img/phoebe/phoebe.png）合成進每個場景，附橢圓地面陰影。

* 只用本機 Pillow + numpy + scipy（系統 python3）。
* 全部固定 seed，可重跑，輸出位元組穩定。
* 圖片內沒有任何文字（標題由 HTML 負責）。
* 輸出：assets/img/gallery/*.jpg（JPEG q=88, sRGB）
* QA：tools/contact_sheet.jpg（4 欄）＋ tools/build_report.txt

用法：
    python3 tools/make_placeholders.py                # 產生全部 15 張 + 檢查表
    python3 tools/make_placeholders.py --only tokyo   # 只跑符合檔名片段的場景
    python3 tools/make_placeholders.py --no-sheet     # 不產 contact sheet
"""

from __future__ import annotations

import argparse
import base64
import math
import os
import random
import sys
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageCms

try:
    from scipy import ndimage  # noqa: F401  (scipy 已在環境中，保留檢查用)
except Exception:  # pragma: no cover
    pass

# ---------------------------------------------------------------------------
# 基本設定
# ---------------------------------------------------------------------------
BASE_W, BASE_H = 1200, 900          # 最終輸出尺寸 (4:3)
SS = 2                              # 超取樣倍率（2400x1800 作畫，最後縮小）
SW, SH = BASE_W * SS, BASE_H * SS

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
GALLERY = os.path.join(PROJECT, "assets", "img", "gallery")
PHOEBE = os.path.join(PROJECT, "assets", "img", "phoebe", "phoebe.png")
SHEET = os.path.join(HERE, "contact_sheet.jpg")
REPORT = os.path.join(HERE, "build_report.txt")

# 固定 sRGB ICC（Pillow 即時建立的 profile 會寫入當下時間，破壞可重現性，
# 因此把標準 sRGB profile 的位元組固定在腳本裡）
SRGB_ICC = base64.b64decode(
    "AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACgARAA0AOQARYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c"
)

# 網站主色
CREAM = (255, 248, 231)      # 奶油
PAPER = (255, 251, 242)      # 紙白
BUTTER = (248, 227, 155)     # 奶油黃
GOLD = (239, 207, 105)       # 金
SKY = (140, 207, 234)        # 天空藍
NAVY = (59, 74, 107)         # 深藍
LAV = (183, 166, 230)        # 薰衣草紫
PINK = (248, 185, 203)       # 粉
INK = (74, 58, 50)           # 墨棕

# 由主色延伸的粉彩（保持同一家族）
SKY_DEEP = (104, 172, 216)
LAV_DEEP = (137, 118, 191)
NAVY_SOFT = (96, 112, 148)
PEACH = (255, 205, 177)
CORAL = (240, 150, 132)
ROSE = (224, 132, 160)
SAGE = (168, 202, 168)
MINT = (186, 221, 203)
SAND = (245, 226, 188)
WOOD = (196, 158, 116)
BROWN = (139, 106, 84)
WHITE_WARM = (255, 252, 244)

# 金色畫框
FRAME_INSET = 24.0      # 畫框外緣距畫布邊
FRAME_BAND = 34.0       # 畫框帶寬
FRAME_INNER = FRAME_INSET + FRAME_BAND   # 畫面可見區距邊 = 54


# ---------------------------------------------------------------------------
# 座標 / 顏色工具
# ---------------------------------------------------------------------------
def px(v: float) -> int:
    return int(round(float(v) * SS))


def mix(a, b, t: float):
    t = max(0.0, min(1.0, float(t)))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def lighten(c, t: float):
    return mix(c, (255, 255, 255), t)


def darken(c, t: float):
    return mix(c, (36, 30, 28), t)


def fc(c):
    """RGB(A) → 保證 4-tuple。"""
    if c is None:
        return None
    if len(c) == 4:
        return c
    return (int(c[0]), int(c[1]), int(c[2]), 255)


def new_layer() -> Image.Image:
    return Image.new("RGBA", (SW, SH), (0, 0, 0, 0))


def set_alpha(lay: Image.Image, a: int) -> None:
    a = int(max(0, min(255, a)))
    if a >= 255:
        return
    lay.putalpha(lay.getchannel("A").point(lambda v: v * a // 255))


def put(im: Image.Image, lay: Image.Image, blur: float = 0.0, alpha: int = 255) -> None:
    """把圖層疊上；blur / alpha 以 base 單位與 0-255 表示。"""
    if blur > 0:
        lay = lay.filter(ImageFilter.GaussianBlur(blur * SS))
    if alpha < 255:
        set_alpha(lay, alpha)
    im.alpha_composite(lay)


# ---------------------------------------------------------------------------
# 幾何工具（全部使用 base 座標）
# ---------------------------------------------------------------------------
def qbez(p0, p1, p2, n: int = 16):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        out.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return out


def cbez(p0, p1, p2, p3, n: int = 24):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


def catmull_rom(pts, samples: int = 12, closed: bool = False):
    pts = np.asarray([(float(x), float(y)) for x, y in pts], dtype=np.float64)
    if len(pts) < 3:
        return [(float(x), float(y)) for x, y in pts]
    if closed:
        P = np.vstack([pts[-1], pts, pts[0], pts[1]])
    else:
        P = np.vstack([pts[0], pts, pts[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for j in range(samples):
            t = j / samples
            t2, t3 = t * t, t * t * t
            p = 0.5 * ((2 * p1) + (-p0 + p2) * t +
                       (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                       (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append((float(p[0]), float(p[1])))
    out.append((float(P[-2][0]), float(P[-2][1])))
    return out


def star_pts(cx, cy, r, inner=0.38, n=5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        rad = r if i % 2 == 0 else r * inner
        ang = rot + i * math.pi / n
        pts.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad))
    return pts


# ---------------------------------------------------------------------------
# 繪圖基本元件
# ---------------------------------------------------------------------------
def ell(lay, cx, cy, rx, ry, fill=None, outline=None, width=1.0):
    d = ImageDraw.Draw(lay)
    box = [px(cx - rx), px(cy - ry), px(cx + rx), px(cy + ry)]
    d.ellipse(box,
              fill=fc(fill) if fill is not None else None,
              outline=fc(outline) if outline is not None else None,
              width=max(1, px(width)) if outline is not None else 0)


def rect(lay, x0, y0, x1, y1, fill=None, outline=None, width=1.0):
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    d = ImageDraw.Draw(lay)
    d.rectangle([px(x0), px(y0), px(x1), px(y1)],
                fill=fc(fill) if fill is not None else None,
                outline=fc(outline) if outline is not None else None,
                width=max(1, px(width)) if outline is not None else 0)


def rrect(lay, x0, y0, x1, y1, r, fill=None, outline=None, width=1.0):
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle([px(x0), px(y0), px(x1), px(y1)], radius=max(1, px(r)),
                        fill=fc(fill) if fill is not None else None,
                        outline=fc(outline) if outline is not None else None,
                        width=max(1, px(width)) if outline is not None else 0)


def poly(lay, pts, fill=None, outline=None, width=1.0):
    pts = [(float(x), float(y)) for x, y in pts]
    if len(pts) < 2:
        return
    d = ImageDraw.Draw(lay)
    pp = [(x * SS, y * SS) for x, y in pts]
    if fill is not None:
        d.polygon(pp, fill=fc(fill))
    if outline is not None and len(pts) >= 3:
        d.line(pp + [pp[0]], fill=fc(outline), width=max(1, px(width)), joint="curve")


def smooth_poly(lay, pts, fill=None, outline=None, width=1.0, samples=10, closed=True):
    sm = catmull_rom(pts, samples, closed=closed) if len(pts) >= 3 else pts
    poly(lay, sm, fill, outline, width)


def dot(lay, cx, cy, r, color):
    ell(lay, cx, cy, r, r, color)


def stroke(lay, pts, color, width=2.0, caps=True, smooth=False, samples=10):
    pts = [(float(x), float(y)) for x, y in pts]
    if len(pts) < 2:
        return
    if smooth and len(pts) >= 3:
        pts = catmull_rom(pts, samples)
    d = ImageDraw.Draw(lay)
    pp = [(x * SS, y * SS) for x, y in pts]
    d.line(pp, fill=fc(color), width=max(1, px(width)), joint="curve")
    if caps:
        r = width / 2.0
        for x, y in (pts[0], pts[-1]):
            if r > 0.25:
                ell(lay, x, y, r, r, color)


def taper(lay, pts, w0, w1, color, smooth=True, samples=10):
    """寬度漸變的筆觸（樹枝、棕櫚葉、螺旋、裝飾線）。"""
    pts = [(float(x), float(y)) for x, y in pts]
    if len(pts) == 1:
        dot(lay, pts[0][0], pts[0][1], w0 / 2.0, color)
        return
    if len(pts) < 2:
        return
    if smooth and len(pts) >= 3:
        pts = catmull_rom(pts, samples)
    a = np.asarray(pts, dtype=np.float64)
    d = np.gradient(a, axis=0)
    n = np.stack([-d[:, 1], d[:, 0]], axis=1)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.maximum(ln, 1e-9)
    ws = np.linspace(float(w0), float(w1), len(a)) * 0.5
    left = a + n * ws[:, None]
    right = a - n * ws[:, None]
    shape = np.vstack([left, right[::-1]])
    pp = [(float(x) * SS, float(y) * SS) for x, y in shape]
    ImageDraw.Draw(lay).polygon(pp, fill=fc(color))
    for (cx, cy), w in ((pts[0], w0), (pts[-1], w1)):
        if w > 0.3:
            ell(lay, cx, cy, w / 2.0, w / 2.0, color)


# ---------------------------------------------------------------------------
# 背景 / 光 / 大氣
# ---------------------------------------------------------------------------
def grad_bg(stops, horizontal=False, nrng=None):
    n = SW if horizontal else SH
    pos = np.array([s[0] for s in stops], dtype=np.float64)
    cols = np.array([s[1] for s in stops], dtype=np.float64)
    xs = np.linspace(0.0, 1.0, n)
    g = np.stack([np.interp(xs, pos, cols[:, i]) for i in range(3)], axis=1)
    if horizontal:
        arr = np.repeat(g[None, :, :], SH, axis=0)
    else:
        arr = np.repeat(g[:, None, :], SW, axis=1)
    arr = arr.astype(np.float32)
    if nrng is not None:
        arr += nrng.normal(0.0, 0.55, arr.shape).astype(np.float32)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


XX = np.tile(np.arange(SW, dtype=np.float32), (SH, 1))
YY = np.repeat(np.arange(SH, dtype=np.float32)[:, None], SW, axis=1)


def glow(im, cx, cy, rx, ry, color, alpha=110, power=2.2):
    if alpha <= 0:
        return
    d = np.sqrt(((XX - cx * SS) / max(rx * SS, 1e-6)) ** 2 +
                ((YY - cy * SS) / max(ry * SS, 1e-6)) ** 2)
    a = (np.clip(1.0 - d, 0.0, 1.0) ** power * alpha).astype(np.uint8)
    arr = np.empty((SH, SW, 4), dtype=np.uint8)
    arr[..., 0] = color[0]
    arr[..., 1] = color[1]
    arr[..., 2] = color[2]
    arr[..., 3] = a
    im.alpha_composite(Image.fromarray(arr, "RGBA"))


def haze(im, cy, half_h, color, alpha=70):
    lay = new_layer()
    rect(lay, -20, cy - half_h, BASE_W + 20, cy + half_h, color)
    lay = lay.filter(ImageFilter.GaussianBlur(max(1.0, half_h * SS * 0.45)))
    set_alpha(lay, alpha)
    im.alpha_composite(lay)


def hills(im, rng, y_base, amp, color, alpha=255, waves=3, blur=0.0,
          x0=-80, x1=BASE_W + 80, down=True):
    xs = np.linspace(x0, x1, 260)
    y = np.full_like(xs, float(y_base))
    for k in range(waves):
        wl = rng.uniform(260, 720)
        ph = rng.uniform(0, math.tau)
        a = amp * rng.uniform(0.35, 1.0) / (k + 1)
        y = y - a * (0.5 + 0.5 * np.sin(2 * math.pi * xs / wl + ph))
    pts = [(float(a), float(b)) for a, b in zip(xs, y)]
    if down:
        pts += [(x1, BASE_H + 80), (x0, BASE_H + 80)]
    lay = new_layer()
    poly(lay, pts, color)
    if blur > 0:
        lay = lay.filter(ImageFilter.GaussianBlur(blur * SS))
    set_alpha(lay, alpha)
    im.alpha_composite(lay)


def cloud(im, rng, cx, cy, w, h, color=WHITE_WARM, shade=None, alpha=232,
          blur=1.8, flat=0.42, n=None):
    shade = shade if shade is not None else (236, 212, 226)
    main, sh, hi = new_layer(), new_layer(), new_layer()
    n = n if n is not None else rng.randint(4, 6)
    for i in range(n):
        t = (i + 0.5) / n
        ex = cx + (t - 0.5) * w * 0.9 + rng.uniform(-0.02, 0.02) * w
        lift = math.sin(t * math.pi)
        ey = cy - lift * h * 0.22
        rx = w * (0.16 + 0.13 * lift) * rng.uniform(0.9, 1.15)
        ry = rx * rng.uniform(0.66, 0.82)
        ell(sh, ex, ey + h * 0.08, rx, ry, shade)
        ell(main, ex, ey, rx, ry, color)
        ell(hi, ex, ey - h * 0.055, rx * 0.78, ry * 0.58, lighten(color, 0.32))
    base = cy + h * flat
    out = []
    for lay in (sh, main, hi):
        a = np.asarray(lay.getchannel("A")).astype(np.float32)
        a *= np.clip((base * SS - YY) / (4.0 * SS), 0.0, 1.0)
        lay.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
        out.append(lay)
    for lay, factor in ((out[0], 0.58), (out[1], 1.0), (out[2], 0.45)):
        lay = lay.filter(ImageFilter.GaussianBlur(blur * SS))
        set_alpha(lay, int(alpha * factor))
        im.alpha_composite(lay)


def birds(im, rng, n, x0, x1, y0, y1, color, size=8.0, alpha=210):
    lay = new_layer()
    for _ in range(n):
        x = rng.uniform(x0, x1)
        y = rng.uniform(y0, y1)
        s = size * rng.uniform(0.65, 1.25)
        for side in (-1, 1):
            pts = cbez((x, y), (x + side * s * 0.9, y - s * 0.95),
                       (x + side * s * 1.7, y - s * 0.7), (x + side * s * 2.3, y - s * 0.15), 12)
            taper(lay, pts, s * 0.30, s * 0.05, color, smooth=False)
    put(im, lay, blur=0.4, alpha=alpha)


# ---------------------------------------------------------------------------
# 角色合成
# ---------------------------------------------------------------------------
@dataclass
class Slot:
    x: float
    ground: float
    h_frac: float
    flip: bool = False
    shadow: tuple = (112, 96, 108)
    shadow_dx: float = -0.04
    glow: tuple | None = None
    pool: tuple | None = None
    gain: tuple = (1.0, 1.0, 1.0)
    sat: float = 1.0
    frame: bool = False
    metrics: dict = field(default_factory=dict)


_CHAR = None


def load_char() -> Image.Image:
    global _CHAR
    if _CHAR is None:
        im = Image.open(PHOEBE).convert("RGBA")
        a = np.asarray(im.getchannel("A"))
        ys, xs = np.where(a > 10)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        im = im.crop((max(0, x0 - 2), max(0, y0 - 2),
                      min(im.width, x1 + 3), min(im.height, y1 + 3)))
        _CHAR = im
    return _CHAR


def grade_rgba(img: Image.Image, gain=(1.0, 1.0, 1.0), sat=1.0) -> Image.Image:
    arr = np.asarray(img).astype(np.float32)
    rgb = arr[..., :3]
    if sat != 1.0:
        g = rgb.mean(axis=2, keepdims=True)
        rgb = g + (rgb - g) * sat
    rgb = rgb * np.asarray(gain, dtype=np.float32)
    arr[..., :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def _shadow_img(cx, cy, rx, ry, color, amp, power=1.6):
    d = np.sqrt(((XX - cx * SS) / max(rx * SS, 1e-6)) ** 2 +
                ((YY - cy * SS) / max(ry * SS, 1e-6)) ** 2)
    a = (np.clip(1.0 - d, 0.0, 1.0) ** power * amp).astype(np.uint8)
    arr = np.empty((SH, SW, 4), dtype=np.uint8)
    arr[..., 0] = color[0]
    arr[..., 1] = color[1]
    arr[..., 2] = color[2]
    arr[..., 3] = a
    return Image.fromarray(arr, "RGBA")


def draw_character(im: Image.Image, slot: Slot) -> None:
    char = load_char()
    cw, ch = char.size
    target_h = slot.h_frac * BASE_H
    k = target_h / ch
    dw = cw * k
    left = slot.x - dw / 2.0
    top = slot.ground - target_h

    if slot.glow is not None:
        gcol, galpha = slot.glow
        glow(im, slot.x, slot.ground - target_h * 0.56, dw * 0.86, target_h * 0.68,
             gcol, galpha, 1.9)
    if slot.pool is not None:
        pcol, palpha = slot.pool
        im.alpha_composite(_shadow_img(slot.x, slot.ground + dw * 0.015,
                                       dw * 0.52, dw * 0.14, pcol, palpha, 1.15))

    scx = slot.x + slot.shadow_dx * dw
    if slot.shadow is not None:
        # 大面積柔和投影
        im.alpha_composite(_shadow_img(scx, slot.ground - dw * 0.012,
                                       dw * 0.50, dw * 0.135, slot.shadow, 62))
        # 腳下接觸陰影
        im.alpha_composite(_shadow_img(scx + dw * 0.015, slot.ground - dw * 0.004,
                                       dw * 0.33, dw * 0.082, slot.shadow, 122))
        # 極近接觸
        im.alpha_composite(_shadow_img(scx + dw * 0.018, slot.ground - dw * 0.001,
                                       dw * 0.21, dw * 0.032, slot.shadow, 160))

    ch_img = grade_rgba(char, slot.gain, slot.sat)
    if slot.flip:
        ch_img = ch_img.transpose(Image.FLIP_LEFT_RIGHT)
    ch_img = ch_img.resize((max(1, px(dw)), max(1, px(target_h))), Image.LANCZOS)
    im.alpha_composite(ch_img, (px(left), px(top)))

    slot.metrics = {
        "x": slot.x, "left": left, "right": left + dw, "top": top,
        "bottom": slot.ground, "h_ratio": slot.h_frac, "w_base": dw,
    }


# ---------------------------------------------------------------------------
# 場景小道具
# ---------------------------------------------------------------------------
def grass_tuft(lay, rng, x, y, h, color, n=5):
    for _ in range(n):
        dx = rng.uniform(-h * 0.55, h * 0.55)
        tipx = x + dx
        tipy = y - h * rng.uniform(0.55, 1.0)
        pts = cbez((x, y), (x + dx * 0.15, y - h * 0.3),
                   (tipx, y - h * 0.62), (tipx, tipy), 10)
        taper(lay, pts, 2.4, 0.35, color, smooth=False)


def petal_points(x, y, length, width, rot):
    w = width / 2.0
    l = length
    local = []
    local += qbez((0, 0), (-w, -l * 0.42), (-w * 0.62, -l * 0.86), 8)
    local += qbez((-w * 0.62, -l * 0.86), (-w * 0.30, -l * 1.02), (0, -l * 0.84), 6)
    local += qbez((0, -l * 0.84), (w * 0.30, -l * 1.02), (w * 0.62, -l * 0.86), 6)
    local += qbez((w * 0.62, -l * 0.86), (w, -l * 0.42), (0, 0), 8)
    ca, sa = math.cos(rot), math.sin(rot)
    return [(x + lx * ca - ly * sa, y + lx * sa + ly * ca) for lx, ly in local]


def petal_rain(im, rng, n, x0, x1, y0, y1, colors, size=(7, 15), alpha=235,
               blur=0.0, outline=None):
    lay = new_layer()
    for _ in range(n):
        x = rng.uniform(x0, x1)
        y = rng.uniform(y0, y1)
        s = rng.uniform(*size)
        pts = petal_points(x, y, s, s * 0.62, rng.uniform(0, math.tau))
        poly(lay, pts, rng.choice(colors), outline, 0.6 if outline else 0)
    put(im, lay, blur=blur, alpha=alpha)


def blossom_cluster(lay, rng, cx, cy, r, colors, n=13, blur=0.0):
    for _ in range(n):
        ang = rng.uniform(0, math.tau)
        dist = rng.uniform(0, r) * rng.uniform(0.35, 1.0) ** 0.5
        x = cx + math.cos(ang) * dist
        y = cy + math.sin(ang) * dist * 0.78
        rr = rng.uniform(r * 0.16, r * 0.30)
        ell(lay, x, y, rr, rr * rng.uniform(0.85, 1.05), rng.choice(colors))
    for _ in range(n // 4):
        ang = rng.uniform(0, math.tau)
        dist = rng.uniform(0, r * 0.8)
        dot(lay, cx + math.cos(ang) * dist, cy + math.sin(ang) * dist * 0.7,
            rng.uniform(1.2, 2.4), lighten(colors[0], 0.55))


def cherry_tree(lay, rng, base_x, base_y, h, trunk, colors, spread=1.0, alpha=255):
    lean = 0.07 * spread
    main = cbez((base_x, base_y), (base_x - h * 0.02, base_y - h * 0.30),
                (base_x + h * lean, base_y - h * 0.56),
                (base_x + h * (lean + 0.06), base_y - h * 0.72), 30)
    taper(lay, main, h * 0.064, h * 0.016, trunk)
    top = main[-1]
    branches = [
        ((base_x + h * 0.01, base_y - h * 0.40), (base_x - h * 0.13, base_y - h * 0.52),
         (base_x - h * 0.23, base_y - h * 0.62), h * 0.030, h * 0.007),
        ((base_x + h * 0.03, base_y - h * 0.52), (base_x - h * 0.06, base_y - h * 0.66),
         (base_x - h * 0.16, base_y - h * 0.72), h * 0.024, h * 0.005),
        ((base_x + h * 0.05, base_y - h * 0.60), (base_x + h * 0.12, base_y - h * 0.70),
         (base_x + h * 0.21, base_y - h * 0.76), h * 0.020, h * 0.005),
        ((base_x + h * 0.06, base_y - h * 0.66), (base_x + h * 0.16, base_y - h * 0.74),
         (base_x + h * 0.29, base_y - h * 0.72), h * 0.016, h * 0.004),
        (top, (top[0] + h * 0.10, top[1] - h * 0.02),
         (top[0] + h * 0.21, top[1] - h * 0.02), h * 0.018, h * 0.004),
        (top, (top[0] + h * 0.03, top[1] - h * 0.10),
         (top[0] + h * 0.13, top[1] - h * 0.16), h * 0.014, h * 0.003),
    ]
    for p0, p1, p2, w0, w1 in branches:
        pts = cbez(p0, p1, p2, p2, 18)
        taper(lay, pts, w0, w1, trunk)
        mid = pts[len(pts) // 2]
        twig = cbez(mid, (mid[0] + h * 0.05, mid[1] - h * 0.03),
                    (mid[0] + h * 0.09, mid[1] - h * 0.08),
                    (mid[0] + h * 0.12, mid[1] - h * 0.10), 12)
        taper(lay, twig, w0 * 0.35, w1 * 0.4, trunk)
    clusters = [
        (top[0] + h * 0.17, top[1] - h * 0.03, h * 0.155),
        (top[0] + h * 0.03, top[1] - h * 0.10, h * 0.140),
        (top[0] - h * 0.12, top[1] + h * 0.04, h * 0.115),
        (top[0] + h * 0.29, top[1] - h * 0.01, h * 0.120),
        (base_x - h * 0.21, base_y - h * 0.65, h * 0.130),
        (base_x - h * 0.09, base_y - h * 0.56, h * 0.110),
        (base_x + h * 0.23, base_y - h * 0.73, h * 0.120),
        (top[0] + h * 0.12, top[1] - h * 0.17, h * 0.100),
    ]
    for cx, cy, r in clusters:
        blossom_cluster(lay, rng, cx, cy, r, colors, n=28)


def torii(lay, cx, base_y, w, h, color, dark):
    for s in (-1, 1):
        x0 = cx + s * w * 0.30
        taper(lay, [(x0 + s * w * 0.012, base_y), (x0, base_y - h * 0.84)],
              w * 0.075, w * 0.062, color, smooth=False)
        rect(lay, x0 - w * 0.055, base_y - w * 0.02, x0 + w * 0.055, base_y, dark)
    top = catmull_rom([(cx - w * 0.62, base_y - h * 0.86),
                       (cx - w * 0.34, base_y - h * 0.915),
                       (cx, base_y - h * 0.93),
                       (cx + w * 0.34, base_y - h * 0.915),
                       (cx + w * 0.62, base_y - h * 0.86)], 14)
    lower = [(x, y + h * 0.055) for x, y in top]
    poly(lay, top + lower[::-1], color)
    beam = cbez((cx - w * 0.42, base_y - h * 0.66), (cx - w * 0.12, base_y - h * 0.685),
                (cx + w * 0.12, base_y - h * 0.685), (cx + w * 0.42, base_y - h * 0.66), 20)
    stroke(lay, beam, color, h * 0.045)
    rect(lay, cx - w * 0.028, base_y - h * 0.865, cx + w * 0.028, base_y - h * 0.67, color)
    rect(lay, cx - w * 0.05, base_y - h * 0.63, cx + w * 0.05, base_y - h * 0.60, color)


def pagoda(lay, cx, base_y, h, color):
    tiers = 5
    w0 = h * 0.30
    for i in range(tiers):
        t = i / (tiers - 1)
        by = base_y - h * (0.13 + 0.80 * t)
        bw = w0 * (1 - 0.52 * t)
        body_h = h * 0.10
        rect(lay, cx - bw * 0.34, by - body_h, cx + bw * 0.34, by, color)
        roof = catmull_rom([
            (cx - bw * 0.72, by - body_h * 0.90),
            (cx - bw * 0.56, by - body_h * 1.02),
            (cx - bw * 0.18, by - body_h * 1.24),
            (cx + bw * 0.18, by - body_h * 1.24),
            (cx + bw * 0.56, by - body_h * 1.02),
            (cx + bw * 0.72, by - body_h * 0.90),
            (cx + bw * 0.60, by - body_h * 0.80),
            (cx - bw * 0.60, by - body_h * 0.80)], 10, closed=False)
        poly(lay, roof + [(cx - bw * 0.72, by - body_h * 0.90)], color)
        # 窗
        rect(lay, cx - bw * 0.10, by - body_h * 0.72, cx + bw * 0.10, by - body_h * 0.24, lighten(color, 0.18))
    taper(lay, [(cx, base_y - h * 0.93), (cx, base_y - h * 1.0)], h * 0.014, h * 0.003, color, smooth=False)


# ---------------------------------------------------------------------------
# 梵谷夜空元件
# ---------------------------------------------------------------------------
def brush_field(im, rng, n, xr, yr, colors, w=(4, 12), l=(35, 100),
                curve=14.0, alpha=255, angle_center=0.0, angle_spread=0.5,
                blur=0.5):
    lay = new_layer()
    for _ in range(n):
        x = rng.uniform(*xr)
        y = rng.uniform(*yr)
        length = rng.uniform(*l)
        ang = angle_center + rng.uniform(-angle_spread, angle_spread)
        dx = math.cos(ang) * length
        dy = math.sin(ang) * length * 0.42
        p0 = (x, y)
        p2 = (x + dx, y + dy)
        p1 = (x + dx * 0.5 + rng.uniform(-curve, curve),
              y + dy * 0.5 + rng.uniform(-curve, curve))
        taper(lay, qbez(p0, p1, p2, 8), rng.uniform(*w), rng.uniform(0.8, 2.0),
              rng.choice(colors), smooth=False)
    put(im, lay, blur=blur, alpha=alpha)


def swirl(im, rng, cx, cy, r0, r1, turns=1.9, arms=2,
          halo=(92, 130, 172), main=(240, 224, 160), hi=(255, 248, 208)):
    halo_lay, main_lay, hi_lay = new_layer(), new_layer(), new_layer()
    for k in range(arms):
        pts = []
        n = 210
        for i in range(n):
            t = i / (n - 1)
            ang = k * math.tau / arms + t * math.tau * turns
            rad = r0 + (r1 - r0) * (t ** 0.92) + math.sin(t * math.tau * 1.7 + k * 1.7) * (8 + 16 * t)
            pts.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad * 0.76))
        for lay, base_w, col in ((halo_lay, 32.0, halo), (main_lay, 21.0, main), (hi_lay, 5.0, hi)):
            seg = 26
            for si in range(0, len(pts) - 1, seg):
                chunk = pts[si:si + seg + 1]
                if len(chunk) < 2:
                    continue
                t = si / float(len(pts))
                wmod = 1.0 + 0.30 * math.sin(t * math.tau * 3.0 + k * 2.1)
                taper(lay, chunk, base_w * wmod, base_w * 0.80 * wmod, col, smooth=False)
        for i in range(4, len(pts) - 3, 5):
            segp = pts[i:i + 3]
            stroke(hi_lay, segp, (255, 252, 226), rng.uniform(2.0, 5.5), smooth=False)
    put(im, halo_lay, blur=2.6, alpha=95)
    put(im, main_lay, blur=0.8, alpha=195)
    put(im, hi_lay, blur=0.4, alpha=150)


def star(im, rng, x, y, r, color=(251, 236, 172), halo=(255, 228, 143), alpha=235):
    glow(im, x, y, r * 5.2, r * 5.2, halo, int(52 + r), 2.1)
    lay = new_layer()
    poly(lay, star_pts(x, y, r, inner=0.30, n=4, rot=-math.pi / 2), color)
    poly(lay, star_pts(x, y, r * 0.42, inner=0.42, n=4, rot=-math.pi / 2), lighten(color, 0.55))
    put(im, lay, blur=0.4, alpha=alpha)


def crescent(im, x, y, r, color=(255, 238, 176), rot=0.0):
    glow(im, x, y, r * 3.4, r * 3.4, (255, 226, 140), 110, 2.0)
    m = Image.new("L", (SW, SH), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([px(x - r), px(y - r), px(x + r), px(y + r)], fill=255)
    ox = x + math.cos(rot) * r * 0.42
    oy = y + math.sin(rot) * r * 0.42
    d.ellipse([px(ox - r), px(oy - r), px(ox + r), px(oy + r)], fill=0)
    col = Image.new("RGBA", (SW, SH), fc(color))
    col.putalpha(m)
    im.alpha_composite(col)


def cypress(im, rng, x, base_y, h, color, edge_color, width=1.0):
    """梵谷式火焰柏樹：寬闊、扭動、帶短筆觸。"""
    lay = new_layer()
    wf = width
    outline = [
        (x - h * 0.060 * wf, base_y),
        (x - h * 0.105 * wf, base_y - h * 0.20),
        (x - h * 0.052 * wf, base_y - h * 0.40),
        (x - h * 0.098 * wf, base_y - h * 0.58),
        (x - h * 0.040 * wf, base_y - h * 0.76),
        (x - h * 0.010 * wf, base_y - h * 0.92),
        (x + h * 0.014 * wf, base_y - h * 1.00),
        (x + h * 0.046 * wf, base_y - h * 0.80),
        (x + h * 0.022 * wf, base_y - h * 0.62),
        (x + h * 0.094 * wf, base_y - h * 0.44),
        (x + h * 0.040 * wf, base_y - h * 0.22),
        (x + h * 0.086 * wf, base_y),
    ]
    smooth = catmull_rom(outline, 12, closed=True)
    poly(lay, smooth, color)
    # 短筆觸：深淺交錯
    for _ in range(70):
        yy = base_y - rng.uniform(0.06, 0.97) * h
        half = h * (0.030 + 0.040 * (1 - (base_y - yy) / h)) * wf
        xx = x + rng.uniform(-1, 1) * half
        pts = cbez((xx, yy + h * 0.06), (xx + rng.uniform(-9, 9), yy + h * 0.02),
                   (xx + rng.uniform(-12, 12), yy - h * 0.05),
                   (xx + rng.uniform(-16, 16), yy - h * 0.11), 8)
        col = edge_color if rng.random() < 0.62 else lighten(color, 0.16)
        stroke(lay, pts, col, rng.uniform(1.8, 4.2), smooth=True)
    put(im, lay, blur=0.5)


# ---------------------------------------------------------------------------
# 咖啡廳元件
# ---------------------------------------------------------------------------
def latte_cup(im, cx, cy, r):
    lay = new_layer()
    ell(lay, cx, cy + r * 0.30, r * 1.55, r * 0.55, (214, 198, 176))          # 影子
    ell(lay, cx, cy + r * 0.10, r * 1.32, r * 0.42, (255, 250, 236))          # 碟
    ell(lay, cx, cy, r, r * 0.80, (250, 243, 226))                            # 杯身
    ell(lay, cx, cy - r * 0.06, r * 0.86, r * 0.68, (255, 252, 240))
    ell(lay, cx, cy - r * 0.06, r * 0.74, r * 0.58, (176, 132, 88))           # 咖啡
    ell(lay, cx + r * 0.10, cy - r * 0.08, r * 0.48, r * 0.36, (198, 154, 106))
    # 拉花愛心
    hx, hy = cx - r * 0.02, cy - r * 0.10
    ell(lay, hx - r * 0.18, hy - r * 0.10, r * 0.19, r * 0.17, (250, 244, 226))
    ell(lay, hx + r * 0.18, hy - r * 0.10, r * 0.19, r * 0.17, (250, 244, 226))
    poly(lay, [(hx - r * 0.34, hy - r * 0.02), (hx + r * 0.34, hy - r * 0.02),
               (hx, hy + r * 0.34)], (250, 244, 226))
    dot(lay, hx + r * 0.02, hy - r * 0.14, r * 0.05, (255, 255, 248))
    # 杯把
    stroke(lay, cbez((cx + r * 0.80, cy - r * 0.10), (cx + r * 1.30, cy - r * 0.30),
                     (cx + r * 1.30, cy + r * 0.30), (cx + r * 0.80, cy + r * 0.18), 18),
           (250, 243, 226), r * 0.16)
    stroke(lay, cbez((cx + r * 0.80, cy - r * 0.10), (cx + r * 1.30, cy - r * 0.30),
                     (cx + r * 1.30, cy + r * 0.30), (cx + r * 0.80, cy + r * 0.18), 18),
           (225, 208, 184), r * 0.05, smooth=False)
    put(im, lay)
    # 蒸氣
    st = new_layer()
    for k in (-1, 0, 1):
        pts = cbez((cx + k * r * 0.28, cy - r * 0.75),
                   (cx + k * r * 0.28 + r * 0.22, cy - r * 1.15),
                   (cx + k * r * 0.28 - r * 0.18, cy - r * 1.55),
                   (cx + k * r * 0.22, cy - r * 1.95), 16)
        stroke(st, pts, (255, 252, 240), r * 0.07, smooth=True)
    put(im, st, blur=2.2, alpha=110)


def cake_slice(im, cx, cy, s):
    lay = new_layer()
    ell(lay, cx, cy + s * 0.52, s * 1.25, s * 0.34, (214, 198, 176))       # 影子
    ell(lay, cx, cy + s * 0.36, s * 1.20, s * 0.34, (255, 250, 240))       # 盤
    ell(lay, cx, cy + s * 0.36, s * 0.95, s * 0.24, (240, 229, 210))
    body = [(cx - s * 0.72, cy + s * 0.30), (cx - s * 0.52, cy - s * 0.55),
            (cx + s * 0.52, cy - s * 0.55), (cx + s * 0.72, cy + s * 0.30)]
    poly(lay, body, (250, 226, 196))
    poly(lay, [(cx - s * 0.72, cy + s * 0.30), (cx - s * 0.52, cy - s * 0.55),
               (cx + s * 0.52, cy - s * 0.55), (cx + s * 0.72, cy + s * 0.30),
               (cx + s * 0.55, cy + s * 0.12), (cx - s * 0.55, cy + s * 0.12)], (255, 236, 206))
    # 奶油層
    rect(lay, cx - s * 0.63, cy - s * 0.12, cx + s * 0.63, cy + s * 0.02, (255, 248, 232))
    rect(lay, cx - s * 0.55, cy - s * 0.38, cx + s * 0.55, cy - s * 0.28, (248, 180, 194))
    # 頂部奶油與草莓
    ell(lay, cx, cy - s * 0.58, s * 0.52, s * 0.16, (255, 250, 238))
    ell(lay, cx + s * 0.15, cy - s * 0.72, s * 0.17, s * 0.20, (232, 120, 132))
    dot(lay, cx + s * 0.15, cy - s * 0.74, s * 0.05, (255, 210, 205))
    ell(lay, cx + s * 0.15, cy - s * 0.90, s * 0.05, s * 0.08, (120, 148, 104))
    put(im, lay)


def potted_plant(im, cx, base_y, h, pot=(206, 150, 122), leaf=(122, 158, 118), alpha=255):
    lay = new_layer()
    ell(lay, cx, base_y + h * 0.04, h * 0.30, h * 0.06, (150, 130, 110))
    poly(lay, [(cx - h * 0.18, base_y - h * 0.30), (cx + h * 0.18, base_y - h * 0.30),
               (cx + h * 0.13, base_y), (cx - h * 0.13, base_y)], pot)
    rect(lay, cx - h * 0.20, base_y - h * 0.35, cx + h * 0.20, base_y - h * 0.28, lighten(pot, 0.15))
    # 葉子：五片橢圓＋葉脈
    for k in range(5):
        ang = -math.pi / 2 + (k - 2) * 0.5
        L = h * (0.55 + 0.12 * (2 - abs(k - 2)))
        tipx = cx + math.cos(ang) * L * 0.55
        tipy = base_y - h * 0.3 + math.sin(ang) * L * 0.7
        stem_pts = cbez((cx, base_y - h * 0.32),
                        (cx + math.cos(ang) * L * 0.15, base_y - h * 0.5),
                        (cx + math.cos(ang) * L * 0.4, tipy + 30),
                        (tipx, tipy), 12)
        stroke(lay, stem_pts, darken(leaf, 0.25), h * 0.02, smooth=False)
        ell(lay, tipx, tipy, L * 0.20, L * 0.10, leaf, darken(leaf, 0.18), 0.8)
    put(im, lay, alpha=alpha)


# ---------------------------------------------------------------------------
# Finish / 輸出
# ---------------------------------------------------------------------------
def finish(im: Image.Image, nrng, vig=0.15, bloom=1.0) -> Image.Image:
    arr = np.asarray(im.convert("RGB")).astype(np.float32)
    # 亮部柔光
    lum = arr.max(axis=2)
    bright = np.clip((lum - 176.0) / 70.0, 0.0, 1.0)
    bim = Image.fromarray((bright * 255).astype(np.uint8))
    bim = bim.filter(ImageFilter.GaussianBlur(9.0 * SS))
    b = np.asarray(bim).astype(np.float32) / 255.0
    arr += b[..., None] * np.asarray((30.0, 26.0, 16.0), dtype=np.float32) * bloom
    # 暖調與提亮
    arr = arr * 0.985 + 3.2
    arr[..., 0] += 1.6
    arr[..., 2] -= 0.6
    # 暗角
    nx = (XX - SW * 0.5) / (SW * 0.5)
    ny = (YY - SH * 0.5) / (SH * 0.5)
    v = np.clip(np.sqrt(nx * nx * 0.90 + ny * ny * 0.96), 0.0, 1.7) / 1.35
    arr *= (1.0 - vig * (v ** 1.7))[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def gold_texture(nrng):
    t = (XX / SW) * 0.55 + (YY / SH) * 0.45
    facet = 0.5 + 0.5 * np.sin(t * 26.0 + np.sin(t * 7.0 + 1.3) * 1.2 + 0.6)
    # 錘打感 + 銅綠
    pat = Image.fromarray((nrng.normal(0, 22, (48, 64)) + 128).clip(0, 255).astype(np.uint8))
    pat = pat.resize((SW, SH), Image.BICUBIC)
    noise = (np.asarray(pat).astype(np.float32) - 128.0) / 128.0
    shade = (0.55 + 0.45 * facet) * (1.0 + 0.10 * noise)
    dark = np.asarray((138, 100, 36), dtype=np.float32)
    light = np.asarray((255, 232, 150), dtype=np.float32)
    col = dark[None, None, :] + (light - dark)[None, None, :] * np.clip(shade, 0, 1)[..., None]
    # 左上亮、右下暗
    lr = 1.06 - 0.16 * ((XX / SW) * 0.5 + (YY / SH) * 0.5)
    col = col * lr[..., None]
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")


def ornate_frame(im: Image.Image, rng) -> Image.Image:
    """華麗金色畫框：外緣內縮 FRAME_INSET，帶寬 FRAME_BAND。"""
    out0 = FRAME_INSET
    outx1, outy1 = BASE_W - out0, BASE_H - out0
    in0 = out0 + FRAME_BAND
    inx1, iny1 = BASE_W - in0, BASE_H - in0
    mid = (out0 + in0) / 2.0
    nrng = np.random.default_rng(7777)
    xx, yy = XX / SS, YY / SS

    # 1) 外圍亞麻裱板（奶油底色 + 細微纖維噪點）
    noise = nrng.normal(0, 2.4, (SH // 4, SW // 4)).astype(np.float32)
    noise_img = Image.fromarray(np.clip(noise + 128, 0, 255).astype(np.uint8))
    noise = np.asarray(noise_img.resize((SW, SH), Image.BICUBIC)).astype(np.float32) - 128.0
    arr = np.empty((SH, SW, 4), dtype=np.uint8)
    base = np.asarray(CREAM, dtype=np.float32)
    arr[..., :3] = np.clip(base[None, None, :] + noise[..., None] * 0.75, 0, 255).astype(np.uint8)
    arr[..., 3] = 255
    mat = Image.fromarray(arr, "RGBA")
    hole = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(hole).rounded_rectangle(
        [px(out0), px(out0), px(outx1), px(outy1)], radius=px(2), fill=255)
    mat.putalpha(ImageChops.subtract(mat.getchannel("A"), hole))
    im.alpha_composite(mat)

    # 2) 畫框落下來的陰影（在裱板上與畫作上）
    drop = new_layer()
    ImageDraw.Draw(drop).rectangle(
        [px(out0 - 6), px(out0 - 5), px(outx1 + 7), px(outy1 + 8)],
        fill=fc((58, 42, 28, 255)))
    drop = drop.filter(ImageFilter.GaussianBlur(5.0 * SS))
    drop = ImageChops.offset(drop, px(2), px(3))
    set_alpha(drop, 92)
    im.alpha_composite(drop)

    # 3) 金屬金箔底（錘打質感 + 光澤）
    gold = gold_texture(nrng)
    band_mask = ((xx >= out0) & (xx <= outx1) & (yy >= out0) & (yy <= outy1) &
                 ~((xx >= in0) & (xx <= inx1) & (yy >= in0) & (yy <= iny1)))
    gimg = gold.convert("RGBA")
    gimg.putalpha(Image.fromarray((band_mask * 255).astype(np.uint8)))
    im.alpha_composite(gimg)

    lay = new_layer()
    d = ImageDraw.Draw(lay)
    # 外緣深金線 + 亮線
    d.rectangle([px(out0), px(out0), px(outx1), px(outy1)],
                outline=fc((112, 76, 24)), width=max(1, px(2.2)))
    d.rectangle([px(out0 + 2.6), px(out0 + 2.6), px(outx1 - 2.6), px(outy1 - 2.6)],
                outline=fc((255, 244, 190)), width=max(1, px(1.1)))
    # 內緣亮線 + 深溝
    d.rectangle([px(in0 - 4.6), px(in0 - 4.6), px(inx1 + 4.6), px(iny1 + 4.6)],
                outline=fc((255, 240, 178)), width=max(1, px(1.5)))
    d.rectangle([px(in0 - 1.6), px(in0 - 1.6), px(inx1 + 1.6), px(iny1 + 1.6)],
                outline=fc((113, 77, 25)), width=max(1, px(2.2)))

    # 4) 內側陰影（畫作邊緣）
    ix0, iy0, ix1, iy1 = in0 + 2, in0 + 2, inx1 - 2, iny1 - 2
    inside = (xx >= ix0) & (xx <= ix1) & (yy >= iy0) & (yy <= iy1)
    dd = np.minimum.reduce([xx - ix0, ix1 - xx, yy - iy0, iy1 - yy])
    aa = (np.clip(1.0 - dd / 12.0, 0.0, 1.0) ** 1.6 * 92.0 * inside).astype(np.uint8)
    arr = np.empty((SH, SW, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 46, 34, 24
    arr[..., 3] = aa
    im.alpha_composite(Image.fromarray(arr, "RGBA"))

    # 5) 畫框雕飾
    def bead(x, y):
        ell(lay, x, y, 3.2, 3.2, (255, 233, 154), (118, 82, 26), 0.8)
        dot(lay, x - 0.8, y - 1.0, 1.0, (255, 252, 224))

    def small_leaf(x, y, ang, L=9.0, W=4.0, fill=(194, 145, 54)):
        ca, sa = math.cos(ang), math.sin(ang)
        left, right = [], []
        for i in range(14):
            u = i / 13.0
            w = W * (math.sin(math.pi * u) ** 0.72)
            left.append((x + ca * L * u - sa * w, y + sa * L * u + ca * w))
            right.append((x + ca * L * u + sa * w, y + sa * L * u - ca * w))
        poly(lay, left + right[::-1], fill, (116, 80, 24), 0.45)
        stroke(lay, [(x, y), (x + ca * L, y + sa * L)], (255, 232, 150), 0.9, smooth=False)

    def sprig(x, y, ang):
        for k in (-0.55, 0.0, 0.55):
            small_leaf(x, y, ang + k, 10.0, 3.6)
        dot(lay, x, y, 1.6, (255, 246, 200))

    def rosette(cx, cy):
        for k in range(8):
            ang = k * math.tau / 8 - math.pi / 2
            small_leaf(cx + math.cos(ang) * 4.2, cy + math.sin(ang) * 4.2, ang, 10.5, 4.2)
        ell(lay, cx, cy, 6.0, 6.0, (255, 240, 172), (112, 76, 22), 0.9)
        ell(lay, cx, cy, 3.0, 3.0, (255, 250, 214))
        dot(lay, cx - 1.3, cy - 1.4, 1.3, (255, 255, 242))

    def curl(x, y, dx, dy, length=84.0):
        pts = cbez((x, y), (x + dx * length * 0.34, y + dy * length * 0.16),
                   (x + dx * length * 0.72, y + dy * length * 0.52),
                   (x + dx * length * 0.52, y + dy * length * 0.66), 22)
        taper(lay, pts, 3.8, 1.0, (150, 106, 34))
        ang = math.atan2(dy, dx)
        small_leaf(pts[-1][0], pts[-1][1], ang - 0.9, 10.0, 3.8)
        small_leaf(pts[-1][0], pts[-1][1], ang + 0.9, 10.0, 3.8)

    # 珠飾列（四邊中線）+ 每四顆換一個葉飾
    def near_ornament(x, y):
        for (ox, oy) in corners_xy + edge_xy:
            if abs(x - ox) < 30 and abs(y - oy) < 30:
                return True
        return False

    corners_xy = [(mid, mid), (BASE_W - mid, mid), (mid, BASE_H - mid), (BASE_W - mid, BASE_H - mid)]
    edge_xy = [(BASE_W / 2, mid), (BASE_W / 2, BASE_H - mid), (mid, BASE_H / 2), (BASE_W - mid, BASE_H / 2)]

    idx = 0
    x = out0 + 22
    while x < outx1 - 18:
        for y in (mid, BASE_H - mid):
            if near_ornament(x, y):
                pass
            elif idx % 4 == 0:
                sprig(x, y, 0.0 if y < BASE_H / 2 else math.pi)
            else:
                bead(x, y)
        idx += 1
        x += 26
    idx = 0
    y = out0 + 22
    while y < outy1 - 18:
        for x in (mid, BASE_W - mid):
            if near_ornament(x, y):
                pass
            elif idx % 4 == 0:
                sprig(x, y, math.pi / 2 if x > BASE_W / 2 else -math.pi / 2)
            else:
                bead(x, y)
        idx += 1
        y += 26

    # 角落玫瑰飾 + 捲草
    for (cx, cy, sx, sy) in [(mid, mid, 1, 1), (BASE_W - mid, mid, -1, 1),
                             (mid, BASE_H - mid, 1, -1), (BASE_W - mid, BASE_H - mid, -1, -1)]:
        rosette(cx, cy)
        curl(cx + sx * 9, cy, sx, 0.0, 88)
        curl(cx, cy + sy * 9, 0.0, sy, 88)

    # 邊中央貝殼飾
    for (cx, cy, ang) in ((BASE_W / 2, mid, -math.pi / 2), (BASE_W / 2, BASE_H - mid, math.pi / 2),
                          (mid, BASE_H / 2, math.pi), (BASE_W - mid, BASE_H / 2, 0.0)):
        for k in (-2, -1, 0, 1, 2):
            small_leaf(cx, cy, ang + k * 0.38, 11.0, 4.2)
        ell(lay, cx, cy, 4.2, 4.2, (255, 240, 172), (114, 78, 24), 0.8)

    im.alpha_composite(lay)
    return im


def save_jpg(im: Image.Image, path: str, nrng, quality=88) -> int:
    small = im.convert("RGB").resize((BASE_W, BASE_H), Image.LANCZOS)
    small = small.filter(ImageFilter.UnsharpMask(radius=1.15, percent=36, threshold=2))
    arr = np.asarray(small).astype(np.float32)
    fine = nrng.normal(0.0, 1.05, (BASE_H, BASE_W, 1)).astype(np.float32)
    low = nrng.normal(0.0, 24.0, (56, 75)).astype(np.float32) + 128.0
    low_img = Image.fromarray(np.clip(low, 0, 255).astype(np.uint8)).resize((BASE_W, BASE_H), Image.BICUBIC)
    low = (np.asarray(low_img).astype(np.float32) - 128.0) * 0.040
    arr = arr + fine + low[..., None]
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    icc = SRGB_ICC

    def _save(q):
        kw = dict(format="JPEG", quality=q, subsampling=1, optimize=True,
                  progressive=True)
        if icc:
            kw["icc_profile"] = icc
        out.save(path, **kw)

    _save(quality)
    size = os.path.getsize(path)
    if size > 250 * 1024:
        _save(85)
        size = os.path.getsize(path)
    return size


# ===========================================================================
# 場景
# ===========================================================================
# ---------------------------------------------------------------------------
# 更多場景元件
# ---------------------------------------------------------------------------
def eiffel(lay, cx, base_y, h, color, light):
    knots_t = np.array([0.0, 0.06, 0.18, 0.34, 0.50, 0.68, 0.84, 0.94, 1.0])
    knots_w = np.array([0.195, 0.175, 0.135, 0.095, 0.068, 0.042, 0.022, 0.008, 0.002])

    def hw_at(t):
        return float(np.interp(t, knots_t, knots_w)) * h

    ts = np.linspace(0.0, 1.0, 150)
    left = [(cx - hw_at(t), base_y - h * t) for t in ts]
    right = [(cx + hw_at(t), base_y - h * t) for t in ts]
    poly(lay, left + right[::-1], color)
    for t, wf in ((0.235, 1.25), (0.47, 1.32), (0.70, 1.55)):
        w = hw_at(t) * wf
        hh = h * 0.012
        rect(lay, cx - w, base_y - h * t - hh, cx + w, base_y - h * t + hh, color)
    for t in np.linspace(0.05, 0.93, 10):
        w = hw_at(t) * 0.85
        stroke(lay, [(cx - w, base_y - h * t), (cx + w, base_y - h * t)],
               light, max(1.2, h * 0.0042))
    for k in range(7):
        t0 = 0.04 + k * 0.06
        t1 = t0 + 0.055
        w0, w1 = hw_at(t0), hw_at(t1)
        stroke(lay, [(cx - w0, base_y - h * t0), (cx + w1, base_y - h * t1)],
               light, max(1.0, h * 0.0032))
        stroke(lay, [(cx + w0, base_y - h * t0), (cx - w1, base_y - h * t1)],
               light, max(1.0, h * 0.0032))
    taper(lay, [(cx, base_y - h * 0.92), (cx, base_y - h * 1.0)],
          h * 0.012, h * 0.004, color, smooth=False)
    ell(lay, cx, base_y - h * 1.0, h * 0.009, h * 0.009, light)


def fuji(lay, cx, base_y, half_w, height, body, snow, shade, rng):
    peak = (cx, base_y - height)
    left = cbez((cx - half_w, base_y),
                (cx - half_w * 0.62, base_y - height * 0.18),
                (cx - half_w * 0.30, base_y - height * 0.58), peak, 44)
    right = cbez(peak,
                 (cx + half_w * 0.30, base_y - height * 0.58),
                 (cx + half_w * 0.62, base_y - height * 0.18),
                 (cx + half_w, base_y), 44)
    poly(lay, left + right[1:] + [(cx + half_w, base_y + 60), (cx - half_w, base_y + 60)], body)
    poly(lay, right + [(cx, base_y + 60)], shade)
    ys = peak[1] + height * 0.44
    lt = [p for p in left if p[1] <= ys]
    rt = [p for p in right if p[1] <= ys]
    if len(lt) > 2 and len(rt) > 2:
        lx, ly = lt[-1]
        rx, ry = rt[-1]
        jag = []
        for i in range(1, 8):
            t = i / 8.0
            jag.append((lx + (rx - lx) * t,
                        ys + math.sin(t * math.pi) * height * 0.045 +
                        rng.uniform(-1, 1) * height * 0.022))
        snow_pts = lt + rt + jag[::-1]
        poly(lay, snow_pts, snow)
        stroke(lay, jag, mix(snow, (150, 176, 204), 0.45), max(1.2, height * 0.006),
               smooth=True)
    # 山脊細節
    stroke(lay, left[::9], mix(shade, snow, 0.35), max(1.0, height * 0.004), smooth=True)


def palm(lay, rng, x, base_y, h, color, lean=0.10):
    tipx = x + lean * h * 0.5
    tipy = base_y - h
    trunk = cbez((x, base_y), (x - lean * h * 0.12, base_y - h * 0.38),
                 (tipx + lean * h * 0.12, base_y - h * 0.72), (tipx, tipy), 26)
    taper(lay, trunk, h * 0.052, h * 0.024, color)
    for i in range(6, 18):
        t = i / 24.0
        cxp = x + (tipx - x) * t
        cyp = base_y - h * t
        stroke(lay, [(cxp - h * 0.028, cyp), (cxp + h * 0.028, cyp + h * 0.008)],
               darken(color, 0.15), max(1.0, h * 0.007), smooth=False)
    for i in range(9):
        ang = -math.pi * 0.95 + i * (math.pi * 1.9 / 8.0) + rng.uniform(-0.07, 0.07)
        L = h * rng.uniform(0.30, 0.44)
        ex = tipx + math.cos(ang) * L
        ey = tipy + math.sin(ang) * L * 0.55 + L * 0.20
        c1 = (tipx + math.cos(ang) * L * 0.42, tipy + math.sin(ang) * L * 0.42 - L * 0.14)
        c2 = (ex - math.cos(ang) * L * 0.25 + rng.uniform(-8, 8), ey - L * 0.06)
        pts = cbez((tipx, tipy), c1, c2, (ex, ey), 20)
        taper(lay, pts, h * 0.030, h * 0.0025, color)
        for j in range(3, len(pts) - 2, 3):
            side = 1 if j % 2 else -1
            q = pts[j]
            stroke(lay, [q, (q[0] + side * h * 0.014, q[1] - h * 0.018)],
                   color, max(1.0, h * 0.006), smooth=False)
    for dx, dy in ((0, 0), (-h * 0.025, h * 0.03), (h * 0.025, h * 0.028)):
        ell(lay, tipx + dx, tipy + dy + h * 0.03, h * 0.024, h * 0.021, color)


def city_skyline(lay, rng, base_y, x0, x1, color, lit, lit2, min_h=40, max_h=150):
    x = x0
    while x < x1:
        w = rng.uniform(44, 106)
        h = rng.uniform(min_h, max_h)
        rect(lay, x, base_y - h, x + w, base_y, color)
        if rng.random() < 0.5:
            rect(lay, x + w * 0.35, base_y - h - rng.uniform(8, 22),
                 x + w * 0.65, base_y - h, color)
        if rng.random() < 0.35:
            stroke(lay, [(x + w * 0.5, base_y - h),
                         (x + w * 0.5, base_y - h - rng.uniform(14, 42))],
                   color, 2.0, smooth=False)
        cols = max(2, int(w / 22))
        rows = max(2, int(h / 26))
        for r in range(rows):
            for c in range(cols):
                if rng.random() < 0.52:
                    wx = x + w * (0.14 + 0.22 * c) + rng.uniform(-2, 2)
                    wy = base_y - h * (0.16 + 0.24 * r) + rng.uniform(-2, 2)
                    rect(lay, wx, wy, wx + w * 0.10, wy + h * 0.10,
                         rng.choice(lit + lit2))
        x += w + rng.uniform(6, 22)


def taipei101(lay, cx, base_y, h, color, lit):
    segs = 8
    for i in range(segs):
        t = i / float(segs)
        bw = h * (0.085 * (1 - 0.58 * t))
        y0 = base_y - h * (0.10 + 0.80 * t)
        y1 = y0 - h * 0.10
        rect(lay, cx - bw, y1, cx + bw, y0, color)
        rect(lay, cx - bw * 0.68, y1 + h * 0.014, cx + bw * 0.68, y1 + h * 0.034, lit)
    rect(lay, cx - h * 0.085, base_y - h * 0.04, cx + h * 0.085, base_y, color)
    taper(lay, [(cx, base_y - h * 0.90), (cx, base_y - h * 1.0)],
          h * 0.018, h * 0.003, color, smooth=False)


def lantern(lay, x, y, r, body):
    stroke(lay, [(x, y - r * 1.7), (x, y - r * 0.78)], (146, 112, 82), 2.0, smooth=False)
    ell(lay, x, y, r, r * 0.90, body)
    rect(lay, x - r * 0.4, y - r * 1.05, x + r * 0.4, y - r * 0.88, (216, 170, 86))
    rect(lay, x - r * 0.4, y + r * 0.84, x + r * 0.4, y + r * 0.98, (216, 170, 86))
    stroke(lay, [(x, y + r * 0.96), (x, y + r * 1.42)], (216, 170, 86), 2.6, smooth=False)
    ell(lay, x - r * 0.32, y - r * 0.30, r * 0.30, r * 0.34, lighten(body, 0.38))


def snowy_pine(lay, rng, x, base_y, h, color, snow, w=None, tiers=4):
    w = w if w is not None else h * 0.45
    taper(lay, [(x, base_y), (x, base_y - h * 0.20)], w * 0.09, w * 0.07, darken(color, 0.2))
    for i in range(tiers):
        t = i / max(1, tiers - 1)
        top = base_y - h * (0.15 + 0.80 * t)
        bot = base_y - h * (0.05 + 0.60 * t)
        bw = w * (1 - 0.55 * t)
        left = cbez((x, top), (x - bw * 0.45, top + (bot - top) * 0.45),
                    (x - bw * 0.8, bot - (bot - top) * 0.12), (x - bw, bot), 10)
        right = cbez((x, top), (x + bw * 0.45, top + (bot - top) * 0.45),
                     (x + bw * 0.8, bot - (bot - top) * 0.12), (x + bw, bot), 10)
        poly(lay, left + right[::-1], color)
        fr = 0.40
        sn = left[:max(2, int(len(left) * fr))] + right[:max(2, int(len(right) * fr))][::-1]
        poly(lay, sn, snow)
        for _ in range(3):
            t2 = rng.uniform(0.1, 0.7)
            ell(lay, x + rng.uniform(-bw, bw) * 0.8,
                top + (bot - top) * t2, bw * rng.uniform(0.10, 0.22),
                bw * rng.uniform(0.04, 0.08), snow)


def sunflower(lay, rng, cx, cy, r, petal, petal2, center, seed_col):
    n = 18

    def ring(scale, col, angle_offset, width_scale, outline):
        for i in range(n):
            ang = angle_offset + i * math.tau / n + rng.uniform(-0.03, 0.03)
            L = r * 1.32 * scale
            W = r * 0.42 * width_scale
            ca, sa = math.cos(ang), math.sin(ang)
            pts = []
            for u in np.linspace(0.16, 1.0, 10):
                w = W * (math.sin(math.pi * min(1.0, (u - 0.03) / 0.97)) ** 0.7)
                pts.append((cx + ca * L * u - sa * w, cy + sa * L * u + ca * w))
            for u in np.linspace(1.0, 0.16, 10):
                w = W * (math.sin(math.pi * min(1.0, (u - 0.03) / 0.97)) ** 0.7)
                pts.append((cx + ca * L * u + sa * w, cy + sa * L * u - ca * w))
            poly(lay, pts, col, outline, 0.55)

    ring(1.10, petal2, 0.0, 0.95, darken(petal2, 0.18))
    ring(1.00, petal, math.pi / n, 0.88, darken(petal, 0.14))
    # 花心
    ell(lay, cx, cy, r * 0.66, r * 0.66, center)
    ell(lay, cx, cy, r * 0.54, r * 0.54, darken(center, 0.10))
    ell(lay, cx, cy, r * 0.40, r * 0.40, lighten(center, 0.06))
    for _ in range(48):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0, r * 0.38)
        dot(lay, cx + math.cos(a) * rr, cy + math.sin(a) * rr, r * 0.030, seed_col)
    for _ in range(14):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(r * 0.44, r * 0.62)
        dot(lay, cx + math.cos(a) * rr, cy + math.sin(a) * rr, r * 0.026,
            lighten(seed_col, 0.25))


def leaf(lay, rng, x, y, ang, L, W, color):
    ca, sa = math.cos(ang), math.sin(ang)
    left, right = [], []
    for i in range(16):
        u = i / 15.0
        w = W * (math.sin(math.pi * u) ** 0.7)
        left.append((x + ca * L * u - sa * w, y + sa * L * u + ca * w))
        right.append((x + ca * L * u + sa * w, y + sa * L * u - ca * w))
    poly(lay, left + right[::-1], color, darken(color, 0.18), 0.7)
    stroke(lay, [(x, y), (x + ca * L, y + sa * L)], lighten(color, 0.25), 1.2, smooth=False)


def sakura_branch(lay, rng, start, ctrl, end, colors, n_blossoms=10, width=8):
    pts = cbez(start, ctrl, end, end, 30)
    taper(lay, pts, width, width * 0.25, (128, 98, 88))
    for i in range(n_blossoms):
        t = (i + 0.5) / n_blossoms
        idx = min(len(pts) - 1, int(t * len(pts)))
        p = pts[idx]
        blossom_cluster(lay, rng, p[0], p[1] + rng.uniform(-8, 8),
                        rng.uniform(18, 30), colors, n=10)


def bunting_string(lay, rng, x0, y0, x1, y1, sag, colors, size=28, n=8):
    ctrl = ((x0 + x1) / 2.0, (y0 + y1) / 2.0 + sag)
    pts = qbez((x0, y0), ctrl, (x1, y1), 90)
    stroke(lay, pts, (152, 122, 98), 2.2, smooth=False)
    for i in range(n):
        t = (i + 0.5) / n
        idx = int(t * (len(pts) - 1))
        p = pts[idx]
        col = colors[i % len(colors)]
        tri = [(p[0] - size * 0.5, p[1]), (p[0] + size * 0.5, p[1]), (p[0], p[1] + size)]
        poly(lay, tri, col, darken(col, 0.12), 0.8)


def balloon(lay, x, y, rx, ry, color, string_to_y):
    stroke(lay, cbez((x, y + ry * 0.95), (x + rx * 0.45, y + ry * 1.7),
                     (x - rx * 0.35, string_to_y - 36), (x + rx * 0.2, string_to_y), 16),
           (150, 130, 118), 1.6, smooth=False)
    ell(lay, x, y, rx, ry, color)
    ell(lay, x - rx * 0.30, y - ry * 0.32, rx * 0.30, ry * 0.34, lighten(color, 0.38))
    poly(lay, [(x - rx * 0.12, y + ry * 0.94), (x + rx * 0.12, y + ry * 0.94),
               (x, y + ry * 1.08)], darken(color, 0.12))


def confetti(im, rng, n, x0, x1, y0, y1, colors, size=(4, 9)):
    lay = new_layer()
    for _ in range(n):
        x = rng.uniform(x0, x1)
        y = rng.uniform(y0, y1)
        s = rng.uniform(*size)
        a = rng.uniform(0, math.tau)
        ca, sa = math.cos(a), math.sin(a)
        w, h = s * 0.55, s
        pts = [(x - ca * w - sa * h, y - sa * w + ca * h),
               (x + ca * w - sa * h, y + sa * w + ca * h),
               (x + ca * w + sa * h, y + sa * w - ca * h),
               (x - ca * w + sa * h, y - sa * w - ca * h)]
        poly(lay, pts, rng.choice(colors))
    put(im, lay, blur=0.3, alpha=230)


def birthday_cake(im, cx, cy, s):
    lay = new_layer()
    ell(lay, cx, cy + s * 0.64, s * 1.42, s * 0.34, (215, 196, 176))
    ell(lay, cx, cy + s * 0.50, s * 1.46, s * 0.32, (255, 250, 240))
    rect(lay, cx - s * 0.96, cy - s * 0.04, cx + s * 0.96, cy + s * 0.42, (250, 214, 196))
    rect(lay, cx - s * 0.96, cy - s * 0.04, cx + s * 0.96, cy + s * 0.03, (255, 236, 226))
    rect(lay, cx - s * 0.64, cy - s * 0.52, cx + s * 0.64, cy - s * 0.02, (252, 224, 206))
    rect(lay, cx - s * 0.96, cy - s * 0.04, cx + s * 0.96, cy + s * 0.15, (255, 240, 230))
    for i in range(6):
        ell(lay, cx - s * 0.86 + i * s * 0.345, cy + s * 0.17, s * 0.125, s * 0.10,
            (255, 240, 230))
    rect(lay, cx - s * 0.64, cy - s * 0.52, cx + s * 0.64, cy - s * 0.38, (255, 246, 236))
    for i in range(4):
        ell(lay, cx - s * 0.50 + i * s * 0.333, cy - s * 0.35, s * 0.10, s * 0.09,
            (255, 246, 236))
    for k in (-1, 0, 1):
        xx = cx + k * s * 0.28
        rect(lay, xx - s * 0.035, cy - s * 0.88, xx + s * 0.035, cy - s * 0.52,
             (246, 196, 204))
        stroke(lay, [(xx, cy - s * 0.88), (xx, cy - s * 0.94)], (140, 110, 80), 1.2,
               smooth=False)
        flame = [(xx, cy - s * 1.12), (xx - s * 0.055, cy - s * 1.00),
                 (xx, cy - s * 0.94), (xx + s * 0.055, cy - s * 1.00)]
        glow(im, xx, cy - s * 1.02, s * 0.18, s * 0.20, (255, 220, 140), 105, 2.0)
        poly(lay, flame, (255, 206, 120))
        dot(lay, xx, cy - s * 0.99, s * 0.024, (255, 250, 214))
    put(im, lay, blur=0.3)


def two_figures(lay, x, y, scale, color):
    ell(lay, x, y - scale * 0.86, scale * 0.15, scale * 0.17, color)
    taper(lay, [(x, y - scale * 0.72), (x, y - scale * 0.30)],
          scale * 0.30, scale * 0.22, color)
    stroke(lay, [(x, y - scale * 0.28), (x - scale * 0.10, y)], color,
           scale * 0.085, smooth=False)
    stroke(lay, [(x, y - scale * 0.28), (x + scale * 0.10, y)], color,
           scale * 0.085, smooth=False)
    stroke(lay, [(x, y - scale * 0.64), (x - scale * 0.22, y - scale * 0.38)],
           color, scale * 0.06, smooth=False)
    stroke(lay, [(x, y - scale * 0.64), (x + scale * 0.22, y - scale * 0.42)],
           color, scale * 0.06, smooth=False)


def pearl_ornament(im, x, y, r):
    # 吊鏈
    stroke(im, [(x, 66), (x, y - r * 2.05)], (220, 180, 94), 2.2, smooth=True)
    for k in range(8):
        yy = 78 + k * (y - r * 2.05 - 78) / 8.0
        dot(im, x, yy, 1.5, (255, 230, 160))
    hook = new_layer()
    stroke(hook, cbez((x, y - r * 2.0), (x - r * 0.62, y - r * 1.95),
                      (x - r * 0.58, y - r * 1.55), (x, y - r * 1.48), 20),
           (232, 194, 112), 4.4, smooth=True)
    ell(hook, x, y - r * 1.26, r * 0.23, r * 0.19, (240, 204, 120))
    put(im, hook, blur=0.3)
    glow(im, x, y, r * 2.2, r * 2.2, (255, 244, 214), 80, 2.0)
    lay = new_layer()
    ell(lay, x + r * 0.22, y + r * 1.02, r * 0.78, r * 0.22, (24, 44, 46))
    ell(lay, x, y, r, r, (244, 236, 216))
    ell(lay, x - r * 0.14, y - r * 0.16, r * 0.68, r * 0.68, (255, 253, 244))
    ell(lay, x + r * 0.26, y + r * 0.32, r * 0.36, r * 0.26, (214, 206, 188))
    dot(lay, x - r * 0.30, y - r * 0.34, r * 0.16, (255, 255, 252))
    dot(lay, x + r * 0.36, y - r * 0.10, r * 0.07, (255, 255, 250))
    put(im, lay, blur=0.4)


def book_stack(lay, rng, x, base_y, n, colors):
    y = base_y
    for i in range(n):
        w = rng.uniform(62, 96)
        h = rng.uniform(11, 18)
        col = rng.choice(colors)
        rect(lay, x - w * 0.5 + rng.uniform(-4, 4), y - h, x + w * 0.5, y, col)
        rect(lay, x - w * 0.5 + 4, y - h, x + w * 0.5 - 4, y - h * 0.35, lighten(col, 0.25))
        rect(lay, x - w * 0.5, y - h, x + w * 0.5, y, None, darken(col, 0.25), 0.6)
        y -= h + 1.5
    return y


def scene_tokyo(rng, nrng, slot):
    im = grad_bg([(0.0, (192, 168, 216)), (0.22, (231, 189, 214)),
                  (0.46, (250, 213, 216)), (0.68, (255, 231, 209)),
                  (1.0, (255, 246, 231))], nrng=nrng)
    glow(im, 930, 120, 360, 280, (255, 242, 203), 130, 2.3)
    cloud(im, rng, 250, 148, 320, 82, color=(255, 251, 247), shade=(235, 205, 226),
          alpha=150, blur=2.8, flat=0.32)
    cloud(im, rng, 720, 100, 250, 62, color=(255, 250, 246), shade=(236, 207, 226),
          alpha=130, blur=3.0, flat=0.32)
    cloud(im, rng, 1010, 244, 285, 74, color=(255, 250, 246), shade=(238, 208, 226),
          alpha=155, blur=2.4, flat=0.36)
    hills(im, rng, 648, 50, (214, 192, 220), alpha=165, waves=2, blur=2.2)
    hills(im, rng, 672, 32, (193, 176, 206), alpha=130, waves=2, blur=1.5)
    # 五重塔（右後景，薄霧）
    lay = new_layer()
    pagoda(lay, 1058, 682, 232, mix(NAVY, LAV, 0.55))
    put(im, lay, blur=1.7, alpha=170)
    # 鳥居（右中景）
    lay = new_layer()
    torii(lay, 884, 700, 176, 162, mix((205, 94, 84), PINK, 0.24), (148, 70, 68))
    put(im, lay, blur=0.55, alpha=232)
    haze(im, 676, 42, (255, 241, 234), 80)

    # 地面
    ground = new_layer()
    poly(ground, [(-20, BASE_H + 20), (-20, 706), (240, 682), (620, 676),
                  (980, 688), (BASE_W + 20, 706), (BASE_W + 20, BASE_H + 20)],
         (201, 217, 189))
    # 草地的明暗塊，避免大面積平塗
    for _ in range(16):
        ell(ground, rng.uniform(-40, 1240), rng.uniform(700, 890),
            rng.uniform(70, 190), rng.uniform(18, 46),
            rng.choice([(193, 212, 184), (209, 224, 197), (186, 205, 180)]))
    put(im, ground, blur=10.0, alpha=90)
    # 小徑
    path = new_layer()
    path_pts = [(-20, 900), (320, 900), (445, 806), (512, 706), (596, 678),
                (664, 690), (710, 792), (890, 900), (1090, 900)]
    poly(path, path_pts, (249, 239, 220))
    for _ in range(9):
        ell(path, rng.uniform(380, 860), rng.uniform(720, 890),
            rng.uniform(40, 110), rng.uniform(10, 24),
            rng.choice([(245, 234, 214), (252, 243, 226)]))
    stroke(path, [(320, 900), (445, 806), (512, 706), (596, 678)], (223, 207, 183), 3.0, smooth=True)
    stroke(path, [(1090, 900), (890, 900), (710, 792), (664, 690), (596, 678)],
           (223, 207, 183), 3.0, smooth=True)
    put(im, path, blur=1.6)

    # 草地上短筆觸
    gt = new_layer()
    for _ in range(150):
        x = rng.uniform(-10, 1210)
        y = rng.uniform(700, 898)
        if 300 < x < 950 and y > 700:
            continue
        stroke(gt, [(x, y), (x + rng.uniform(-4, 4), y - rng.uniform(5, 13))],
               rng.choice([(175, 197, 170), (192, 212, 184), (160, 186, 158)]),
               rng.uniform(0.8, 2.0), smooth=False)
    put(im, gt, alpha=150)

    # 大櫻花樹（左）
    tree = new_layer()
    cherry_tree(tree, rng, 128, 812, 600, (124, 96, 86),
                [(250, 196, 212), (255, 219, 228), (244, 170, 194), (255, 240, 242)],
                spread=0.9)
    put(im, tree, blur=0.9, alpha=245)
    # 遠景小櫻花（右邊框）
    small = new_layer()
    cherry_tree(small, rng, 1150, 700, 235, (152, 122, 120),
                [(240, 202, 218), (248, 218, 228), (232, 178, 200)], spread=1.0)
    put(im, small, blur=2.6, alpha=110)

    # 角色
    draw_character(im, slot)

    # 前景：花瓣、花草
    fg = new_layer()
    petal_rain(fg, rng, 54, 60, 1140, 70, 500,
               [(255, 210, 224), (249, 185, 204), (255, 235, 240), (240, 168, 192)],
               size=(6, 12), alpha=230, blur=0.25)
    for _ in range(20):
        x = rng.uniform(70, 1130)
        y = rng.uniform(795, 898)
        grass_tuft(fg, rng, x, y, rng.uniform(12, 24),
                   mix((126, 166, 126), (255, 255, 255), 0.28), n=4)
    for _ in range(16):
        x = rng.uniform(120, 1080)
        y = rng.uniform(760, 892)
        for k in range(5):
            a = k * math.tau / 5 + rng.uniform(0, 0.4)
            dot(fg, x + math.cos(a) * 3.2, y + math.sin(a) * 3.2, 1.7,
                rng.choice([(255, 250, 244), (255, 226, 236)]))
        dot(fg, x, y, 1.6, (246, 208, 120))
    for _ in range(12):
        x = rng.uniform(380, 870)
        y = rng.uniform(760, 895)
        s = rng.uniform(9, 15)
        poly(fg, petal_points(x, y, s, s * 0.6, rng.uniform(0, math.tau)),
             rng.choice([(252, 199, 214), (255, 228, 234)]), (226, 158, 182), 0.7)
    put(im, fg, alpha=242)
    petal_rain(im, rng, 5, 40, 1160, 700, 900,
               [(255, 214, 226), (248, 188, 206)], size=(20, 30), alpha=105, blur=2.8)
    return im


def scene_starry(rng, nrng, slot):
    im = grad_bg([(0.0, (13, 25, 54)), (0.42, (21, 42, 80)),
                  (0.78, (30, 55, 95)), (1.0, (44, 71, 108))], nrng=nrng)
    # 梵谷式天空筆觸
    brush_field(im, rng, 380, (-40, 1240), (10, 700),
                [(33, 62, 104), (22, 41, 78), (44, 79, 122), (26, 49, 88)],
                w=(5, 15), l=(36, 116), curve=20, alpha=255)
    brush_field(im, rng, 110, (60, 1180), (20, 420),
                [(58, 96, 138), (48, 83, 126), (70, 108, 146)],
                w=(3, 8), l=(46, 120), angle_center=-0.22, angle_spread=0.22, alpha=210)
    # 幾道流動的長筆觸
    flow = new_layer()
    for k in range(9):
        y0 = rng.uniform(60, 560)
        pts = cbez((rng.uniform(-60, 200), y0),
                   (rng.uniform(260, 560), y0 - rng.uniform(10, 50)),
                   (rng.uniform(620, 900), y0 + rng.uniform(-18, 30)),
                   (rng.uniform(1060, 1260), y0 - rng.uniform(0, 40)), 26)
        taper(flow, pts, rng.uniform(8, 18), rng.uniform(1, 4),
              rng.choice([(64, 104, 146), (45, 79, 120)]), smooth=False)
    put(im, flow, blur=1.2, alpha=170)
    # 漩渦
    swirl(im, rng, 872, 236, 40, 205, turns=2.15, arms=2)
    # 星星
    star_spots = [(120, 240, 5.5), (285, 105, 6.5), (455, 205, 4.0), (575, 95, 5.5),
                  (640, 330, 3.5), (1055, 108, 8.0), (1140, 250, 5.0),
                  (975, 335, 3.6), (210, 415, 6.2), (72, 335, 4.2),
                  (525, 430, 3.4), (760, 430, 4.6)]
    for x, y, r in star_spots:
        star(im, rng, x, y, r)
    for _ in range(90):
        x, y = rng.uniform(6, 1194), rng.uniform(16, 560)
        dot(im, x, y, rng.uniform(0.8, 1.9), (226, 232, 220))
    # 新月
    crescent(im, 162, 130, 54, rot=-0.65)
    # 遠山
    hills(im, rng, 672, 44, (29, 51, 61), alpha=240, waves=2, blur=1.0)
    hills(im, rng, 716, 32, (39, 66, 68), alpha=235, waves=2, blur=0.6)
    # 村莊
    vil = new_layer()
    houses = [(742, 748, 58, 50), (798, 754, 46, 40), (850, 744, 70, 62),
              (928, 750, 44, 38), (980, 744, 62, 54), (1048, 752, 48, 42),
              (1102, 746, 58, 48)]
    for hx, hb, hw, hh in houses:
        rect(vil, hx, hb - hh, hx + hw, hb, (32, 46, 60))
        poly(vil, [(hx - 7, hb - hh), (hx + hw / 2, hb - hh - hw * 0.40),
                   (hx + hw + 7, hb - hh)], (40, 55, 70))
        for wy in range(2):
            for wx in range(2):
                if rng.random() < 0.78:
                    wx0 = hx + hw * (0.16 + wx * 0.40)
                    wy0 = hb - hh * (0.70 - wy * 0.34)
                    rect(vil, wx0, wy0, wx0 + hw * 0.18, wy0 + hh * 0.17,
                         rng.choice([(250, 214, 132), (255, 228, 158), (240, 190, 112)]))
    # 教堂與尖塔
    rect(vil, 900, 748 - 66, 928, 748, (32, 46, 60))
    poly(vil, [(886, 748 - 64), (914, 748 - 132), (942, 748 - 64)], (32, 46, 60))
    rect(vil, 908, 748 - 48, 920, 748 - 36, (250, 214, 132))
    stroke(vil, [(914, 748 - 132), (914, 748 - 152)], (32, 46, 60), 3)
    put(im, vil, blur=0.6, alpha=248)
    # 火焰柏樹（左）
    cypress(im, rng, 146, 902, 660, (19, 38, 38), (37, 62, 54), width=1.15)
    # 前景山坡
    fg = new_layer()
    poly(fg, [(-20, 900), (-20, 796), (180, 770), (392, 786), (620, 772),
              (848, 784), (1060, 774), (1240, 788), (1240, 900)], (22, 41, 47))
    for _ in range(34):
        x = rng.uniform(0, 1200)
        y = rng.uniform(778, 880)
        grass_tuft(fg, rng, x, y, rng.uniform(10, 22), (33, 59, 60), n=3)
    put(im, fg, blur=0.5)

    draw_character(im, slot)

    # 角色前景草叢與螢火
    fg2 = new_layer()
    for _ in range(12):
        x = rng.uniform(150, 1080)
        y = rng.uniform(828, 895)
        grass_tuft(fg2, rng, x, y, rng.uniform(12, 22), (29, 52, 55), n=3)
    put(im, fg2, alpha=225)
    for _ in range(15):
        x, y = rng.uniform(150, 1080), rng.uniform(690, 860)
        glow(im, x, y, 6, 6, (255, 232, 150), 85, 2.0)
        dot(im, x, y, 1.7, (255, 246, 206))
    return im


def scene_cafe(rng, nrng, slot):
    im = grad_bg([(0.0, (255, 250, 238)), (0.45, (253, 241, 221)),
                  (0.75, (247, 231, 205)), (1.0, (240, 220, 191))], nrng=nrng)
    glow(im, 240, 170, 340, 270, (255, 246, 214), 62, 2.2)

    # 牆面下半：護牆板
    wain = new_layer()
    rect(wain, 0, 570, BASE_W, 704, (249, 236, 215))
    for x in range(44, 1200, 148):
        rect(wain, x, 570, x + 9, 704, (239, 223, 198))
    rect(wain, 0, 570, BASE_W, 578, (232, 213, 187))
    rect(wain, 0, 698, BASE_W, 706, (226, 206, 178))
    put(im, wain, blur=0.4)

    # 牆上的小掛畫（抽象風景，無文字）
    art1 = new_layer()
    rect(art1, 292, 92, 470, 232, (255, 251, 240))
    rect(art1, 292, 92, 470, 232, None, (206, 182, 150), 5)
    rect(art1, 304, 104, 458, 220, (234, 230, 216))
    ell(art1, 410, 146, 24, 24, (246, 214, 148))
    poly(art1, [(304, 220), (352, 166), (400, 202), (438, 174), (458, 196), (458, 220)],
         (176, 196, 170))
    poly(art1, [(304, 220), (340, 198), (386, 212), (426, 194), (458, 212), (458, 220)],
         (138, 168, 148))
    put(im, art1, blur=0.3)
    art2 = new_layer()
    rect(art2, 502, 126, 622, 226, (255, 251, 240))
    rect(art2, 502, 126, 622, 226, None, (206, 182, 150), 5)
    rect(art2, 512, 136, 612, 216, (240, 222, 208))
    ell(art2, 562, 174, 22, 22, (240, 178, 156))
    rect(art2, 512, 194, 612, 216, (218, 196, 172))
    put(im, art2, blur=0.3)

    # 吊燈
    lamp = new_layer()
    stroke(lamp, [(232, 0), (232, 74)], (120, 96, 76), 3.2, smooth=False)
    rect(lamp, 224, 72, 240, 84, (150, 120, 92))
    poly(lamp, [(186, 152), (278, 152), (262, 84), (202, 84)], (255, 238, 196))
    ell(lamp, 232, 152, 46, 10, (255, 248, 220))
    put(im, lamp)
    glow(im, 232, 178, 100, 110, (255, 236, 176), 118, 2.0)

    # 窗（右）
    rect(im, 686, 74, 1152, 568, (234, 215, 188))
    rect(im, 702, 90, 1136, 554, (196, 228, 240))
    rect(im, 702, 90, 1136, 236, (164, 213, 236))
    rect(im, 702, 430, 1136, 554, (219, 236, 218))
    cloud(im, rng, 828, 206, 240, 64, alpha=210, blur=1.6, flat=0.35)
    cloud(im, rng, 1032, 300, 190, 50, alpha=175, blur=1.8, flat=0.35)
    glow(im, 1082, 148, 92, 92, (255, 244, 200), 150, 2.0)
    dot(im, 1082, 148, 34, (255, 246, 205))
    treel = new_layer()
    for x in (758, 838, 1082):
        ell(treel, x, 468, 58, 46, (156, 190, 154))
        ell(treel, x - 20, 484, 34, 28, (168, 200, 162))
    put(im, treel, blur=1.6, alpha=210)
    win = new_layer()
    rect(win, 702, 90, 1136, 554, None, (240, 226, 202), 10)
    rect(win, 910, 90, 930, 554, (246, 234, 214))
    rect(win, 702, 306, 1136, 326, (246, 234, 214))
    rect(win, 686, 74, 1152, 568, None, (214, 192, 164), 4)
    # 窗簾（粉彩）
    for (x0, s) in ((676, 1), (1152, -1)):
        pts = [(x0, 66), (x0 + s * 66, 86), (x0 + s * 54, 250),
               (x0 + s * 72, 470), (x0 + s * 76, 572), (x0, 572)]
        smooth_poly(win, pts, (246, 216, 212))
        for k in range(3):
            cx = x0 + s * (18 + k * 20)
            stroke(win, [(cx, 92), (cx + s * 6, 280), (cx - s * 8, 470), (cx, 560)],
                   (236, 198, 196), 4.0, smooth=True)
    # 窗台
    rect(win, 662, 568, 1172, 598, (245, 233, 213))
    rect(win, 662, 598, 1172, 606, (224, 204, 178))
    put(im, win)

    # 窗台上的盆栽與小杯
    potted_plant(im, 1094, 568, 108, pot=(206, 152, 128), leaf=(126, 162, 122))
    cup = new_layer()
    rect(cup, 726, 534, 776, 568, (250, 240, 222))
    ell(cup, 751, 534, 25, 8, (255, 248, 232))
    stroke(cup, cbez((776, 542), (792, 544), (792, 558), (776, 556), 10),
           (250, 240, 222), 6, smooth=False)
    put(im, cup, blur=0.3)

    # 地板
    floor = new_layer()
    poly(floor, [(-20, 900), (-20, 708), (300, 692), (700, 688), (1100, 698),
                 (1240, 710), (1240, 900)], (204, 162, 116))
    for k in range(7):
        y = 724 + k * 27
        stroke(floor, [(-20, y + 8), (380, y + 2), (760, y + 10), (1240, y + 4)],
               (178, 134, 92), 2.2, smooth=True)
    for k in range(8):
        x0 = rng.uniform(0, 900)
        stroke(floor, [(x0, 706), (x0 + 10, 760), (x0 + 4, 830), (x0 + 12, 898)],
               (184, 141, 99), 1.6)
    put(im, floor, blur=0.4)

    # 窗光落在地板上的光斑
    light = new_layer()
    poly(light, [(700, 706), (1150, 706), (1010, 900), (360, 900)], (255, 250, 230))
    put(im, light, blur=13.0, alpha=30)

    # 地毯（角色站在上面）
    rug = new_layer()
    ell(rug, 414, 800, 330, 86, (226, 190, 184))
    ell(rug, 414, 800, 300, 70, (247, 227, 216))
    ell(rug, 414, 800, 246, 52, (240, 215, 204))
    for k in range(26):
        a = k * math.tau / 26
        dot(rug, 414 + math.cos(a) * 274, 800 + math.sin(a) * 60, 2.6, (236, 204, 196))
    put(im, rug, blur=0.6)

    # 角色
    draw_character(im, slot)

    # 前景桌子（右側）
    table = new_layer()
    poly(table, [(556, 900), (660, 742), (1150, 700), (1240, 900)], (214, 170, 122))
    poly(table, [(566, 898), (668, 748), (1148, 706), (1236, 898)], (228, 186, 138))
    stroke(table, [(660, 742), (1150, 700)], (248, 216, 172), 5.0, smooth=True)
    for _ in range(11):
        x0 = rng.uniform(690, 1190)
        y0 = rng.uniform(770, 890)
        stroke(table, [(x0, y0), (x0 + rng.uniform(40, 100), y0 + rng.uniform(-8, 6))],
               (207, 163, 118), 1.5)
    put(im, table, blur=0.4)
    latte_cup(im, 822, 802, 64)
    cake_slice(im, 1022, 796, 74)
    # 桌上小花瓶
    vase = new_layer()
    poly(vase, [(1122, 800), (1160, 800), (1152, 862), (1132, 862)], (176, 198, 214))
    ell(vase, 1141, 800, 19, 7, (196, 214, 226))
    for k in range(3):
        x = 1141 + (k - 1) * 12
        stroke(vase, [(1141, 806), (x, 760)], (128, 156, 128), 2.0)
        for p in range(5):
            a = p * math.tau / 5
            dot(vase, x + math.cos(a) * 6, 756 + math.sin(a) * 6, 4.2, (246, 196, 208))
        dot(vase, x, 756, 2.6, (240, 210, 130))
    put(im, vase, blur=0.4)
    # 桌上書本
    book = new_layer()
    rect(book, 690, 858, 812, 888, (188, 150, 172))
    rect(book, 690, 848, 812, 862, (214, 176, 194))
    rect(book, 698, 840, 804, 850, (246, 228, 230))
    put(im, book, blur=0.5)

    # 近景柔和光斑
    for _ in range(4):
        x, y = rng.uniform(220, 520), rng.uniform(730, 850)
        glow(im, x, y, rng.uniform(40, 90), rng.uniform(20, 40), (255, 240, 200), 38, 1.8)
    return im


def scene_paris(rng, nrng, slot):
    im = grad_bg([(0.0, (146, 126, 192)), (0.24, (206, 156, 192)),
                  (0.47, (247, 190, 170)), (0.66, (255, 215, 173)),
                  (1.0, (255, 244, 224))], nrng=nrng)
    glow(im, 740, 470, 430, 370, (255, 224, 172), 125, 2.3)
    cloud(im, rng, 250, 170, 300, 78, color=(255, 246, 242), shade=(238, 206, 222),
          alpha=165, blur=3.4)
    cloud(im, rng, 610, 120, 250, 62, color=(255, 242, 238), shade=(238, 206, 222),
          alpha=135, blur=3.6)
    cloud(im, rng, 900, 290, 300, 76, color=(255, 236, 220), shade=(240, 208, 200),
          alpha=150, blur=3.4)
    birds(im, rng, 6, 180, 620, 130, 270, mix(NAVY, LAV, 0.45), size=7, alpha=160)
    hills(im, rng, 700, 40, (150, 138, 170), alpha=150, waves=2, blur=2.4)
    lay = new_layer()
    eiffel(lay, 950, 690, 470, mix(NAVY, (122, 100, 146), 0.35),
           mix(NAVY, (255, 218, 172), 0.50))
    put(im, lay, blur=0.4, alpha=245)
    haze(im, 690, 40, (255, 232, 210), 75)
    roof = new_layer()
    for i in range(10):
        x = 10 + i * 122
        hh = rng.uniform(26, 66)
        rect(roof, x, 694 - hh, x + rng.uniform(64, 104), 694, (152, 138, 158))
        poly(roof, [(x - 8, 694 - hh), (x + 42, 694 - hh - 24), (x + 94, 694 - hh)],
             (146, 132, 152))
    put(im, roof, blur=2.2, alpha=120)
    ground = new_layer()
    poly(ground, [(-20, 900), (-20, 712), (280, 698), (700, 692), (1080, 702),
                  (1220, 712), (1220, 900)], (172, 176, 160))
    poly(ground, [(-20, 900), (-20, 822), (300, 800), (760, 804), (1220, 824),
                  (1220, 900)], (216, 198, 176))
    put(im, ground, blur=1.2)
    hedge = new_layer()
    for x in range(-40, 1240, 62):
        ell(hedge, x, 706, 48, 28, mix(SAGE, NAVY, 0.28))
    put(im, hedge, blur=2.6, alpha=235)
    gt = new_layer()
    for _ in range(120):
        x = rng.uniform(-10, 1210)
        y = rng.uniform(716, 890)
        stroke(gt, [(x, y), (x + rng.uniform(-4, 4), y - rng.uniform(5, 12))],
               rng.choice([(150, 156, 138), (162, 168, 148), (140, 146, 130)]),
               1.3, smooth=False)
    put(im, gt, alpha=110)
    for _ in range(14):
        x = rng.uniform(80, 1120)
        y = rng.uniform(800, 890)
        ell(im, x, y, rng.uniform(4, 8), rng.uniform(2, 4),
            rng.choice([(196, 168, 120), (206, 176, 128)]))
    draw_character(im, slot)
    fg = new_layer()
    for _ in range(16):
        grass_tuft(fg, rng, rng.uniform(60, 1140), rng.uniform(820, 895),
                   rng.uniform(10, 20), mix((132, 144, 126), (255, 255, 255), 0.2), n=4)
    put(im, fg, alpha=210)
    return im


def scene_fuji(rng, nrng, slot):
    im = grad_bg([(0.0, (96, 176, 214)), (0.34, (154, 210, 232)),
                  (0.60, (210, 233, 240)), (0.82, (246, 243, 224)),
                  (1.0, (255, 249, 236))], nrng=nrng)
    glow(im, 1040, 110, 300, 250, (255, 250, 220), 85, 2.2)
    cloud(im, rng, 250, 300, 320, 80, color=(255, 253, 248), shade=(224, 226, 238),
          alpha=200, blur=2.0)
    cloud(im, rng, 900, 260, 260, 64, color=(255, 253, 248), shade=(224, 226, 238),
          alpha=170, blur=2.2)
    cloud(im, rng, 640, 430, 360, 76, color=(255, 253, 248), shade=(226, 228, 240),
          alpha=150, blur=2.6)
    birds(im, rng, 4, 800, 1100, 150, 240, mix(NAVY, SKY, 0.3), size=7, alpha=150)
    lay = new_layer()
    fuji(lay, 470, 750, 570, 520, mix((124, 164, 202), WHITE_WARM, 0.12),
         (255, 252, 246), mix((120, 158, 198), NAVY, 0.16), rng)
    put(im, lay, blur=0.4)
    haze(im, 716, 50, (255, 250, 236), 105)
    ground = new_layer()
    top_line = catmull_rom([(-30, 752), (200, 722), (430, 710), (660, 716),
                            (900, 712), (1080, 724), (1230, 742)], 16)
    poly(ground, top_line + [(1230, 920), (-30, 920)], (172, 198, 150))
    for _ in range(14):
        ell(ground, rng.uniform(-30, 1230), rng.uniform(720, 890),
            rng.uniform(90, 220), rng.uniform(16, 42),
            rng.choice([(164, 192, 144), (180, 205, 158), (156, 184, 138)]))
    put(im, ground, blur=1.6)
    haze(im, 712, 12, (255, 250, 236), 70)
    gt = new_layer()
    for _ in range(120):
        x = rng.uniform(0, 1200)
        y = rng.uniform(726, 896)
        stroke(gt, [(x, y), (x + rng.uniform(-4, 4), y - rng.uniform(5, 12))],
               rng.choice([(146, 176, 128), (160, 190, 140), (132, 160, 118)]),
               1.4, smooth=False)
    put(im, gt, alpha=130)
    draw_character(im, slot)
    br = new_layer()
    main_br = cbez((-50, 170), (100, 70), (230, 130), (370, 40), 30)
    taper(br, main_br, 14, 3, (120, 92, 82))
    twig = cbez((200, 100), (260, 60), (320, 120), (400, 96), 20)
    taper(br, twig, 7, 1.5, (120, 92, 82))
    for (bx, by, rr) in ((-20, 150, 52), (70, 96, 54), (175, 108, 48),
                         (270, 74, 46), (360, 66, 40)):
        blossom_cluster(br, rng, bx, by, rr,
                        [(255, 214, 226), (250, 188, 206), (255, 240, 244),
                         (244, 172, 198)], n=30)
    put(im, br, blur=0.7, alpha=245)
    fg = new_layer()
    for _ in range(26):
        x = rng.uniform(60, 1140)
        y = rng.uniform(790, 890)
        col = rng.choice([(255, 250, 240), (255, 214, 226), (250, 238, 168),
                          (214, 208, 244)])
        for k in range(5):
            a = k * math.tau / 5
            dot(fg, x + math.cos(a) * 3.4, y + math.sin(a) * 3.4, 1.8, col)
        dot(fg, x, y, 1.6, (240, 200, 110))
    for _ in range(20):
        grass_tuft(fg, rng, rng.uniform(60, 1140), rng.uniform(800, 896),
                   rng.uniform(10, 22), mix((124, 160, 116), (255, 255, 255), 0.2), n=4)
    put(im, fg, alpha=225)
    return im


def scene_okinawa(rng, nrng, slot):
    im = grad_bg([(0.0, (88, 182, 226)), (0.30, (152, 216, 238)),
                  (0.48, (222, 240, 236)), (0.55, (255, 247, 226)),
                  (1.0, (255, 248, 232))], nrng=nrng)
    glow(im, 960, 150, 240, 240, (255, 248, 216), 170, 2.2)
    dot(im, 960, 150, 46, (255, 250, 228))
    cloud(im, rng, 250, 190, 280, 70, color=(255, 253, 250), shade=(222, 230, 238),
          alpha=190, blur=2.2)
    cloud(im, rng, 760, 300, 220, 54, color=(255, 252, 246), shade=(224, 228, 236),
          alpha=150, blur=2.4)
    sea = grad_bg([(0.0, (156, 230, 222)), (0.5, (94, 202, 204)), (1.0, (56, 162, 184))])
    im.paste(sea.crop((0, px(500), SW, px(704))), (0, px(500)))
    stroke(im, [(-20, 500), (1220, 500)], (243, 248, 232), 2.6, smooth=False)
    haze(im, 512, 16, (255, 252, 240), 70)
    waves = new_layer()
    for i in range(16):
        y = 520 + i * 12
        pts = [(x, y + 5 * math.sin(x / 70.0 + i * 0.8)) for x in range(-20, 1221, 50)]
        stroke(waves, pts, mix((214, 242, 238), (60, 174, 190), i / 16.0),
               rng.uniform(1.2, 2.6), smooth=True)
    for _ in range(46):
        x = 960 + rng.uniform(-120, 120)
        y = rng.uniform(510, 700)
        dot(waves, x, y, rng.uniform(1.0, 2.6), (255, 250, 220))
    put(im, waves, alpha=180)
    sand = grad_bg([(0.0, (252, 240, 210)), (1.0, (243, 221, 178))])
    im.paste(sand.crop((0, px(690), SW, SH)), (0, px(690)))
    foam = new_layer()
    for k in range(3):
        y = 700 + k * 9
        pts = [(x, y + 4 * math.sin(x / 90.0 + k)) for x in range(-20, 1221, 60)]
        stroke(foam, pts, (255, 253, 244), 3.2 - k * 0.7, smooth=True)
    put(im, foam, blur=1.2, alpha=190)
    st = new_layer()
    for _ in range(160):
        dot(st, rng.uniform(0, 1200), rng.uniform(720, 895), rng.uniform(1, 2.6),
            rng.choice([(236, 214, 172), (248, 230, 192), (226, 202, 160)]))
    put(im, st, alpha=120)
    lay = new_layer()
    palm(lay, rng, 128, 806, 520, (58, 108, 106), lean=0.14)
    put(im, lay, blur=0.6, alpha=235)
    draw_character(im, slot)
    lay = new_layer()
    palm(lay, rng, 1108, 900, 660, (48, 92, 92), lean=-0.12)
    put(im, lay, blur=1.0, alpha=235)
    fg = new_layer()
    for _ in range(14):
        grass_tuft(fg, rng, rng.uniform(60, 1140), rng.uniform(820, 895),
                   rng.uniform(12, 26), mix((116, 160, 128), (255, 255, 255), 0.15), n=4)
    for cx, cy, r in ((250, 852, 20), (1000, 862, 24), (520, 878, 16)):
        poly(fg, star_pts(cx, cy, r, inner=0.46, n=5, rot=-math.pi / 2),
             (240, 174, 168), (214, 138, 138), 1.0)
        for k in range(5):
            a = -math.pi / 2 + k * math.tau / 5
            dot(fg, cx + math.cos(a) * r * 0.5, cy + math.sin(a) * r * 0.5,
                r * 0.10, (250, 208, 196))
    for cx, cy, s in ((760, 846, 16), (1120, 800, 12)):
        for k in range(5):
            a = -math.pi / 2 + (k - 2) * 0.35
            stroke(fg, [(cx, cy), (cx + math.cos(a) * s, cy + math.sin(a) * s)],
                   (250, 240, 224), 2.0, smooth=False)
    put(im, fg, blur=0.4, alpha=240)
    return im


def scene_taipei(rng, nrng, slot):
    im = grad_bg([(0.0, (18, 22, 46)), (0.28, (34, 36, 72)),
                  (0.55, (64, 50, 92)), (0.76, (104, 72, 96)),
                  (1.0, (138, 94, 94))], nrng=nrng)
    for _ in range(80):
        dot(im, rng.uniform(10, 1190), rng.uniform(20, 420), rng.uniform(0.7, 1.8),
            (222, 228, 220))
    crescent(im, 960, 142, 48, rot=-0.7)
    cloud(im, rng, 300, 260, 360, 60, color=(72, 66, 104), shade=(50, 48, 84),
          alpha=110, blur=3.2)
    cloud(im, rng, 850, 330, 300, 50, color=(78, 68, 104), shade=(52, 48, 84),
          alpha=90, blur=3.0)
    hills(im, rng, 616, 36, (30, 32, 58), alpha=230, waves=2, blur=1.6)
    lay = new_layer()
    city_skyline(lay, rng, 704, -20, 1220, (23, 27, 48),
                 [(255, 214, 140), (255, 232, 168), (240, 190, 112)],
                 [(150, 196, 220), (200, 214, 226)], min_h=46, max_h=150)
    taipei101(lay, 1010, 704, 360, (21, 25, 46), (255, 224, 156))
    put(im, lay, blur=0.5, alpha=250)
    haze(im, 700, 22, (255, 196, 140), 45)
    lay = new_layer()
    string = qbez((-30, 238), (180, 268), (420, 172), 80)
    stroke(lay, string, (120, 96, 76), 2.2, smooth=False)
    for i in range(4):
        t = (i + 0.5) / 4
        idx = int(t * (len(string) - 1))
        p = string[idx]
        lantern(lay, p[0], p[1] + 26, 19, (232, 118, 100))
    put(im, lay, blur=0.4, alpha=245)
    for i in range(4):
        t = (i + 0.5) / 4
        idx = int(t * (len(string) - 1))
        p = string[idx]
        glow(im, p[0], p[1] + 26, 62, 62, (255, 176, 120), 85, 2.0)
    lay = new_layer()
    for (x, y) in ((1120, 250), (1180, 340)):
        lantern(lay, x, y, 17, (226, 120, 104))
    put(im, lay, blur=0.4, alpha=235)
    for (x, y) in ((1120, 250), (1180, 340)):
        glow(im, x, y, 58, 58, (255, 174, 120), 80, 2.0)
    street = new_layer()
    poly(street, [(-20, 900), (-20, 724), (300, 710), (700, 706), (1080, 714),
                  (1220, 724), (1220, 900)], (46, 44, 70))
    for _ in range(7):
        ell(street, rng.uniform(100, 1100), rng.uniform(740, 870),
            rng.uniform(60, 130), rng.uniform(14, 30), (196, 146, 96))
    put(im, street, blur=5.0, alpha=155)
    refl = new_layer()
    for x in (140, 260, 360, 1120, 1180):
        taper(refl, [(x, 724), (x + rng.uniform(-10, 10), 790), (x, 860)],
              12, 3, (255, 178, 108))
    put(im, refl, blur=3.2, alpha=90)
    draw_character(im, slot)
    for _ in range(10):
        x = rng.uniform(60, 1140)
        y = rng.uniform(760, 890)
        glow(im, x, y, rng.uniform(20, 60), rng.uniform(8, 20), (255, 196, 130), 40, 1.8)
    return im


def scene_alps(rng, nrng, slot):
    im = grad_bg([(0.0, (158, 196, 228)), (0.36, (198, 222, 238)),
                  (0.68, (230, 240, 244)), (1.0, (250, 248, 240))], nrng=nrng)
    glow(im, 990, 130, 280, 240, (255, 250, 228), 80, 2.2)
    lay = new_layer()
    fuji(lay, 300, 690, 380, 330, (154, 184, 210), (246, 250, 252), (130, 158, 190), rng)
    fuji(lay, 880, 700, 420, 300, (146, 178, 206), (244, 248, 252), (124, 152, 186), rng)
    put(im, lay, blur=1.2, alpha=195)
    lay = new_layer()
    fuji(lay, 560, 720, 520, 380, (176, 202, 222), (250, 252, 252), (148, 176, 202), rng)
    put(im, lay, blur=0.5, alpha=245)
    haze(im, 705, 30, (255, 252, 244), 100)
    ground = new_layer()
    poly(ground, [(-20, 900), (-20, 736), (260, 716), (640, 710), (980, 716),
                  (1220, 734), (1220, 900)], (242, 246, 250))
    for _ in range(12):
        ell(ground, rng.uniform(-30, 1230), rng.uniform(730, 880),
            rng.uniform(90, 220), rng.uniform(14, 38),
            rng.choice([(230, 238, 248), (248, 250, 253)]))
    put(im, ground, blur=5.0, alpha=160)
    sh = new_layer()
    for _ in range(8):
        stroke(sh, [(rng.uniform(0, 1200), rng.uniform(760, 860)),
                    (rng.uniform(0, 1200), rng.uniform(790, 890))],
               (196, 212, 232), rng.uniform(2, 5), smooth=True)
    put(im, sh, blur=3.0, alpha=100)
    lay = new_layer()
    snowy_pine(lay, rng, 120, 810, 360, (64, 96, 108), (250, 252, 252), w=150)
    snowy_pine(lay, rng, 220, 838, 260, (70, 102, 112), (250, 252, 252), w=112)
    put(im, lay, blur=0.6)
    cab = new_layer()
    rect(cab, 986, 700, 1078, 770, (122, 92, 74))
    poly(cab, [(974, 702), (1032, 664), (1090, 702)], (250, 252, 252))
    rect(cab, 1010, 722, 1030, 742, (255, 206, 130))
    stroke(cab, [(1032, 664), (1032, 648)], (84, 72, 66), 2.4)
    put(im, cab, blur=0.4)
    glow(im, 1020, 732, 40, 34, (255, 208, 140), 90, 2.0)
    draw_character(im, slot)
    fg = new_layer()
    for _ in range(10):
        ell(fg, rng.uniform(0, 1200), rng.uniform(840, 900),
            rng.uniform(80, 180), rng.uniform(14, 26), (250, 252, 254))
    put(im, fg, blur=2.0, alpha=180)
    snow = new_layer()
    for _ in range(150):
        x, y = rng.uniform(0, 1200), rng.uniform(40, 890)
        r = rng.uniform(1.4, 4.4)
        dot(snow, x, y, r, (255, 255, 252))
        if r > 3.2:
            dot(snow, x, y, r * 0.4, (255, 255, 255))
    put(im, snow, blur=0.5, alpha=150)
    snow2 = new_layer()
    for _ in range(12):
        dot(snow2, rng.uniform(0, 1200), rng.uniform(60, 880), rng.uniform(5, 9),
            (255, 255, 252))
    put(im, snow2, blur=2.6, alpha=120)
    return im


def scene_scream(rng, nrng, slot):
    xx = XX / SS
    yy = YY / SS
    warp = (22.0 * np.sin(xx / 95.0) + 14.0 * np.sin(xx / 38.0 + 1.2) +
            9.0 * np.sin(xx / 18.0 + 2.4) + 7.0 * np.sin(yy / 70.0))
    t = np.clip((yy + warp) / 585.0, 0.0, 1.0)
    sky_stops = [(0.0, (196, 62, 48)), (0.20, (228, 96, 58)), (0.42, (244, 142, 76)),
                 (0.62, (248, 182, 118)), (0.80, (246, 218, 172)), (1.0, (233, 231, 200))]
    pos = np.array([s[0] for s in sky_stops])
    cols = np.array([s[1] for s in sky_stops], dtype=np.float32)
    sky_arr = np.stack([np.interp(t.ravel(), pos, cols[:, i]) for i in range(3)],
                       axis=1).reshape(SH, SW, 3)
    warp2 = (18.0 * np.sin(xx / 78.0 + 0.7) + 12.0 * np.sin(xx / 31.0 - 0.5) +
             8.0 * np.sin(yy / 50.0))
    t2 = np.clip((yy - 545.0 + warp2) / 330.0, 0.0, 1.0)
    water_stops = [(0.0, (214, 210, 172)), (0.12, (142, 192, 196)),
                   (0.42, (72, 148, 172)), (0.72, (44, 112, 148)), (1.0, (30, 82, 118))]
    pos2 = np.array([s[0] for s in water_stops])
    cols2 = np.array([s[1] for s in water_stops], dtype=np.float32)
    wat = np.stack([np.interp(t2.ravel(), pos2, cols2[:, i]) for i in range(3)],
                   axis=1).reshape(SH, SW, 3)
    mixmask = np.clip((yy - 548.0) / 22.0, 0.0, 1.0)[..., None]
    arr = sky_arr * (1.0 - mixmask) + wat * mixmask
    arr += nrng.normal(0, 0.7, arr.shape).astype(np.float32)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    brush_field(im, rng, 90, (-40, 1240), (20, 610),
                [(226, 92, 60), (246, 150, 84), (236, 120, 70), (250, 178, 110)],
                w=(6, 16), l=(60, 160), curve=22, alpha=110)
    wav = new_layer()
    for k in range(7):
        y0 = 80 + k * 78
        pts = []
        for x in np.linspace(-40, 1240, 80):
            pts.append((x, y0 + 26 * math.sin(x / 90.0 + k * 0.9) +
                        12 * math.sin(x / 33.0 + k)))
        stroke(wav, pts, mix((232, 96, 58), (250, 200, 130), k / 7.0), 4.0, smooth=True)
    put(im, wav, blur=1.4, alpha=110)
    wav2 = new_layer()
    for k in range(8):
        y0 = 570 + k * 34
        pts = [(x, y0 + 12 * math.sin(x / 60.0 + k)) for x in np.linspace(-40, 1240, 70)]
        stroke(wav2, pts, mix((24, 76, 112), (160, 208, 200), k / 8.0), 4.0, smooth=True)
    put(im, wav2, blur=1.2, alpha=140)
    deck = new_layer()
    poly(deck, [(-20, 818), (520, 782), (1220, 722), (1220, 960), (-20, 960)],
         (38, 58, 80))
    stroke(deck, [(-20, 818), (520, 782), (1220, 722)], (112, 150, 178), 4.0, smooth=True)
    for i in range(15):
        tt = i / 14.0
        x0 = -20 + tt * 1240
        y0 = 818 - tt * 96
        stroke(deck, [(x0, y0), (x0 - 12, 960)], (30, 46, 66), 2.0)
    put(im, deck, blur=0.3)
    rail = new_layer()
    upper = [(-20, 718), (400, 688), (800, 652), (1220, 610)]
    lower = [(-20, 792), (400, 752), (800, 712), (1220, 668)]
    su = catmull_rom(upper, 14)
    sl = catmull_rom(lower, 14)
    stroke(rail, su, (33, 48, 70), 8.0, smooth=False)
    stroke(rail, sl, (33, 48, 70), 8.0, smooth=False)
    stroke(rail, [(p[0], p[1] - 2.4) for p in su], (108, 146, 172), 2.4)
    stroke(rail, [(p[0], p[1] - 2.4) for p in sl], (104, 142, 168), 2.0)
    for tt in np.linspace(0.02, 0.98, 11):
        x = -20 + tt * 1240
        yu = 718 - tt * 108
        yl = 792 - tt * 124
        stroke(rail, [(x, yu), (x, yl)], (33, 48, 70), 6.0)
        dot(rail, x, yu - 3, 5.0, (48, 68, 92))
    put(im, rail, blur=0.4)
    fig = new_layer()
    two_figures(fig, 296, 806, 92, (26, 36, 54))
    two_figures(fig, 356, 800, 78, (30, 42, 60))
    put(im, fig, blur=0.7, alpha=235)
    draw_character(im, slot)
    for _ in range(10):
        x = rng.uniform(40, 1160)
        y = rng.uniform(820, 890)
        glow(im, x, y, rng.uniform(20, 50), rng.uniform(6, 16), (180, 214, 210), 30, 1.8)
    return im


def scene_mona(rng, nrng, slot):
    im = grad_bg([(0.0, (120, 138, 112)), (0.28, (154, 160, 124)),
                  (0.52, (182, 172, 134)), (0.74, (200, 184, 142)),
                  (1.0, (206, 186, 148))], nrng=nrng)
    glow(im, 640, 200, 480, 360, (246, 240, 210), 85, 1.8)
    lay = new_layer()
    hills(lay, rng, 486, 100, (106, 132, 124), alpha=235, waves=3, blur=2.6)
    hills(lay, rng, 556, 70, (130, 152, 136), alpha=225, waves=2, blur=1.8)
    put(im, lay)
    peak = new_layer()
    poly(peak, [(700, 520), (800, 360), (848, 392), (910, 330), (990, 450),
                (1080, 500), (1140, 540), (1140, 580), (700, 580)], (112, 136, 128))
    poly(peak, [(910, 330), (960, 356), (1010, 420), (960, 470), (930, 520), (900, 470)],
         (104, 126, 118))
    poly(peak, [(1000, 430), (1050, 380), (1110, 430), (1130, 520), (1000, 520)],
         (120, 140, 128))
    put(im, peak, blur=4.5, alpha=175)
    ridge = new_layer()
    for k in range(4):
        y = 470 + k * 26
        pts = [(x, y + 12 * math.sin(x / 110.0 + k)) for x in np.linspace(-40, 1240, 50)]
        stroke(ridge, pts, (94, 120, 112), 2.4, smooth=True)
    put(im, ridge, blur=2.6, alpha=120)
    river = new_layer()
    taper(river, cbez((600, 500), (540, 566), (600, 640), (470, 760), 40),
          64, 22, (206, 218, 188))
    taper(river, cbez((560, 560), (520, 620), (560, 690), (500, 780), 36),
          38, 12, (190, 204, 176))
    put(im, river, blur=1.4, alpha=215)
    valley = new_layer()
    for k in range(4):
        y = 600 + k * 42
        pts = [(x, y + 10 * math.sin(x / 140.0 + k)) for x in np.linspace(-40, 1240, 50)]
        stroke(valley, pts, (176, 186, 148), 3.0, smooth=True)
    put(im, valley, blur=2.0, alpha=90)
    veg = new_layer()
    ell(veg, 110, 910, 300, 200, (80, 94, 68))
    ell(veg, 1090, 920, 330, 220, (76, 90, 66))
    ell(veg, 30, 810, 170, 130, (72, 86, 62))
    for _ in range(18):
        x = rng.choice([rng.uniform(0, 260), rng.uniform(940, 1200)])
        y = rng.uniform(820, 898)
        grass_tuft(veg, rng, x, y, rng.uniform(16, 30), (72, 86, 62), n=4)
    put(im, veg, blur=4.0, alpha=235)
    haze(im, 860, 90, (222, 214, 174), 45)
    draw_character(im, slot)
    return im


def scene_sunflowers(rng, nrng, slot):
    im = grad_bg([(0.0, (250, 222, 152)), (0.35, (242, 200, 126)),
                  (0.70, (228, 176, 102)), (1.0, (206, 150, 84))], nrng=nrng)
    brush_field(im, rng, 100, (-20, 1220), (10, 740),
                [(246, 214, 140), (236, 190, 116), (252, 230, 168)],
                w=(5, 13), l=(50, 130), curve=16, alpha=80)
    glow(im, 220, 120, 360, 300, (255, 246, 206), 80, 2.0)
    table = new_layer()
    poly(table, [(-20, 900), (-20, 790), (300, 764), (760, 750), (1220, 766),
                 (1220, 900)], (186, 132, 82))
    poly(table, [(-20, 900), (-20, 812), (300, 788), (760, 774), (1220, 790),
                 (1220, 900)], (206, 152, 98))
    stroke(table, [(-20, 790), (300, 764), (760, 750), (1220, 766)],
           (224, 176, 122), 4.0, smooth=True)
    vase = new_layer()
    body = [(878, 658), (926, 658), (938, 700), (928, 748), (910, 762),
            (894, 762), (876, 748), (866, 700)]
    smooth_poly(vase, body, (148, 184, 200))
    ell(vase, 902, 658, 24, 8, (178, 208, 218))
    ell(vase, 902, 659, 18, 5, (116, 150, 166))
    ell(vase, 902, 758, 22, 6, (128, 164, 180))
    stroke(vase, [(883, 682), (888, 726), (898, 750)], (200, 222, 230), 4.0, smooth=True)
    put(im, vase, blur=0.4)
    flowers = [((812, 330), 56, -0.16), ((930, 262), 62, 0.05), ((1030, 356), 56, 0.28),
               ((948, 446), 68, 0.12), ((762, 424), 48, -0.34), ((1006, 534), 52, 0.36)]
    stems = new_layer()
    for (fx, fy), rr, lean in flowers:
        pts = cbez((902, 664), (902 + lean * 60, (664 + fy) / 2),
                   (fx - lean * 30, fy + 70), (fx, fy + rr * 0.5), 26)
        stroke(stems, pts, (104, 132, 88), 5.0, smooth=True)
        leaf(stems, rng, fx - 34, fy + 110, -0.9 + lean, 46, 22, (112, 146, 92))
        leaf(stems, rng, fx + 22, fy + 150, 0.5 + lean, 40, 19, (122, 156, 100))
    put(im, stems, blur=0.5)
    lay = new_layer()
    for (fx, fy), rr, lean in flowers:
        sunflower(lay, rng, fx, fy, rr, (249, 207, 96), (238, 183, 68),
                  (116, 76, 40), (86, 56, 28))
    put(im, lay, blur=0.5)
    for _ in range(14):
        x = rng.uniform(700, 1180)
        y = rng.uniform(800, 880)
        petal = petal_points(x, y, rng.uniform(10, 16), rng.uniform(5, 8),
                             rng.uniform(0, math.tau))
        poly(im, petal, rng.choice([(236, 188, 84), (226, 172, 68), (242, 202, 108)]),
             (192, 140, 56), 0.6)
    draw_character(im, slot)
    petal_rain(im, rng, 5, 40, 1160, 780, 890,
               [(242, 198, 108), (232, 180, 72)], size=(14, 22), alpha=150, blur=1.6)
    return im


def scene_pearl(rng, nrng, slot):
    im = grad_bg([(0.0, (8, 20, 24)), (0.45, (15, 34, 40)), (1.0, (24, 44, 48))],
                 nrng=nrng)
    glow(im, 680, 340, 470, 430, (255, 230, 184), 55, 1.6)
    # 藍色絲絨垂幔（從頂端垂下，帶褶皺與金線滾邊）
    drape = new_layer()
    pts = [(-40, -40), (700, -40), (690, 40), (640, 140), (560, 210), (470, 250),
           (390, 320), (300, 300), (210, 340), (120, 300), (30, 320), (-40, 280)]
    smooth_poly(drape, pts, (44, 98, 140))
    for k in range(7):
        x0 = 20 + k * 95
        pts2 = cbez((x0 + 40, -30), (x0 + 20, 80), (x0 + 50, 180), (x0 + 20, 280), 20)
        stroke(drape, pts2, (58, 112, 152) if k % 2 else (30, 74, 112), 12, smooth=True)
    hemline = [(-40, 280), (30, 320), (120, 300), (210, 340), (300, 300),
               (390, 320), (470, 250), (560, 210), (640, 140)]
    hem_pts = catmull_rom(hemline, 12)
    stroke(drape, hem_pts, (76, 126, 164), 6.0, smooth=False)
    stroke(drape, [(p[0], p[1] + 8) for p in hem_pts], (198, 160, 86), 1.8, smooth=False)
    put(im, drape, blur=1.0, alpha=225)
    # 黃色布料（左下，褶皺）
    cloth = new_layer()
    cpts = [(-40, 900), (-40, 806), (70, 776), (190, 796), (330, 764),
            (470, 800), (610, 778), (720, 852), (768, 900)]
    smooth_poly(cloth, cpts, (206, 158, 72))
    for k in range(7):
        pts3 = cbez((-20, 812 + k * 8), (170, 786 + k * 7), (400, 796 + k * 6),
                    (700, 852 + k * 7), 24)
        stroke(cloth, pts3, (236, 196, 114) if k % 2 == 0 else (172, 122, 44),
               8.0, smooth=True)
    for k in range(4):
        x0 = 80 + k * 150
        stroke(cloth, [ (x0, 790), (x0 + 30, 830), (x0 + 10, 880), (x0 + 48, 900) ],
               (188, 138, 56), 5.0, smooth=True)
    stroke(cloth, catmull_rom(cpts[1:-1], 10), (246, 210, 130), 3.0, smooth=False)
    put(im, cloth, blur=1.2, alpha=235)
    # 大珍珠耳環
    pearl_ornament(im, 292, 350, 68)
    draw_character(im, slot)
    for _ in range(26):
        x, y = rng.uniform(200, 1080), rng.uniform(160, 740)
        dot(im, x, y, rng.uniform(0.8, 2.0), (244, 220, 164))
    return im


def scene_books(rng, nrng, slot):
    im = grad_bg([(0.0, (246, 238, 222)), (0.5, (240, 228, 206)),
                  (1.0, (228, 210, 182))], nrng=nrng)
    glow(im, 250, 160, 300, 260, (255, 244, 218), 65, 2.2)
    shelf = new_layer()
    wood = (168, 126, 92)
    rect(shelf, 60, 100, 1140, 640, wood)
    rect(shelf, 82, 120, 1118, 620, (108, 80, 60))
    shelves_y = [150, 280, 410, 540, 620]
    for y in shelves_y:
        rect(shelf, 76, y - 16, 1124, y, (198, 156, 118))
        rect(shelf, 76, y - 16, 1124, y - 11, (216, 176, 136))
    book_cols = [(216, 150, 126), (240, 188, 118), (156, 186, 158), (176, 158, 208),
                 (238, 166, 182), (150, 190, 202), (204, 176, 136), (188, 138, 100),
                 (160, 168, 200), (226, 196, 130)]
    for y in shelves_y[:-1]:
        x = 92
        while x < 1104:
            w = rng.uniform(14, 28)
            h = rng.uniform(66, 108)
            col = rng.choice(book_cols)
            if rng.random() < 0.12:
                poly(shelf, [(x, y - 16), (x + w, y - 16), (x + w + 14, y - 16 - h),
                             (x + 14, y - 16 - h)], col, darken(col, 0.22), 0.8)
                x += w + 18
            else:
                rect(shelf, x, y - 16 - h, x + w, y - 16, col)
                rect(shelf, x, y - 16 - h, x + w, y - 16 - h + 7, lighten(col, 0.28))
                rect(shelf, x, y - 16 - h, x + w, y - 16, None, darken(col, 0.25), 0.7)
                x += w + rng.uniform(2, 6)
    rect(shelf, 900, 135, 1000, 148, (232, 214, 176))
    ell(shelf, 950, 135, 26, 26, (176, 198, 168))
    put(im, shelf, blur=0.35)
    floor = new_layer()
    poly(floor, [(-20, 900), (-20, 690), (300, 676), (700, 672), (1100, 682),
                 (1220, 692), (1220, 900)], (198, 154, 110))
    for k in range(6):
        y = 706 + k * 34
        stroke(floor, [(-20, y), (420, y - 4), (1220, y + 2)],
               (174, 130, 90), 2.0, smooth=True)
    put(im, floor, blur=0.4)
    rug = new_layer()
    ell(rug, 500, 812, 370, 84, (214, 176, 174))
    ell(rug, 500, 812, 340, 70, (238, 210, 202))
    ell(rug, 500, 812, 280, 54, (226, 192, 188))
    for k in range(30):
        a = k * math.tau / 30
        dot(rug, 500 + math.cos(a) * 306, 812 + math.sin(a) * 62, 3.0, (246, 224, 214))
    put(im, rug, blur=0.6)
    lamp = new_layer()
    stroke(lamp, [(1050, 900), (1050, 640)], (120, 96, 76), 7.0, smooth=False)
    poly(lamp, [(1000, 640), (1100, 640), (1078, 548), (1022, 548)], (255, 238, 196))
    ell(lamp, 1050, 640, 50, 10, (255, 248, 210))
    put(im, lamp)
    glow(im, 1050, 620, 180, 160, (255, 232, 160), 100, 2.0)
    lay = new_layer()
    book_stack(lay, rng, 820, 862, 5, book_cols)
    book_stack(lay, rng, 180, 870, 4, book_cols)
    rect(lay, 1110, 846, 1180, 878, (170, 150, 196))
    rect(lay, 1110, 838, 1180, 850, (196, 178, 216))
    put(im, lay, blur=0.4)
    draw_character(im, slot)
    fg = new_layer()
    rect(fg, 300, 872, 430, 896, (196, 160, 140))
    rect(fg, 300, 860, 430, 876, (226, 190, 166))
    put(im, fg, blur=0.4)
    return im


def scene_rain(rng, nrng, slot):
    im = grad_bg([(0.0, (250, 242, 226)), (0.5, (244, 232, 212)),
                  (1.0, (232, 216, 192))], nrng=nrng)
    glow(im, 300, 160, 320, 260, (255, 246, 220), 55, 2.2)
    wx0, wy0, wx1, wy1 = 84, 92, 640, 586
    out = new_layer()
    rect(out, wx0, wy0, wx1, wy1, (196, 212, 222))
    rect(out, wx0, wy0, wx1, wy0 + 190, (172, 198, 216))
    for i in range(9):
        bx = wx0 + 10 + i * 62
        bh = rng.uniform(70, 170)
        rect(out, bx, wy1 - bh, bx + rng.uniform(34, 56), wy1, (118, 138, 158))
        for _ in range(4):
            wx = bx + rng.uniform(6, 30)
            wy = wy1 - rng.uniform(20, bh - 20)
            rect(out, wx, wy, wx + 6, wy + 8, (238, 210, 150))
    for _ in range(5):
        ell(out, rng.uniform(wx0, wx1), wy1 - 30, rng.uniform(26, 52),
            rng.uniform(30, 60), (108, 132, 122))
    crop = out.crop((px(wx0), px(wy0), px(wx1), px(wy1))).filter(
        ImageFilter.GaussianBlur(3.6 * SS))
    im.paste(crop, (px(wx0), px(wy0)))
    rain = new_layer()
    for _ in range(90):
        x = rng.uniform(wx0 + 8, wx1 - 8)
        y = rng.uniform(wy0 + 8, wy1 - 8)
        r = rng.uniform(2.0, 5.2)
        ell(rain, x, y, r, r * 1.18, (210, 226, 236), (176, 200, 218), 0.7)
        dot(rain, x - r * 0.3, y - r * 0.4, r * 0.28, (246, 252, 255))
    for _ in range(26):
        x = rng.uniform(wx0 + 8, wx1 - 8)
        y = rng.uniform(wy0 + 8, wy1 - 40)
        L = rng.uniform(18, 60)
        stroke(rain, [(x, y), (x + rng.uniform(-4, 4), y + L)],
               (214, 230, 240), rng.uniform(1.0, 2.2), smooth=False)
    put(im, rain, blur=0.3, alpha=200)
    mist = new_layer()
    rect(mist, wx0, wy0, wx1, wy1, (230, 240, 244))
    hole = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(hole).rectangle(
        [px(wx0 + 16), px(wy0 + 16), px(wx1 - 16), px(wy1 - 16)], fill=255)
    mist.putalpha(ImageChops.subtract(mist.getchannel("A"), hole))
    mist = mist.filter(ImageFilter.GaussianBlur(9 * SS))
    set_alpha(mist, 55)
    im.alpha_composite(mist)
    win = new_layer()
    rect(win, 60, 68, 664, 610, None, (246, 236, 218), 18)
    rect(win, 84, 92, 640, 586, None, (216, 198, 172), 4)
    rect(win, 362, 92, 380, 586, (244, 234, 216))
    rect(win, 84, 334, 640, 352, (244, 234, 216))
    put(im, win, blur=0.3)
    rect(im, 60, 600, 664, 632, (246, 236, 218))
    rect(im, 60, 632, 664, 640, (222, 204, 178))
    mug = new_layer()
    rect(mug, 150, 566, 214, 606, (250, 242, 226))
    ell(mug, 182, 566, 32, 10, (255, 250, 238))
    stroke(mug, cbez((214, 578), (238, 580), (238, 600), (214, 598), 12),
           (250, 242, 226), 8, smooth=False)
    for k in range(3):
        pts = cbez((170 + k * 9, 560), (180 + k * 9, 530), (160 + k * 9, 500),
                   (172 + k * 9, 470), 14)
        stroke(mug, pts, (255, 252, 244), 3.0, smooth=True)
    put(im, mug, blur=0.4)
    potted_plant(im, 560, 600, 92, pot=(198, 148, 126), leaf=(120, 158, 122))
    floor = new_layer()
    poly(floor, [(-20, 900), (-20, 700), (280, 684), (700, 680), (1100, 690),
                 (1220, 700), (1220, 900)], (202, 158, 112))
    for k in range(6):
        y = 716 + k * 32
        stroke(floor, [(-20, y), (420, y - 4), (1220, y + 2)],
               (178, 134, 92), 2.0, smooth=True)
    put(im, floor, blur=0.4)
    light = new_layer()
    poly(light, [(90, 700), (640, 700), (760, 900), (250, 900)], (210, 230, 236))
    put(im, light, blur=18.0, alpha=32)
    draw_character(im, slot)
    for _ in range(16):
        x, y = rng.uniform(80, 1120), rng.uniform(740, 890)
        glow(im, x, y, rng.uniform(14, 40), rng.uniform(4, 12), (240, 246, 250), 26, 1.8)
    return im


def scene_birthday(rng, nrng, slot):
    im = grad_bg([(0.0, (255, 246, 228)), (0.45, (255, 236, 214)),
                  (0.78, (252, 226, 202)), (1.0, (246, 216, 190))], nrng=nrng)
    glow(im, 200, 140, 320, 260, (255, 246, 214), 55, 2.2)
    bunt = new_layer()
    cols = [PINK, BUTTER, SKY, LAV, (243, 172, 148), (176, 216, 186)]
    bunting_string(bunt, rng, -20, 70, 650, 118, 66, cols, size=30, n=8)
    bunting_string(bunt, rng, 560, 62, 1230, 96, 58, cols[::-1], size=28, n=8)
    put(im, bunt, blur=0.4)
    bal = new_layer()
    balloon(bal, 128, 250, 46, 56, (244, 172, 176), 806)
    balloon(bal, 208, 196, 38, 48, (248, 210, 150), 812)
    balloon(bal, 64, 322, 34, 44, (188, 200, 236), 818)
    put(im, bal, blur=0.4)
    bal2 = new_layer()
    balloon(bal2, 1076, 240, 48, 58, (248, 196, 170), 806)
    balloon(bal2, 1152, 304, 36, 46, (176, 214, 198), 818)
    put(im, bal2, blur=0.4)
    floor = new_layer()
    poly(floor, [(-20, 900), (-20, 780), (300, 766), (700, 762), (1100, 772),
                 (1220, 782), (1220, 900)], (226, 198, 166))
    for k in range(4):
        y = 800 + k * 30
        stroke(floor, [(-20, y), (420, y - 4), (1220, y + 2)],
               (208, 178, 146), 2.0, smooth=True)
    put(im, floor, blur=0.4)
    draw_character(im, slot)
    table = new_layer()
    poly(table, [(690, 900), (748, 792), (1152, 770), (1240, 900)], (214, 170, 122))
    poly(table, [(700, 896), (756, 798), (1148, 776), (1232, 896)], (230, 188, 140))
    poly(table, [(700, 896), (756, 798), (908, 790), (960, 900)], (252, 232, 222))
    for k in range(5):
        dot(table, 754 + k * 40, 824 + k * 14, 3.0, (238, 190, 196))
    stroke(table, [(748, 792), (1152, 770)], (248, 216, 172), 5.0, smooth=True)
    put(im, table, blur=0.4)
    birthday_cake(im, 960, 798, 84)
    gifts = new_layer()
    rect(gifts, 120, 836, 232, 900, (238, 196, 160))
    rect(gifts, 120, 836, 232, 862, (250, 214, 180))
    rect(gifts, 164, 836, 188, 900, (230, 170, 176))
    stroke(gifts, [(176, 790), (176, 836)], (230, 170, 176), 5.0)
    ell(gifts, 176, 786, 14, 8, (230, 170, 176))
    rect(gifts, 262, 862, 344, 900, (196, 214, 192))
    rect(gifts, 262, 862, 344, 880, (216, 230, 208))
    rect(gifts, 296, 862, 312, 900, (240, 208, 150))
    put(im, gifts, blur=0.4)
    confetti(im, rng, 105, 30, 1170, 60, 640,
             [PINK, BUTTER, SKY, LAV, (243, 172, 148), (176, 216, 186)])
    return im


# ===========================================================================
# 場景註冊（逐步擴充）
# ===========================================================================
SCENES = [
    dict(tag="tokyo", file="travel-tokyo.jpg", fn=scene_tokyo,
         x=0.44, ground=0.82, h=0.68, flip=False,
         shadow=(142, 104, 116), shadow_dx=-0.05, frame=False, vig=0.14,
         gain=(1.02, 1.0, 0.99), sat=1.0),
    dict(tag="paris", file="travel-paris.jpg", fn=scene_paris,
         x=0.35, ground=0.84, h=0.66, flip=False,
         shadow=(118, 98, 138), shadow_dx=-0.05, frame=False, vig=0.14,
         gain=(1.02, 1.0, 0.98), sat=1.0),
    dict(tag="fuji", file="travel-fuji.jpg", fn=scene_fuji,
         x=0.66, ground=0.84, h=0.71, flip=True,
         shadow=(116, 138, 168), shadow_dx=0.05, frame=False, vig=0.13,
         gain=(1.0, 1.0, 1.0), sat=1.0),
    dict(tag="okinawa", file="travel-okinawa.jpg", fn=scene_okinawa,
         x=0.33, ground=0.86, h=0.64, flip=False,
         shadow=(102, 124, 116), shadow_dx=-0.04, frame=False, vig=0.14,
         gain=(1.02, 1.0, 0.98), sat=1.0),
    dict(tag="taipei", file="travel-taipei.jpg", fn=scene_taipei,
         x=0.54, ground=0.85, h=0.70, flip=True,
         shadow=(8, 10, 24), shadow_dx=0.04, frame=False, vig=0.17,
         glow=((255, 214, 150), 46), pool=((255, 208, 140), 30),
         gain=(0.93, 0.94, 1.03), sat=0.95),
    dict(tag="alps", file="travel-alps.jpg", fn=scene_alps,
         x=0.47, ground=0.86, h=0.62, flip=False,
         shadow=(124, 146, 176), shadow_dx=-0.04, frame=False, vig=0.14,
         gain=(1.0, 1.0, 1.02), sat=1.0),
    dict(tag="starry", file="cosplay-starry-night.jpg", fn=scene_starry,
         x=0.40, ground=0.86, h=0.70, flip=False,
         shadow=(8, 12, 24), shadow_dx=-0.05, frame=True, vig=0.08,
         glow=((255, 232, 168), 58), pool=((226, 230, 200), 30),
         gain=(0.93, 0.95, 1.04), sat=0.95),
    dict(tag="scream", file="cosplay-scream.jpg", fn=scene_scream,
         x=0.63, ground=0.846, h=0.71, flip=True,
         shadow=(16, 22, 36), shadow_dx=-0.04, frame=True, vig=0.10,
         gain=(0.99, 0.98, 1.0), sat=0.98),
    dict(tag="mona", file="cosplay-mona-lisa.jpg", fn=scene_mona,
         x=0.50, ground=0.845, h=0.68, flip=False,
         shadow=(80, 76, 62), shadow_dx=-0.04, frame=True, vig=0.24,
         gain=(0.99, 0.98, 0.92), sat=0.93),
    dict(tag="sunflowers", file="cosplay-sunflowers.jpg", fn=scene_sunflowers,
         x=0.32, ground=0.87, h=0.66, flip=False,
         shadow=(146, 116, 78), shadow_dx=-0.05, frame=True, vig=0.15,
         gain=(1.04, 1.0, 0.95), sat=1.0),
    dict(tag="pearl", file="cosplay-pearl.jpg", fn=scene_pearl,
         x=0.63, ground=0.84, h=0.70, flip=True,
         shadow=(4, 8, 12), shadow_dx=-0.04, frame=True, vig=0.22,
         glow=((255, 228, 180), 52), pool=((255, 224, 170), 42),
         gain=(0.95, 0.96, 1.0), sat=0.96),
    dict(tag="cafe", file="daily-cafe.jpg", fn=scene_cafe,
         x=0.34, ground=0.87, h=0.62, flip=False,
         shadow=(136, 102, 94), shadow_dx=-0.05, frame=False, vig=0.15,
         gain=(1.03, 1.0, 0.98), sat=1.0),
    dict(tag="books", file="daily-books.jpg", fn=scene_books,
         x=0.43, ground=0.85, h=0.64, flip=False,
         shadow=(116, 94, 82), shadow_dx=-0.05, frame=False, vig=0.16,
         gain=(1.02, 1.0, 0.98), sat=1.0),
    dict(tag="rain", file="daily-rain.jpg", fn=scene_rain,
         x=0.72, ground=0.86, h=0.63, flip=True,
         shadow=(124, 106, 96), shadow_dx=-0.04, frame=False, vig=0.16,
         gain=(0.98, 0.99, 1.02), sat=1.0),
    dict(tag="birthday", file="daily-birthday.jpg", fn=scene_birthday,
         x=0.40, ground=0.87, h=0.68, flip=False,
         shadow=(146, 108, 92), shadow_dx=-0.05, frame=False, vig=0.14,
         gain=(1.03, 1.0, 0.98), sat=1.0),
]


def build(spec, idx):
    rng = random.Random(1000 + idx * 37)
    nrng = np.random.default_rng(5000 + idx * 29)
    slot = Slot(x=spec["x"] * BASE_W, ground=spec["ground"] * BASE_H,
                h_frac=spec["h"], flip=spec["flip"],
                shadow=spec.get("shadow"), shadow_dx=spec.get("shadow_dx", -0.04),
                glow=spec.get("glow"), pool=spec.get("pool"),
                gain=spec.get("gain", (1.0, 1.0, 1.0)),
                sat=spec.get("sat", 1.0), frame=spec["frame"])
    im = spec["fn"](rng, nrng, slot)
    im = finish(im, nrng, vig=spec.get("vig", 0.15))
    if spec["frame"]:
        im = ornate_frame(im, random.Random(9000 + idx))
    path = os.path.join(GALLERY, spec["file"])
    size = save_jpg(im, path, nrng)
    return slot, path, size


def check_slot(spec, slot):
    m = slot.metrics
    problems = []
    margin = 6.0
    frame_margin = FRAME_INNER + 2 if spec["frame"] else margin
    if m["left"] < frame_margin:
        problems.append(f"left {m['left']:.1f} < {frame_margin:.0f}")
    if m["right"] > BASE_W - frame_margin:
        problems.append(f"right {m['right']:.1f} > {BASE_W - frame_margin:.0f}")
    if m["top"] < frame_margin:
        problems.append(f"top {m['top']:.1f} < {frame_margin:.0f}")
    if m["bottom"] > BASE_H - frame_margin:
        problems.append(f"bottom {m['bottom']:.1f} > {BASE_H - frame_margin:.0f}")
    if not (0.595 <= m["h_ratio"] <= 0.755):
        problems.append(f"height ratio {m['h_ratio']:.3f} out of 0.60-0.75")
    return problems


def make_contact_sheet(paths):
    cols = 4
    tw, th = 360, 270
    gap, pad = 14, 24
    lab_h = 26
    rows = math.ceil(len(paths) / cols)
    w = pad * 2 + cols * tw + (cols - 1) * gap
    h = pad * 2 + rows * (th + lab_h) + (rows - 1) * gap
    sheet = Image.new("RGB", (w, h), CREAM)
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=15)
    except Exception:
        font = ImageFont.load_default()
    for i, p in enumerate(paths):
        r, c = divmod(i, cols)
        x = pad + c * (tw + gap)
        y = pad + r * (th + lab_h + gap)
        with Image.open(p) as src:
            thumb = src.convert("RGB").resize((tw, th), Image.LANCZOS)
        sheet.paste(thumb, (x, y))
        name = os.path.basename(p)
        tag = name.replace(".jpg", "")
        is_cos = tag.startswith("cosplay")
        border = GOLD if is_cos else (218, 198, 172)
        d.rectangle([x - 2, y - 2, x + tw + 1, y + th + 1], outline=border, width=3)
        kb = os.path.getsize(p) / 1024.0
        label = f"{i + 1:02d}  {tag}   {kb:.0f} KB"
        d.text((x + 2, y + th + 6), label, fill=INK, font=font)
    sheet.save(SHEET, quality=90, optimize=True)
    return SHEET


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只跑 tag 含此字串的場景（逗號分隔）")
    ap.add_argument("--no-sheet", action="store_true")
    args = ap.parse_args(argv)

    os.makedirs(GALLERY, exist_ok=True)
    wanted = [s.strip() for s in args.only.split(",") if s.strip()]
    results, problems = [], []
    for idx, spec in enumerate(SCENES):
        if wanted and not any(w in spec["tag"] for w in wanted):
            continue
        slot, path, size = build(spec, idx)
        m = slot.metrics
        probs = check_slot(spec, slot)
        problems.extend([f"{spec['file']}: {p}" for p in probs])
        if size > 250 * 1024:
            probs.append("file > 250KB")
        try:
            with Image.open(path) as _chk:
                if _chk.format != "JPEG":
                    probs.append("not JPEG")
                if _chk.size != (BASE_W, BASE_H):
                    probs.append(f"size {_chk.size}")
                if _chk.mode != "RGB":
                    probs.append(f"mode {_chk.mode}")
        except Exception as exc:
            probs.append(f"open failed: {exc}")
        problems.extend([f"{spec['file']}: {p}" for p in probs if p not in check_slot(spec, slot)])
        results.append(dict(spec=spec, path=path, size=size, metrics=m, problems=probs))
        print(f"[{idx + 1:02d}/{len(SCENES)}] {spec['file']:<26} "
              f"{size / 1024:6.1f} KB  char={m['h_ratio'] * 100:4.1f}%  "
              f"bbox=({m['left']:5.0f},{m['top']:5.0f})-({m['right']:5.0f},{m['bottom']:5.0f})"
              + ("  !! " + "; ".join(probs) if probs else ""))

    # 報告
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("Phoebe 示範相簿插圖 — build report\n")
        f.write(f"canvas: {BASE_W}x{BASE_H}  SS={SS}  quality=88 (fallback 85)\n\n")
        f.write(f"{'file':<30}{'KB':>8}{'char%':>8}  bbox(left,top,right,bottom)\n")
        for r in results:
            m = r["metrics"]
            f.write(f"{os.path.basename(r['path']):<30}{r['size'] / 1024:8.1f}"
                    f"{m['h_ratio'] * 100:8.1f}  ({m['left']:.0f},{m['top']:.0f},"
                    f"{m['right']:.0f},{m['bottom']:.0f})\n")
        f.write("\nproblems:\n")
        f.write("(none)\n" if not problems else "\n".join(problems) + "\n")

    if not args.no_sheet:
        paths = [r["path"] for r in results]
        if paths:
            sheet = make_contact_sheet(paths)
            print(f"contact sheet -> {sheet}")

    if problems:
        print("\nQA PROBLEMS:")
        for p in problems:
            print("  -", p)
        return 1
    print("\nOK: all scenes passed placement checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
