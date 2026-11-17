#!/usr/bin/env python3
"""
Tạo ảnh "scan" cho 2 MẪU GIẤY DÙNG CHUNG (QM_A4 + HSG Giấy 10-11) từ chính
file PDF nhà trường in, tô đúng đáp án mã đề 745 (đọc từ Excel QM 2025).

Dùng để kiểm thử khép kín: overlay (dấu vẽ ở đâu) ↔ reader (đọc lại ra gì).

    npx vitest run tests/dump-shared-layouts.test.ts tests/dump-key-sections.test.ts
    python3 scripts/make-shared-scans.py                 # → tests/fixtures/scan-*.jpg
"""
import json
import random

import pymupdf
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)

PDFS = {
    "QM_A4": "docs/maugiay/QM_2025_A4_Ky-kiem-tra.pdf",
    "GIAY10_11": "docs/maugiay/Giay10_11.pdf",
}
EXAM = "745"
STUDENT = "006400"


def load():
    layouts = json.load(open("/tmp/shared-layouts.json"))
    sections = json.load(open("tests/fixtures/key-sections-745.json"))[EXAM]
    return layouts, sections


def page_image(path):
    page = pymupdf.open(path)[0]
    zoom = 130 / 72
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY, alpha=False)
    return Image.frombytes("L", (pix.width, pix.height), pix.stride and pix.samples).convert("RGB")


def make(kind, layout, sections, out_prefix):
    img = page_image(PDFS[kind])
    W, H = img.size
    draw = ImageDraw.Draw(img)
    minside = min(W, H)

    def fill(b):
        cx, cy, r = b["x"] * W, b["y"] * H, b["r"] * minside
        draw.ellipse([cx - r * 0.82, cy - r * 0.82, cx + r * 0.82, cy + r * 0.82], fill=(25, 25, 28))

    # Mã đề / SBD
    ec = layout.get("examCode")
    if ec:
        pad = len(ec["columns"]) - len(EXAM)
        for ci, col in enumerate(ec["columns"]):
            if ci >= pad:
                fill(col["bubbles"][int(EXAM[ci - pad])])
    sc = layout.get("studentCode")
    if sc:
        pad = len(sc["columns"]) - len(STUDENT)
        for ci, col in enumerate(sc["columns"]):
            if ci >= pad:
                fill(col["bubbles"][int(STUDENT[ci - pad])])

    filled = 0
    for key, opt in sections["p1"].items():
        q = layout["questions"][int(key) - 1]
        fill(q["bubbles"][opt])
        filled += 1
    for key, val in sections["p2"].items():
        n, y = key.split(",")
        q = layout["questions"][layout["part1Count"] + (int(n) - 1) * 4 + int(y)]
        fill(q["bubbles"][0 if val == 0 else 1])
        filled += 1
    for key, digits in sections["p3"].items():
        q = layout["part3"][int(key) - 1]
        for s, d in enumerate(digits):
            if d >= 0:
                fill(q["columns"][s]["bubbles"][d])
                filled += 1

    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img = img.transform(
        (W, H),
        Image.QUAD,
        (W * 0.008, H * 0.005, W * 0.005, H * 0.990, W * 0.992, H * 0.994, W * 0.994, H * 0.012),
    )
    px = img.load()
    for _ in range(W * H // 40):
        x = random.randrange(W)
        y = random.randrange(H)
        px[x, y] = tuple(max(0, min(255, c + random.randint(-40, 25))) for c in px[x, y])
    img.save(out_prefix + ".jpg", "JPEG", quality=82)
    print("saved", out_prefix + ".jpg", f"{W}x{H}", "marks:", filled)


layouts, sections = load()
for kind, name in (("QM_A4", "qma4"), ("GIAY10_11", "hsg")):
    make(kind, layouts[kind], sections, f"tests/fixtures/scan-{name}")
