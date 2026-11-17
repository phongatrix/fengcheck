#!/usr/bin/env python3
"""
Tạo ảnh "scan thực tế" từ file PDF/ảnh mẫu giấy + đáp án đã biết, dùng để
kiểm thử pipeline (tests/verify-scans.test.ts). Cách dùng:

    # 1. dump layout JSON (chạy trong webcam/):
    #    npx vitest run tests/dump-layout.test.ts
    # 2. tạo scan:
    python3 scripts/make-realistic-scans.py

Đầu ra: /tmp/scan-giay12.jpg, /tmp/scan-giay1011.jpg (+ .gray/.meta.json cho test).
"""
import fitz  # PyMuPDF
import json
import random
from PIL import Image, ImageDraw, ImageFilter

random.seed(42)
LAYOUT_DIR = "tests/fixtures"
PDFS = {
    "GIAY12": "docs/maugiay/Giay12.pdf",
    "GIAY10_11": "docs/maugiay/Giay10_11.pdf",
}
FALLBACK_PDFS = {
    "GIAY12": "public/templates/12.png",
    "GIAY10_11": "public/templates/10_11.png",
    "MOI": "public/templates/moi.png",
}

ANSWERS = {
    "GIAY12": lambda i: i % 4 if i < 40 else (i % 2 if i < 72 else (i * 3) % 10),
    "GIAY10_11": lambda i: (i + 1) % 4 if i < 30 else ((i + 1) % 2 if i < 70 else (i * 7) % 10),
    "MOI": lambda i: i % 4 if i < 20 else ((i + 1) % 2 if i < 36 else (i * 3) % 10),
}
EXAM = {"GIAY12": "314", "GIAY10_11": "268", "MOI": "101"}
STUDENT = {"GIAY12": "00640012", "GIAY10_11": None, "MOI": None}


def load_layout(kind):
    return json.load(open(f"{LAYOUT_DIR}/layout-{kind}.json"))


def open_template(kind):
    """Ưu tiên PDF vector; nếu không có dùng ảnh PNG mẫu."""
    try:
        doc = fitz.open(PDFS[kind])
        return ("pdf", doc[0])
    except Exception:
        img = Image.open(FALLBACK_PDFS[kind]).convert("RGB")
        return ("img", img)


def make_scan(kind, out_prefix):
    layout = load_layout(kind)
    src_kind, src = open_template(kind)
    if src_kind == "pdf":
        zoom = 130 / 72
        pix = src.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
        W, H = pix.width, pix.height
        img = Image.frombytes("L", (W, H), pix.samples).convert("RGB")
    else:
        img = src.copy()
        W, H = img.size
        # Ảnh mẫu nhỏ (moi.png 406px) — in khổ A4 rồi scan sẽ ở độ phân giải cao hơn;
        # nâng lên đúng độ phân giải in thực tế trước khi tô.
        if max(W, H) < 2400:
            f = 2500 / max(W, H)  # in A4 + scan ~220 DPI ≈ 2500px cạnh dài
            img = img.resize((int(W * f), int(H * f)), Image.LANCZOS)
            W, H = img.size

    draw = ImageDraw.Draw(img)
    minside = min(W, H)

    def fill(b):
        cx, cy, r = b["x"] * W, b["y"] * H, b["r"] * minside
        draw.ellipse([cx - r * 0.82, cy - r * 0.82, cx + r * 0.82, cy + r * 0.82], fill=(25, 25, 28))

    ec = layout.get("examCode")
    if ec:
        code = EXAM[kind]
        pad = len(ec["columns"]) - len(code)
        for ci, col in enumerate(ec["columns"]):
            if ci >= pad:
                d = int(code[ci - pad])
                fill(col["bubbles"][d])
    sc = layout.get("studentCode")
    if sc and STUDENT[kind]:
        for ci, col in enumerate(sc["columns"]):
            if ci < len(STUDENT[kind]):
                fill(col["bubbles"][int(STUDENT[kind][ci])])

    n = layout["totalQuestions"]
    keyfile = f"tests/fixtures/key-{kind}.json"
    import os
    answers_override = None
    if os.path.isfile(keyfile):
        kd = json.load(open(keyfile))
        if kd.get("code") == EXAM[kind]:
            answers_override = kd["answers"]
    for qi in range(n):
        a = answers_override[qi] if answers_override else ANSWERS[kind](qi)
        if a is None or a < 0:
            continue
        if qi < len(layout["questions"]):
            bubbles = layout["questions"][qi]["bubbles"]
            if a < len(bubbles):
                fill(bubbles[a])
        else:
            idx = qi - len(layout["questions"])
            per = len(layout["part3"][0]["columns"])
            q3 = layout["part3"][idx // per]
            col = q3["columns"][idx % per]
            if a < len(col["bubbles"]):
                fill(col["bubbles"][a])

    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img = img.transform((W, H), Image.QUAD, (W * 0.008, H * 0.005, W * 0.005, H * 0.990, W * 0.992, H * 0.994, W * 0.994, H * 0.012))
    p2 = img.load()
    for _ in range(W * H // 40):
        x = random.randrange(W)
        y = random.randrange(H)
        p2[x, y] = tuple(max(0, min(255, c + random.randint(-40, 25))) for c in p2[x, y])
    img.save(out_prefix + ".jpg", "JPEG", quality=82)
    print("saved", out_prefix + ".jpg", f"{W}x{H}")


OUTNAMES = {"GIAY12": "giay12", "GIAY10_11": "giay1011", "MOI": "moi"}
for kind in ("GIAY12", "GIAY10_11", "MOI"):
    out = f"tests/fixtures/scan-{OUTNAMES[kind]}"
    make_scan(kind, out)
    pix = fitz.Pixmap(out + ".jpg")
    if pix.colorspace.n != 1:
        pix = fitz.Pixmap(fitz.csGRAY, pix)
    open(out + ".gray", "wb").write(bytes(pix.samples))
    json.dump({"w": pix.width, "h": pix.height}, open(out + ".meta.json", "w"))
print("done")
