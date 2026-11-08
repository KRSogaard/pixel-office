#!/usr/bin/env python3
"""
Make a Tripo character (.glb) small enough to ship with the web app, without
changing its shape or its skeleton:

  - animations keep only bone rotations (plus the hips' movement): Tripo also
    writes every bone's position and scale on every frame, which never change;
  - vertex normals are dropped: the office shades people flat (low-poly), and
    three.js does that by itself when a model has no normals;
  - the texture is scaled down to 1024 px and saved as a JPEG again;
  - unused animations (Tripo's "sit" is a crouch; sitting is posed in code) go;
  - animations keep every second frame (Tripo writes 30 a second);
  - skin weights are stored in a byte each, texture coordinates in two bytes
    (both plain glTF 2.0, no extensions needed).

Usage: python3 scripts/slim-glb.py in.glb out.glb   (needs Pillow)
"""
import io
import json
import struct
import sys

from PIL import Image

KEEP_TRANSLATION = {"Hip"}
DROP_ANIMATIONS = {"sit"}
TEXTURE_PX = 1024
KEEP_EVERY = 2
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = open(path, "rb").read()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a glb"
    offset = 12
    doc, binary = None, b""
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + size]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + size
    return doc, binary


def write_glb(path, doc, binary):
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


def slim(doc, binary):
    nodes = doc["nodes"]
    views = doc["bufferViews"]
    view_bytes = {i: binary[v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]] for i, v in enumerate(views)}

    def read(acc):
        assert acc["componentType"] == 5126 and "byteStride" not in views[acc["bufferView"]], "expected tightly packed floats"
        n = acc["count"] * NCOMP[acc["type"]]
        return list(struct.unpack_from(f"<{n}f", view_bytes[acc["bufferView"]], acc.get("byteOffset", 0)))

    def store(acc, data, fmt, component_type, normalized=False):
        """Point `acc` at a new buffer view holding `data`."""
        views.append({"buffer": 0, "byteLength": 0})
        i = len(views) - 1
        view_bytes[i] = struct.pack(f"<{len(data)}{fmt}", *data)
        views[i]["byteLength"] = len(view_bytes[i])
        acc.update(bufferView=i, byteOffset=0, componentType=component_type)
        if normalized:
            acc["normalized"] = True

    # Animations: drop unused clips and constant position/scale tracks.
    anims = []
    for a in doc.get("animations", []):
        if a["name"] in DROP_ANIMATIONS:
            continue
        keep = []
        for c in a["channels"]:
            path = c["target"]["path"]
            name = nodes[c["target"]["node"]].get("name", "")
            if path == "rotation" or (path == "translation" and name in KEEP_TRANSLATION):
                keep.append(c)
        samplers = []
        for c in keep:
            samplers.append(a["samplers"][c["sampler"]])
            c["sampler"] = len(samplers) - 1
        anims.append({**a, "channels": keep, "samplers": samplers})
    doc["animations"] = anims

    # Fewer keyframes: every KEEP_EVERY-th, and always the last. Tracks often
    # share one list of key times, so each list (and each list of values) is
    # thinned exactly once.
    kept = {}  # input accessor -> indices kept
    done_outputs = set()
    for a in doc["animations"]:
        for smp in a["samplers"]:
            if smp.get("interpolation", "LINEAR") != "LINEAR":
                continue
            t_acc, v_acc = doc["accessors"][smp["input"]], doc["accessors"][smp["output"]]
            if smp["input"] not in kept:
                times = read(t_acc)
                keep = list(range(0, len(times), KEEP_EVERY))
                if keep[-1] != len(times) - 1:
                    keep.append(len(times) - 1)
                kept[smp["input"]] = keep
                store(t_acc, [times[i] for i in keep], "f", 5126)
                t_acc.update(count=len(keep), min=[times[keep[0]]], max=[times[keep[-1]]])
            if smp["output"] in done_outputs:
                continue
            done_outputs.add(smp["output"])
            keep = kept[smp["input"]]
            values = read(v_acc)
            k = NCOMP[v_acc["type"]]
            assert len(values) // k > keep[-1], "a track has fewer values than key times"
            store(v_acc, [values[i * k + c] for i in keep for c in range(k)], "f", 5126)
            v_acc["count"] = len(keep)
            v_acc.pop("min", None)
            v_acc.pop("max", None)

    # Meshes: no normals; weights in bytes; texture coordinates in shorts.
    for m in doc["meshes"]:
        for p in m["primitives"]:
            attrs = p["attributes"]
            attrs.pop("NORMAL", None)
            if "WEIGHTS_0" in attrs:
                acc = doc["accessors"][attrs["WEIGHTS_0"]]
                w = read(acc)
                out = []
                for i in range(0, len(w), 4):
                    q = [round(x * 255) for x in w[i : i + 4]]
                    q[q.index(max(q))] += 255 - sum(q)  # each vertex's weights still add up to 1
                    out += q
                store(acc, out, "B", 5121, normalized=True)
                acc.pop("min", None)
                acc.pop("max", None)
            if "TEXCOORD_0" in attrs:
                acc = doc["accessors"][attrs["TEXCOORD_0"]]
                uv = read(acc)
                if all(0 <= x <= 1 for x in uv):
                    store(acc, [round(x * 65535) for x in uv], "H", 5123, normalized=True)
                    acc.pop("min", None)
                    acc.pop("max", None)

    # Texture: smaller JPEG.
    for img in doc.get("images", []):
        if "bufferView" not in img:
            continue
        im = Image.open(io.BytesIO(view_bytes[img["bufferView"]])).convert("RGB")
        if max(im.size) > TEXTURE_PX:
            im.thumbnail((TEXTURE_PX, TEXTURE_PX), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85, optimize=True)
        view_bytes[img["bufferView"]] = out.getvalue()
        views[img["bufferView"]]["byteLength"] = len(out.getvalue())
        img["mimeType"] = "image/jpeg"

    # Which accessors are still used?
    used = set()
    for m in doc["meshes"]:
        for p in m["primitives"]:
            used.update(p["attributes"].values())
            if "indices" in p:
                used.add(p["indices"])
    for s in doc.get("skins", []):
        if "inverseBindMatrices" in s:
            used.add(s["inverseBindMatrices"])
    for a in doc["animations"]:
        for s in a["samplers"]:
            used.update((s["input"], s["output"]))
    # Unused accessors stay (so no indices shift) but lose their data.
    for i, acc in enumerate(doc["accessors"]):
        if i not in used:
            acc.pop("bufferView", None)
            acc.pop("byteOffset", None)
            acc["count"] = 1
            acc.pop("min", None)
            acc.pop("max", None)

    # Rebuild the buffer from the views still referenced.
    referenced = {acc["bufferView"] for acc in doc["accessors"] if "bufferView" in acc}
    referenced |= {img["bufferView"] for img in doc.get("images", []) if "bufferView" in img}
    new_views, remap, blob = [], {}, bytearray()
    for i in sorted(referenced):
        blob += b"\0" * (-len(blob) % 4)
        v = {k: val for k, val in views[i].items() if k != "byteOffset"}
        v["byteOffset"] = len(blob)
        v["byteLength"] = len(view_bytes[i])
        blob += view_bytes[i]
        remap[i] = len(new_views)
        new_views.append(v)
    for acc in doc["accessors"]:
        if "bufferView" in acc:
            acc["bufferView"] = remap[acc["bufferView"]]
    for img in doc.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = remap[img["bufferView"]]
    doc["bufferViews"] = new_views
    doc["buffers"] = [{"byteLength": len(blob)}]
    return doc, bytes(blob)


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    doc, binary = read_glb(src)
    doc, binary = slim(doc, binary)
    write_glb(dst, doc, binary)
    print(f"{src} → {dst}: {len(open(src, 'rb').read()) // 1024} KB → {len(open(dst, 'rb').read()) // 1024} KB")
