from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'public' / 'paydrop-mascot.png').convert('RGBA')
width, height = source.size
pixels = source.load()
visited = bytearray(width * height)
queue = deque()


def is_background(x, y):
    red, green, blue, _ = pixels[x, y]
    return green > red + 8 and green > blue + 8


def enqueue(x, y):
    if 0 <= x < width and 0 <= y < height:
        index = y * width + x
        if not visited[index] and is_background(x, y):
            visited[index] = 1
            queue.append((x, y))


for x in range(width):
    enqueue(x, 0)
    enqueue(x, height - 1)
for y in range(height):
    enqueue(0, y)
    enqueue(width - 1, y)

while queue:
    x, y = queue.popleft()
    enqueue(x - 1, y)
    enqueue(x + 1, y)
    enqueue(x, y - 1)
    enqueue(x, y + 1)

for y in range(height):
    for x in range(width):
        if visited[y * width + x]:
            pixels[x, y] = (0, 0, 0, 0)

source.save(ROOT / 'public' / 'paydrop-mascot-cutout.png')
