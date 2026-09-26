#!/usr/bin/env python3
"""
Готовит видео маскота для «Сегодня» из ролика дизайнера (reference/design/animation-*.mp4).

Владелец 26.09: «оставь видео как есть — можно убрать фон или изменить размер, ничего не добавляй».
У исходного ролика непрозрачный серый фон (≈ #292B2B), а экран — #0B0B0F. Прозрачное видео iOS умеет
только в HEVC с альфой (кодируется лишь на Mac), поэтому серый фон снимается по цвету (мягкая маска,
края шерсти «размешаны») и заменяется цветом фона приложения. Больше в кадре ничего нет.
Кадр обрезан по бокам (лиса с хвостом помещается целиком), звук выброшен.

Запуск (нужны ffmpeg, numpy, pillow):
    python3 reference/design/make-mascot-video.py reference/design/animation-….mp4 assets/mascot
Результат: fox-idle.mp4 и fox-idle.png (первый кадр — пока видео грузится). Геометрия кадра —
в MASCOT_SKINS (src/ui/Mascot.tsx): поменяли здесь — поменяйте там.
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')

# Фон приложения (src/ui/theme.ts).
BG = np.array([0x0B, 0x0B, 0x0F], dtype=np.float64)

# Серый фон исходника и мягкая маска по сумме разниц каналов: ниже KEY_LOW — фон, выше KEY_HIGH — лиса.
SOURCE_BG = np.array([41.4, 43.4, 43.4])
KEY_LOW = 10.0
KEY_HIGH = 28.0

# Кадр результата в координатах исходника 768×768: лиса (уши 43 — лапы 727, хвост от 106) целиком.
CROP_X = 70
WIDTH = 540
HEIGHT = 768

# Последние кадры исходника плавно перетекают в первые: петля без рывка (кадры почти совпадают).
LOOP_FADE = 8


def over(base, color, alpha):
    a = alpha[..., None]
    return base * (1 - a) + color * a


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

        base = np.broadcast_to(BG, (HEIGHT, WIDTH, 3))
        for i, f in enumerate(loop):
            fg, a = key(f[:HEIGHT, CROP_X:CROP_X + WIDTH])
            img = over(base, fg, a)
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
