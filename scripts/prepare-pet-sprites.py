"""Align generated PNG poses into transparent desktop-pet strips."""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


FRAME_SIZE = (256, 288)
BASELINE = 274
MOODS = ("idle", "walk", "happy", "eat", "rest", "wave", "stretch", "dance", "coin")
TIMINGS = {
    "idle": [1800, 180, 70, 110, 70, 500],
    "walk": [120, 120, 120, 120, 120, 120],
    "happy": [100, 120, 130, 170, 100, 130],
    "eat": [260, 180, 190, 260, 260, 260],
    "rest": [700, 500, 600, 800, 400, 500],
    "wave": [240, 160, 220, 220, 220, 260],
    "stretch": [250, 350, 450, 600, 300, 250],
    "dance": [180, 180, 180, 200, 180, 180],
    "coin": [260, 240, 420, 420, 260, 260],
}


def clean_cell(cell):
    pixels = np.array(cell.convert("RGBA"))
    alpha = pixels[:, :, 3]
    # Generated soft halos are not part of the character's ink silhouette.
    core = Image.fromarray(np.where(alpha >= 160, 255, 0).astype("uint8"))
    bounds = core.getbbox()
    if bounds is None:
        raise ValueError("Empty generated frame")
    edge = np.asarray(core.filter(ImageFilter.MaxFilter(5))) > 0
    pixels[:, :, 3] = np.where(edge, alpha, 0)

    rgb = pixels[:, :, :3].astype(float)
    blue = (alpha > 160) & (rgb[:, :, 2] > rgb[:, :, 0] * 1.18) & (rgb[:, :, 1] > 110)
    brown = (alpha > 200) & (rgb[:, :, 0] < 145) & (rgb[:, :, 1] < 100) & (rgb[:, :, 2] < 100) & (rgb[:, :, 0] > rgb[:, :, 1])
    # Preserve drawing detail while bringing separate generations to one palette.
    for mask, target in ((blue, [123, 166, 186]), (brown, [85, 57, 44])):
        if mask.sum() > 100:
            mean = np.median(rgb[mask], axis=0)
            rgb[mask] = np.clip(rgb[mask] * np.array(target) / np.maximum(mean, 1), 0, 255)
    pixels[:, :, :3] = rgb.astype("uint8")
    return Image.fromarray(pixels), bounds


def build(source, target, qa, moods):
    target.mkdir(parents=True, exist_ok=True)
    qa.mkdir(parents=True, exist_ok=True)
    manifest_file = target / "manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8")) if manifest_file.exists() else {"version": 2, "frameSize": list(FRAME_SIZE), "baseline": BASELINE, "animations": {}}
    contact = Image.new("RGB", (FRAME_SIZE[0] * 6, (FRAME_SIZE[1] + 32) * len(moods)), "#edf3f0")
    from PIL import ImageDraw

    draw = ImageDraw.Draw(contact)
    for row, mood in enumerate(moods):
        original = Image.open(source / f"{mood}-source.png").convert("RGBA")
        if original.getchannel("A").getextrema()[0] != 0:
            raise ValueError(f"{mood}: source has no fully transparent pixels")
        columns, rows = (6, 1) if mood == "idle" else (3, 2)
        frames, bounds = [], []
        for index in range(6):
            column, grid_row = index % columns, index // columns
            box = (
                round(column * original.width / columns),
                round(grid_row * original.height / rows),
                round((column + 1) * original.width / columns),
                round((grid_row + 1) * original.height / rows),
            )
            frame, bbox = clean_cell(original.crop(box))
            frames.append(frame)
            bounds.append(bbox)
        head_widths = []
        for frame, bbox in zip(frames, bounds):
            silhouette = np.asarray(frame.getchannel("A")) >= 160
            top, bottom = bbox[1], bbox[1] + round((bbox[3] - bbox[1]) * 0.63)
            widths = []
            for line in silhouette[top:bottom]:
                positions = np.flatnonzero(line)
                if len(positions):
                    widths.append(int(positions[-1] - positions[0] + 1))
            head_widths.append(max(widths))
        ground = max(b[3] for b in bounds)
        scale = min(216 / float(np.median(head_widths)), 246 / max(b[3] - b[1] for b in bounds))
        scale = min(scale, (FRAME_SIZE[0] - 10) / max(b[2] - b[0] + 6 for b in bounds))
        if mood == "happy":
            highest = max(b[3] - b[1] + (ground - b[3] if index in (2, 3) else 0) for index, b in enumerate(bounds))
            scale = min(scale, (BASELINE - 10) / highest)
        strip = Image.new("RGBA", (FRAME_SIZE[0] * 6, FRAME_SIZE[1]))
        finished = []
        for index, (frame, bbox) in enumerate(zip(frames, bounds)):
            cropped = frame.crop((max(0, bbox[0] - 3), max(0, bbox[1] - 3), min(frame.width, bbox[2] + 3), min(frame.height, bbox[3] + 3)))
            resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.Resampling.LANCZOS)
            # Keep the generated leap above the shared baseline; ground other poses.
            lift = round((ground - bbox[3]) * scale) if mood == "happy" and index in (2, 3) else 0
            x = (FRAME_SIZE[0] - resized.width) // 2
            y = BASELINE - resized.height - lift
            if x < 2 or y < 2:
                raise ValueError(f"{mood} frame {index}: insufficient canvas margin")
            canvas = Image.new("RGBA", FRAME_SIZE)
            canvas.alpha_composite(resized, (x, y))
            if canvas.getbbox()[3] >= FRAME_SIZE[1] - 2:
                raise ValueError(f"{mood} frame {index}: clipped feet")
            strip.alpha_composite(canvas, (index * FRAME_SIZE[0], 0))
            finished.append(canvas)
            contact.paste(canvas, (index * FRAME_SIZE[0], row * (FRAME_SIZE[1] + 32) + 32), canvas)
        if len({frame.tobytes() for frame in finished}) != 6:
            raise ValueError(f"{mood}: duplicate frames")
        strip.save(target / f"{mood}.png", optimize=True)
        draw.text((12, row * (FRAME_SIZE[1] + 32) + 10), mood.upper(), fill="#354b50")
        previews = []
        for frame in finished:
            background = Image.new("RGB", FRAME_SIZE, "#edf3f0")
            background.paste(frame, mask=frame.getchannel("A"))
            previews.append(background)
        previews[0].save(qa / f"{mood}.gif", save_all=True, append_images=previews[1:], duration=TIMINGS[mood], loop=0, disposal=2)
        provenance = json.loads((source / f"{mood}-provenance.json").read_text(encoding="utf-8"))
        manifest["animations"][mood] = {
            "file": f"{mood}.png", "frames": 6, "durations": TIMINGS[mood],
            "sourceSize": list(original.size), "scale": round(scale, 4),
            "generation": provenance, "frameBounds": [list(f.getbbox()) for f in finished],
        }
    contact.save(qa / ("contact-sheet.png" if tuple(moods) == MOODS else "contact-sheet-extra.png"))
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"processed": list(moods), "animations": len(manifest["animations"]), "frames": len(manifest["animations"]) * 6, "frameSize": FRAME_SIZE, "output": str(target)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("output/imagegen/hachiware-v2"))
    parser.add_argument("--target", type=Path, default=Path("public/pet-art/v2"))
    parser.add_argument("--qa", type=Path, default=Path("output/imagegen/hachiware-v2/qa"))
    parser.add_argument("--moods", nargs="+", choices=MOODS, default=list(MOODS))
    args = parser.parse_args()
    build(args.source, args.target, args.qa, args.moods)
