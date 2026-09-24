import argparse
from pathlib import Path
from collections import deque
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public'
parser = argparse.ArgumentParser(description='Prepare the supplied theme artwork.')
parser.add_argument('pattern', type=Path)
parser.add_argument('world', type=Path)
args = parser.parse_args()

# Preserve the two supplied images as optimized, local assets for the web preview.
with Image.open(args.pattern) as image:
    image.convert('RGB').save(OUT / 'hachiware-pattern.webp', 'WEBP', quality=86, method=6)

    crops = {
        'face': (1262, 126, 1438, 292),
        'toast': (344, 36, 418, 99),
        'star': (826, 387, 885, 454),
        'popsicle': (1650, 115, 1735, 208),
    }
    for name, box in crops.items():
        sticker = image.crop(box).convert('RGBA')
        pixels = sticker.load()
        width, height = sticker.size
        seen = bytearray(width * height)
        queue = deque()
        for x in range(width):
            queue.extend(((x, 0), (x, height - 1)))
        for y in range(height):
            queue.extend(((0, y), (width - 1, y)))
        while queue:
            x, y = queue.popleft()
            index = y * width + x
            if seen[index]:
                continue
            seen[index] = 1
            r, g, b, _ = pixels[x, y]
            if not (b > 215 and b > r + 4 and b > g + 2 and r > 185):
                continue
            pixels[x, y] = (r, g, b, 0)
            if x: queue.append((x - 1, y))
            if x + 1 < width: queue.append((x + 1, y))
            if y: queue.append((x, y - 1))
            if y + 1 < height: queue.append((x, y + 1))
        sticker.save(OUT / f'hachiware-{name}.png', optimize=True)

with Image.open(args.world) as image:
    image.thumbnail((2200, 1300), Image.Resampling.LANCZOS)
    image.convert('RGB').save(OUT / 'hachiware-world.webp', 'WEBP', quality=82, method=6)
