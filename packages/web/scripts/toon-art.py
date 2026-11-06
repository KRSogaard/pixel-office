#!/usr/bin/env python3
"""
Generates the "Toon" art style's images with Nano Banana (through OpenRouter)
and cleans them up for the game: white background cut out, cropped, split
into poses, scaled to size. Output: packages/web/public/art/toon/.

    OPENROUTER_API_KEY=… python3 scripts/toon-art.py            # generate what's missing, then process
    python3 scripts/toon-art.py --process                         # re-process cached images only
    python3 scripts/toon-art.py --redo char-03 bug                 # throw away and regenerate these

Raw generations are cached in packages/web/.toon-raw/ (not committed), so
tweaking the processing never costs a new generation. Needs Pillow.
"""

import base64
import json
import os
import sys
import urllib.request
from collections import deque
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".toon-raw"
OUT = ROOT / "public" / "art" / "toon"
REFS = ROOT / "scripts" / "toon-refs"
MODEL = "google/gemini-nano-banana-2.1"

# The game's world is 16 px per tile; toon art is drawn at RES× that and scaled down.
RES = 4
TILE = 16 * RES
FRAME_W, FRAME_H = 16 * RES, 24 * RES

STYLE = (
    "Classic 1940s American theatrical cartoon style: bold clean black ink outlines, flat saturated colours with "
    "simple cel shading, slightly exaggerated rubbery shapes. Original design: no existing cartoon characters, "
    "no logos, no text. Plain flat pure white background, no ground shadow, no scenery."
)
OBJECT = "A single game asset for a cartoon office game, seen from the front and slightly above. " + STYLE + " Draw only: "

# name → (prompt, footprint width in tiles, max height in tiles)
OBJECTS = {
    "desk": ("a wide wooden office desk seen from the front, with a computer monitor whose SCREEN FACES THE VIEWER (we see the glowing screen, not the back) in the middle of the desk, and a keyboard in front of it, wider than tall", 2, 1.6),
    "manager-desk": ("a big important executive wooden desk seen from the front, with two computer monitors whose SCREENS FACE THE VIEWER (we see the glowing screens), a desk lamp and a name plate, much wider than tall", 3, 1.7),
    "bookshelf": ("a tall narrow wooden bookshelf packed with colourful books", 1, 1.7),
    "server-rack": ("a narrow computer server rack cabinet with blinking lights and cables", 1, 1.7),
    "mail-shelf": ("a narrow wooden mail sorting shelf with pigeonholes full of letters and parcels", 1, 1.6),
    "coffee": ("an espresso coffee machine on a small cabinet, with a steaming cup", 1, 1.5),
    "armchair": ("a plump red cartoon armchair, front view", 1, 1.2),
    "plant": ("a leafy potted office plant in a terracotta pot", 1, 1.6),
    "filing": ("ONE single grey metal filing cabinet with three drawers, nothing else", 1, 1.5),
    "globe-desk": ("a small wooden desk with a world globe on it", 1, 1.4),
    "counter": ("one straight segment of a wooden reception counter, front view, flat sides so segments can line up side by side", 1, 1.2),
    "console": ("a retro mission-control computer console with dials, switches and a round green radar screen", 1, 1.4),
    "silo": ("a round rocket launch pit seen from directly above: a thick concrete ring with yellow and black hazard stripes around closed metal blast doors", 3, 3),
    "printer": ("a small office printer with paper in the tray", 1, 1.2),
    "flask-shelf": ("a narrow shelf with bubbling chemistry flasks and test tubes in bright colours", 1, 1.6),
    "lab-bench": ("a sturdy wooden laboratory table with a black top, covered with colourful bubbling flasks, test tubes in a rack and a burner", 1, 1.3),
    "whiteboard": ("an office whiteboard on a wheeled stand with a few scribbles and coloured sticky notes", 2, 1.6),
    "water-cooler": ("an office water cooler with a big blue water bottle on top", 1, 1.6),
    "chair": ("one office swivel chair seen from behind: we see the back of the backrest, the seat and the wheels", 1, 1.1),
    "bug": ("one small cute angry cartoon beetle bug seen from above, six little legs", 0.5, 0.4),
    "drone": ("a small cute flying delivery robot drone with propellers carrying a wooden crate underneath", 0.9, 0.9),
    "crate": ("a small wooden crate", 0.5, 0.5),
    "bin-empty": ("an empty small wire wastepaper basket", 0.5, 0.6),
    "bin-half": ("a small wire wastepaper basket half full of crumpled paper balls", 0.5, 0.6),
    "bin-full": ("a small wire wastepaper basket overflowing with crumpled paper balls, papers spilling out", 0.6, 0.7),
    "rocket": ("a classic red and white retro cartoon rocket ship standing upright, fins at the bottom", 1.5, 3),
    "duck": ("a yellow rubber duck toy", 0.5, 0.5),
    "envelope": ("a white envelope letter with a red wax seal", 0.5, 0.4),
    "pizza": ("a closed pizza delivery box with a pizza slice on top", 0.7, 0.5),
    "stretcher": ("an empty medical stretcher seen from the side", 1.5, 0.6),
    "tree": ("a decorated Christmas tree with a star on top and coloured lights", 1, 2),
    "pumpkin": ("a carved Halloween jack-o'-lantern pumpkin with a goofy grin", 0.7, 0.6),
    "balloons": ("a bunch of three party balloons, red yellow and blue, with strings", 0.8, 1.5),
}

