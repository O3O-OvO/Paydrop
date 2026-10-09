"""Redraw facial features on the existing rest strip; preserve the body artwork."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


FRAME = (256, 288)
DURATIONS = [1100, 900, 1000, 1100, 900, 1100]
# Feature bounds measured in each original frame, not approximated from the ear height.
FEATURES = [
    [(96, 123, 105, 128), (156, 120, 165, 125), (83, 142, 112, 161), (150, 139, 179, 158), (115, 160, 148, 177), (126, 182, 138, 187)],
    [(99, 126, 109, 131), (160, 122, 169, 127), (85, 148, 116, 162), (155, 144, 185, 158), (119, 162, 152, 179), (129, 185, 141, 190)],
    [(99, 122, 108, 127), (158, 119, 168, 124), (85, 144, 116, 158), (154, 141, 184, 155), (119, 158, 152, 176), (130, 181, 141, 187)],
    [(100, 134, 109, 139), (158, 134, 167, 139), (83, 153, 114, 165), (153, 153, 183, 165), (116, 168, 149, 184), (126, 189, 138, 194)],
    [(97, 126, 106, 130), (156, 124, 165, 128), (84, 144, 113, 162), (150, 141, 179, 160), (116, 162, 148, 178), (126, 184, 138, 189)],
    [(96, 124, 105, 129), (156, 122, 165, 126), (83, 142, 112, 161), (150, 140, 179, 159), (115, 160, 148, 177), (126, 182, 138, 188)],
]


def curve(draw, points, color, width, scale=4):
    start, control, end = points
    samples = []
    for step in range(49):
        t = step / 48
        samples.append(tuple(
            round(((1 - t) ** 2 * start[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * end[axis]) * scale)
            for axis in range(2)
        ))
    radius = width * scale / 2
    draw.line(samples, fill=color, width=round(width * scale), joint="curve")
    for x, y in (samples[0], samples[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def refine(frame, features):
    mask = Image.new("L", FRAME)
    source = frame.load()
    pixels = mask.load()
    for left, top, right, bottom in features:
        for y in range(top, bottom):
            for x in range(left, right):
                red, green, blue, alpha = source[x, y]
                if alpha > 160 and red < 165 and green < 145 and blue < 150:
                    pixels[x, y] = 255
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.4))
    skin = Image.new("RGBA", FRAME, (253, 250, 248, 255))
    edited = Image.composite(skin, frame, mask)
    lines = Image.new("RGBA", (FRAME[0] * 4, FRAME[1] * 4))
    draw = ImageDraw.Draw(lines)
    ink = (85, 57, 44, 255)
    for left, top, right, bottom in features[2:4]:
        center = (left + right) / 2
        y = (top + bottom) / 2 - 4
        curve(draw, ((left + 3, y), (center, y + 11), (right - 3, y)), ink, 3.8)
    left, top, right, bottom = features[4]
    center = (left + right) / 2
    y = (top + bottom) / 2 + 2
    curve(draw, ((center - 10, y), (center - 6, y + 8), (center, y + 1)), ink, 3.4)
    curve(draw, ((center, y + 1), (center + 6, y + 8), (center + 10, y)), ink, 3.4)
    edited.alpha_composite(lines.resize(FRAME, Image.Resampling.LANCZOS))
    # Facial edits cannot alter the original transparent silhouette.
    edited.putalpha(frame.getchannel("A"))
    return edited


def build(target, qa):
    source = target / "rest.png"
    original = Image.open(source).convert("RGBA")
    if original.size != (1536, 288):
        raise ValueError("Expected the original six-frame rest strip")
    result = Image.new("RGBA", original.size)
    before_after = Image.new("RGB", (1536, 640), "#eef4f3")
    before_after.paste(original, (0, 32), original)
    previews, bounds = [], []
    for index, features in enumerate(FEATURES):
        frame = original.crop((index * 256, 0, (index + 1) * 256, 288))
        edited = refine(frame, features)
        assert ImageChops.difference(frame.getchannel("A"), edited.getchannel("A")).getbbox() is None
        assert frame.crop((0, 206, 256, 288)).tobytes() == edited.crop((0, 206, 256, 288)).tobytes()
        result.alpha_composite(edited, (index * 256, 0))
        bounds.append(list(edited.getbbox()))
        before_after.paste(edited, (index * 256, 352), edited)
        background = Image.new("RGB", FRAME, "#eef4f3")
        background.paste(edited, mask=edited.getchannel("A"))
        previews.append(background)
    file = target / "rest-soft.png"
    result.save(file, optimize=True)
    qa.mkdir(parents=True, exist_ok=True)
    ImageDraw.Draw(before_after).text((12, 10), "BEFORE", fill="#354b50")
    ImageDraw.Draw(before_after).text((12, 330), "AFTER / SOFT CLOSED EYES", fill="#354b50")
    before_after.save(qa / "rest-comparison.png")
    previews[0].save(qa / "rest-soft.gif", save_all=True, append_images=previews[1:],
                     duration=DURATIONS, loop=0, disposal=2)
    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rest = manifest["animations"]["rest"]
    rest.update({"file": file.name, "durations": DURATIONS, "frameBounds": bounds})
    rest["refinement"] = {
        "method": "local facial redraw using Pillow; not a new AI generation",
        "source": "rest.png",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "script": "scripts/refine-rest-art.py",
        "changes": ["relaxed closed eyelids", "small peaceful smile", "removed tired eyebrows and lower lip"],
        "invariants": ["original body poses", "alpha silhouette", "seat baseline", "blue markings", "pink cheeks"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Refined six rest faces: {file}; original preserved at {source}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=Path, default=Path("public/pet-art/v2"))
    parser.add_argument("--qa", type=Path, default=Path("output/imagegen/rest-refinement"))
    args = parser.parse_args()
    build(args.target, args.qa)
