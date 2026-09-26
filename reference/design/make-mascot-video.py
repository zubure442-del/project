#!/usr/bin/env python3
"""
Готовит видео маскота для «Сегодня» из ролика дизайнера (reference/design/animation-*.mp4).

У исходного ролика непрозрачный серый фон (≈ #292B2B), а на экране фон приложения #0B0B0F и своя
подсветка в акцентном цвете. Прозрачное видео iOS умеет только в HEVC с альфой (кодируется лишь на Mac),
поэтому делаем проще: снимаем серый фон по цвету (мягкая маска, «размешивание» краёв шерсти),
кладём лису на фон приложения с подсветкой (свечение за фигурой и платформа под лапами — те же, что
раньше рисовал Mascot.tsx) и кодируем обычный H.264. Края кадра приложение растворяет в фоне экрана.

- Петля бесшовная: последние LOOP_FADE кадров перетекают в первые.
- Платформа «дышит» (яркость 0.7–1.0) с периодом, равным длине петли.
- Звук выброшен: видео не должно трогать музыку человека.

Запуск (нужны ffmpeg, numpy, pillow):
    python3 reference/design/make-mascot-video.py reference/design/animation-….mp4 assets/mascot
Результат: fox-idle.mp4 (видео) и fox-idle.png (первый кадр — пока видео грузится и при
«Уменьшении движения»). Геометрия кадра — в MASCOT_SKINS (src/ui/Mascot.tsx): поменяли здесь — поменяйте там.
"""
import glob
import math
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')

# Цвета приложения (src/ui/theme.ts).
BG = np.array([0x0B, 0x0B, 0x0F], dtype=np.float64)
ACCENT = np.array([0xF2, 0xA9, 0x3B], dtype=np.float64)

# Серый фон исходника и мягкая маска по сумме разниц каналов: ниже KEY_LOW — фон, выше KEY_HIGH — лиса.
SOURCE_BG = np.array([41.4, 43.4, 43.4])
KEY_LOW = 10.0
KEY_HIGH = 28.0

# Кадр результата в координатах исходника 768×768: лиса (уши 43 — лапы 727) с полями.
CROP_X = 70
WIDTH = 540
HEIGHT = 790  # ниже 768 — поле цвета фона под платформой

# Платформа под лапами (центр — середина лап в исходнике) и свечение за фигурой.
PLATFORM_CX = 385 - CROP_X
PLATFORM_CY = 722
PLATFORM_W = 420
PLATFORM_H = 110
BACK_GLOW_OPACITY = 0.14
BREATH_MIN = 0.7

LOOP_FADE = 8


def ellipse_field(cx, cy, rx, ry):
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float64)
    u = (x + 0.5 - cx) / rx
    v = (y + 0.5 - cy) / ry
    e = np.sqrt(u * u + v * v)
    # Расстояние до контура эллипса в пикселях (для колец): |e − 1| / |∇e|.
    grad = np.sqrt((u / rx) ** 2 + (v / ry) ** 2) / np.maximum(e, 1e-6)
    return e, np.abs(e - 1) / np.maximum(grad, 1e-6)


def radial(e, stops):
    """Радиальный градиент как в SVG: [(offset, opacity), …] по e от 0 до 1."""
    offsets = [o for o, _ in stops]
    values = [v for _, v in stops]
    return np.interp(np.clip(e, 0, 1), offsets, values) * (e <= 1)


def ring(dist, width, opacity):
    return np.clip(width / 2 + 0.5 - dist, 0, 1) * opacity


def over(base, color, alpha):
    a = alpha[..., None]
    return base * (1 - a) + color * a


def backdrop():
    """Фон приложения, свечение за фигурой и платформа (без «дыхания» — его даёт альфа платформы)."""
    img = np.broadcast_to(BG, (HEIGHT, WIDTH, 3)).copy()
    e, _ = ellipse_field(WIDTH / 2, HEIGHT * 0.55, WIDTH / 2, HEIGHT * 0.45)
    img = over(img, ACCENT, radial(e, [(0, BACK_GLOW_OPACITY), (1, 0)]))
    e, dist = ellipse_field(PLATFORM_CX, PLATFORM_CY, PLATFORM_W / 2, PLATFORM_H / 2)
    platform = radial(e, [(0, 0.75), (0.45, 0.28), (1, 0)])
    e1, d1 = ellipse_field(PLATFORM_CX, PLATFORM_CY, PLATFORM_W * 0.36, PLATFORM_H * 0.3)
    e2, d2 = ellipse_field(PLATFORM_CX, PLATFORM_CY, PLATFORM_W * 0.46, PLATFORM_H * 0.4)
    rings = 1 - (1 - ring(d1, 3.6, 0.55)) * (1 - ring(d2, 3.0, 0.25))
    platform = 1 - (1 - platform) * (1 - rings)
    return img, platform


def key(frame):
    """Альфа лисы и её цвет без примеси серого фона на краях шерсти."""
    d = np.abs(frame - SOURCE_BG).sum(2)
    alpha = np.clip((d - KEY_LOW) / (KEY_HIGH - KEY_LOW), 0, 1)
    a = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((frame - (1 - a) * SOURCE_BG) / a, 0, 255)
    return fg, alpha


def main(source, out_dir):
    work = tempfile.mkdtemp()
    try:
        subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', source, f'{work}/in-%04d.png'], check=True)
        frames = [np.asarray(Image.open(f).convert('RGB')).astype(np.float64) for f in sorted(glob.glob(f'{work}/in-*.png'))]
        n = len(frames)
        length = n - LOOP_FADE
        # Петля: кадры LOOP_FADE…n−1, последние LOOP_FADE из них перетекают в кадры 0…LOOP_FADE−1.
        loop = []
        for i in range(length):
            f = frames[i + LOOP_FADE]
            j = i - (length - LOOP_FADE)
            if j >= 0:
                w = (j + 1) / (LOOP_FADE + 1)
                f = f * (1 - w) + frames[j] * w
            loop.append(f)

        base, platform = backdrop()
        for i, f in enumerate(loop):
            breath = BREATH_MIN + (1 - BREATH_MIN) * (0.5 + 0.5 * math.cos(2 * math.pi * i / length))
            img = over(base, ACCENT, platform * breath)
            canvas = np.zeros((HEIGHT, WIDTH, 3))
            alpha = np.zeros((HEIGHT, WIDTH))
            fg, a = key(f[:, CROP_X:CROP_X + WIDTH])
            canvas[: f.shape[0]] = fg
            alpha[: f.shape[0]] = a
            img = over(img, canvas, alpha)
            Image.fromarray(np.round(img).astype(np.uint8)).save(f'{work}/out-{i:04d}.png')

        os.makedirs(out_dir, exist_ok=True)
        shutil.copy(f'{work}/out-0000.png', os.path.join(out_dir, 'fox-idle.png'))
        subprocess.run(
            [
                FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-framerate', '24', '-i', f'{work}/out-%04d.png',
                '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryslow', '-crf', '20', '-pix_fmt', 'yuv420p',
                '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                '-movflags', '+faststart', '-an', '-tag:v', 'avc1', os.path.join(out_dir, 'fox-idle.mp4'),
            ],
            check=True,
        )
        print(f'{length} кадров, {WIDTH}×{HEIGHT}, петля {length / 24:.2f} с')
    finally:
        shutil.rmtree(work)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