CHARACTER_SHEET = (
    "Draw the SAME character several times in one row, in different poses, with empty white space between the "
    "figures: standing facing the viewer, seen from behind, walking side view, sitting, cheering. Same size and "
    "outfit in every pose, full body, no props, no furniture, no text."
)

# The model often ignores "facing left" for the side view. These were checked by eye and face right;
# their side view is mirrored. Re-check after regenerating a side view.
SIDE_FACES_RIGHT = {"char-00", "char-03", "char-04", "char-05", "char-07", "char-09", "char-10", "char-11"}

# How tall each pose is drawn, in texture pixels (the frame is FRAME_H tall).
POSE_HEIGHT = {"front": 86, "back": 86, "side": 86, "sit": 66, "think": 70, "hand": 96, "lounge": 64, "cheer": 96}

# One generation per pose, with the character's sheet as the reference, so every pose is one clean figure.
# Order matters: the toon style builds its animation frames from these by index.
POSES = [
    ("front", "standing facing the viewer, arms relaxed at the sides"),
    ("back", "standing seen from behind (back view, we see the back of the head), arms relaxed at the sides"),
    ("side", "walking mid-stride, side view, facing and walking toward the LEFT edge of the picture (nose points left)"),
    ("sit", "seen from behind (back view), sitting as if on an invisible stool, both hands forward typing on an invisible keyboard; no chair, no stool, no desk"),
    ("think", "seen from behind (back view), sitting as if on an invisible stool, one hand scratching the head, thinking; no chair, no stool"),
    ("hand", "standing seen from behind (back view), one arm raised high, waving for attention"),
    ("lounge", "sitting relaxed facing the viewer, leaning back with hands behind the head, legs crossed, as if on an invisible sofa; no furniture"),
    ("cheer", "facing the viewer, both arms up in the air, cheering happily"),
]

# Agents pick one of these by their id; varied so a full office reads as different people.
AGENTS = [
    "a cheerful young woman with a red bob haircut, white gloves, blue sweater and grey skirt",
    "a tall skinny man with slicked black hair and a thin moustache, white gloves, green vest over white shirt, brown trousers",
    "a round jolly bald man with big ears, white gloves, orange shirt with suspenders and blue trousers",
    "a young woman with a big blonde ponytail and a bow, white gloves, pink blouse and purple trousers",
    "a nerdy young man with huge round glasses and a cowlick, white gloves, yellow sweater vest and brown trousers",
    "a confident woman with dark curly hair and hoop earrings, white gloves, teal jacket and black trousers",
    "a stocky man with a red beard and a flat cap, white gloves, plaid lumberjack shirt and jeans",
    "a short energetic woman with black pigtails, white gloves, striped red-and-white shirt and denim overalls",
    "an older gentleman with a white handlebar moustache and a bow tie, white gloves, brown tweed jacket",
    "a lanky teenager with spiky purple hair and freckles, white gloves, oversized green hoodie and jeans",
    "a graceful woman with grey hair in a bun and cat-eye glasses, white gloves, lavender cardigan and long skirt",
    "a muscular man with a black flat-top haircut, white gloves, tight white t-shirt and blue jeans",
]

