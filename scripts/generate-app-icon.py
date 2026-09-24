from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / "public" / "hachiware-face.png").convert("RGBA")
size = 512

scale = max(size / source.width, size / source.height)
resized = source.resize(
    (round(source.width * scale), round(source.height * scale)),
    Image.Resampling.LANCZOS,
)
image = Image.new("RGBA", (size, size), "#e9f5ff")
image.alpha_composite(
    resized,
    ((size - resized.width) // 2, (size - resized.height) // 2),
)

mask = Image.new("L", (size, size))
ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=100, fill=255)
image.putalpha(mask)

output = ROOT / "electron"
image.save(output / "paydrop-icon.png")
image.save(
    output / "paydrop.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