# Visitors and extras of the toon style: their own original cast.
CAST = {
    "boss": "a short round cigar-chomping big boss with a bald head, white gloves, pinstripe suit with a red tie",
    "consultant": "a smarmy consultant with slick hair and a huge grin, white gloves, shiny grey suit, holding nothing",
    "intern": "a lost-looking young intern with a backwards cap and a lanyard, white gloves, polo shirt and khakis",
    "auditor": "a stern skinny auditor with a pencil moustache and tiny spectacles, white gloves, dark grey suit and bowler hat",
    "investor": "a rich investor with a top hat and monocle and a big belly, white gloves, gold waistcoat and tailcoat",
    "grandpa": "a little old grandpa with a long white beard and a cardigan, white gloves, slippers",
    "courier": "a fast courier in a blue cap and blue uniform, white gloves",
    "medic": "a paramedic in a white uniform with a red cross on the cap, white gloves",
    "pizza": "a pizza delivery guy in a red cap and red shirt, white gloves",
}

CAT = "A cute grey office cat with a white chest and a curly tail. " + STYLE + " "
CAT_POSES = [
    ("walk", "walking toward the LEFT edge of the picture, side view, legs mid-stride"),
    ("sit", "sitting facing the viewer"),
    ("sleep", "curled up asleep"),
]


def characters():
    """name → description, for every agent look and every cast member."""
    out = {f"char-{i:02d}": who for i, who in enumerate(AGENTS)}
    out.update({f"cast-{kind}": who for kind, who in CAST.items()})
    return out


def jobs():
    """
    Every generation: name → (prompt, reference image). A reference is a style
    image in scripts/toon-refs/ or a raw generation ("raw:<name>").
    Character sheets come first; each pose then uses its character's sheet.
    """
    out = {}
    for name, (what, _, _) in OBJECTS.items():
        out[name] = (OBJECT + what + ".", "furniture.png")
    for name, who in characters().items():
        out[name] = (f"Character sheet for a cartoon office game. {STYLE} The character: {who}. {CHARACTER_SHEET}", "chars.png")
        for pose, how in POSES:
            out[f"{name}--{pose}"] = (
                f"Draw this exact character from the reference sheet (same face, hair, outfit, colours and proportions) "
                f"ONCE, as a single full-body figure centred in the picture: {how}. Exactly one figure in the whole "
                f"picture: do not repeat the character, no extra poses, no small copies. {STYLE}",
                # The front view is drawn from the sheet; the other poses from the front view, because
                # a multi-figure reference tempts the model into drawing a whole sheet again.
                f"raw:{name}" if pose == "front" else f"raw:{name}--front",
            )
    out["cat"] = (CAT + "Draw the cat a few times in one row in different poses.", "furniture.png")
    for pose, how in CAT_POSES:
        out[f"cat--{pose}"] = (f"Draw this exact cat from the reference ONCE, as a single figure centred in the picture: {how}. {STYLE}", "raw:cat")
    return out


# --- generation ------------------------------------------------------------------


def generate(name, prompt, ref):
    content = [{"type": "text", "text": prompt + " Match the drawing style of the reference image, but draw only what is described."}]
    if ref:
        path = RAW / f"{ref[4:]}.png" if ref.startswith("raw:") else REFS / ref
        data = base64.b64encode(path.read_bytes()).decode()
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{data}"}})
    body = {"model": MODEL, "modalities": ["image", "text"], "messages": [{"role": "user", "content": content}]}
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"], "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=600))
            images = r["choices"][0]["message"].get("images") or []
            if images:
                url = images[0]["image_url"]["url"]
                (RAW / f"{name}.png").write_bytes(base64.b64decode(url.split(",", 1)[1]))
                print(f"generated {name}", flush=True)
                return
            print(f"{name}: no image (attempt {attempt + 1})", flush=True)
        except Exception as e:  # network hiccups, rate limits
            print(f"{name}: {e} (attempt {attempt + 1})", flush=True)
    print(f"FAILED {name}", flush=True)


# --- processing ------------------------------------------------------------------


def cut_out(img):
    """RGBA with the white background (everything white reachable from the border) made transparent."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    def bg(p):
        r, g, b, _ = p
        return min(r, g, b) > 225 and max(r, g, b) - min(r, g, b) < 24

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.pop()
        i = y * w + x
        if seen[i] or not bg(px[x, y]):
            continue
        seen[i] = 1
        px[x, y] = (255, 255, 255, 0)
        if x > 0:
            q.append((x - 1, y))
        if x < w - 1:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y < h - 1:
            q.append((x, y + 1))
    # Soften the edge: light pixels touching the background become partly transparent.
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            i = y * w + x
            if seen[i]:
                continue
            if seen[i - 1] or seen[i + 1] or seen[i - w] or seen[i + w]:
                r, g, b, _ = px[x, y]
                light = min(r, g, b)
                if light > 170:
                    px[x, y] = (r, g, b, max(0, 255 - (light - 170) * 3))
    return img


def boxes(img, gap=12):
    """Bounding boxes of the separate figures, nearby specks merged in."""
    small = img.getchannel("A").resize((img.width // 4, img.height // 4), Image.BOX)
    w, h = small.size
    a = small.load()
    seen = bytearray(w * h)
    found = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or a[sx, sy] < 40:
                continue
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            q = deque([(sx, sy)])
            seen[sy * w + sx] = 1
            while q:
                x, y = q.pop()
                n += 1
                x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and a[nx, ny] >= 40:
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            found.append([x0, y0, x1, y1, n])
    g = gap // 4
    merged = True
    while merged:
        merged = False
        for i in range(len(found)):
            for j in range(i + 1, len(found)):
                A, B = found[i], found[j]
                if A[0] - g <= B[2] and B[0] - g <= A[2] and A[1] - g <= B[3] and B[1] - g <= A[3]:
                    found[i] = [min(A[0], B[0]), min(A[1], B[1]), max(A[2], B[2]), max(A[3], B[3]), A[4] + B[4]]
                    del found[j]
                    merged = True
                    break
            if merged:
                break
    biggest = max((b[4] for b in found), default=0)
    keep = [b for b in found if b[4] > biggest * 0.08]
    return [(b[0] * 4, b[1] * 4, (b[2] + 1) * 4, (b[3] + 1) * 4) for b in keep]


def reading_order(bs):
    """Sort boxes into rows (by vertical centre), then left to right."""
    bs = sorted(bs, key=lambda b: (b[1] + b[3]) / 2)
    rows = []
    for b in bs:
        cy = (b[1] + b[3]) / 2
        if rows and abs(cy - rows[-1][0]) < (b[3] - b[1]) * 0.5:
            rows[-1][1].append(b)
        else:
            rows.append([cy, [b]])
    return [b for _, row in rows for b in sorted(row, key=lambda b: b[0])]


def fit(img, w, h):
    s = min(w / img.width, h / img.height)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def process_object(name):
    w_tiles, h_tiles = OBJECTS[name][1], OBJECTS[name][2]
    img = cut_out(Image.open(RAW / f"{name}.png"))
    bs = boxes(img, gap=40)
    box = (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))
    fit(img.crop(box), round(w_tiles * TILE), round(h_tiles * TILE)).save(OUT / f"{name}.png", optimize=True)


class SeveralFigures(Exception):
    """The model drew the pose more than once; the image has to be generated again."""


def figure(name):
    """The one figure in a single-pose image, cropped."""
    img = cut_out(Image.open(RAW / f"{name}.png"))
    bs = boxes(img, gap=24)
    area = lambda b: (b[2] - b[0]) * (b[3] - b[1])
    big = max(bs, key=area)
    if any(b is not big and area(b) > area(big) * 0.25 for b in bs):
        raise SeveralFigures(name)
    return img.crop(big)


def process_character(name):
    """
    The poses side by side, each in a double-width cell, all scaled by one
    shared factor (the standing figure fills the frame height) and standing on
    the bottom edge.
    """
    bad = []
    poses = []
    for pose, _ in POSES:
        try:
            poses.append(figure(f"{name}--{pose}"))
        except SeveralFigures:
            bad.append(f"{name}--{pose}")
    if bad:
        raise SeveralFigures(" ".join(bad))
    cell = FRAME_W * 2
    sheet = Image.new("RGBA", (cell * len(poses), FRAME_H), (0, 0, 0, 0))
    for (pose, _), p in zip(POSES, poses):
        i = [n for n, _ in POSES].index(pose)
        # Every pose is its own generation at its own size: scale each to the height its kind of pose has.
        p = fit(p, cell, POSE_HEIGHT[pose])
        if pose == "side" and name in SIDE_FACES_RIGHT:
            p = p.transpose(Image.FLIP_LEFT_RIGHT)
        sheet.alpha_composite(p, (i * cell + (cell - p.width) // 2, FRAME_H - p.height))
    sheet.save(OUT / f"{name}.png", optimize=True)


def process_cat():
    poses = [figure(f"cat--{pose}") for pose, _ in CAT_POSES]
    # Same height for every pose would make the sleeping curl huge; scale by the widest instead.
    scale = min(TILE * 0.9 / max(p.width for p in poses), TILE * 0.8 / max(p.height for p in poses))
    sheet = Image.new("RGBA", (TILE * len(poses), TILE), (0, 0, 0, 0))
    for i, p in enumerate(poses):
        p = p.resize((max(1, round(p.width * scale)), max(1, round(p.height * scale))), Image.LANCZOS)
        sheet.alpha_composite(p, (i * TILE + (TILE - p.width) // 2, TILE - p.height))
    sheet.save(OUT / "cat.png", optimize=True)


def process(name):
    """Turn one finished asset into its game image. Returns False if it failed."""
    try:
        if name in OBJECTS:
            process_object(name)
        elif name in characters():
            process_character(name)
        elif name == "cat":
            process_cat()
        print(f"processed {name}", flush=True)
        return True
    except SeveralFigures as e:
        print(f"SEVERAL FIGURES: {e}", flush=True)
        return False
    except Exception as e:
        print(f"PROCESS FAILED {name}: {e}", flush=True)
        return False


def main():
    args = sys.argv[1:]
    RAW.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    all_jobs = jobs()
    if "--redo" in args:
        for name in args[args.index("--redo") + 1 :]:
            (RAW / f"{name}.png").unlink(missing_ok=True)
    if "--process" not in args:
        # Two rounds: sheets and objects first, then the poses that use a sheet as reference.
        for first in (True, False):
            todo = [n for n, (_, ref) in all_jobs.items() if not (RAW / f"{n}.png").exists() and ref.startswith("raw:") != first]
            todo = [n for n in todo if first or (RAW / f"{all_jobs[n][1][4:]}.png").exists()]
            if not first:
                # Front views first: the other poses use them as their reference.
                fronts = [n for n in todo if n.endswith("--front")]
                with ThreadPoolExecutor(10) as pool:
                    for n in fronts:
                        pool.submit(generate, n, *all_jobs[n])
                todo = [n for n in todo if n not in fronts and (RAW / f"{all_jobs[n][1][4:]}.png").exists()]
            with ThreadPoolExecutor(10) as pool:
                for n in todo:
                    pool.submit(generate, n, *all_jobs[n])
    finished = ["cat"] + list(OBJECTS) + list(characters())
    # Cleaning up images is CPU-bound pure Python: separate processes, one per core.
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(process, finished))
    failed = [n for n, r in zip(finished, results) if not r]
    missing = [n for n in all_jobs if not (RAW / f"{n}.png").exists()]
    print("FAILED:", " ".join(failed) if failed else "none")
    print("NOT GENERATED:", " ".join(missing) if missing else "none")

if __name__ == "__main__":
    main()
