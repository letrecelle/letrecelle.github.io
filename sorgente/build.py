#!/usr/bin/env python3
"""Rebuilds the website at the top of this repository from sorgente/.

    python3 sorgente/build.py

- sorgente/le-tre-celle.html  the app (same file as the version published inside Claude)
- sorgente/src/               what the website adds: sign-in, Firebase database, offline, icons
Writes index.html, ltc-firebase.js, sw.js, manifest.webmanifest, robots.txt, icons/, firestore.rules at the repo root.
tessdata/eng.wasm (the text reader for photos) stays as it is.
"""
import os, shutil, hashlib, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "src")
SHOP_EMAIL = "letrecelle@gmail.com"

app = open(os.path.join(HERE, "le-tre-celle.html"), encoding="utf-8").read()
cut = app.index("<style>")
head_bits, body = app[:cut].strip(), app[cut:]
page = open(os.path.join(SRC, "head.html"), encoding="utf-8").read().replace("__TITLE_AND_FONTS__", head_bits)
page += body.strip() + '\n<script type="module" src="ltc-firebase.js"></script>\n</body>\n</html>\n'
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(page)

build = time.strftime("%Y%m%d%H%M%S") + "-" + hashlib.sha1(page.encode()).hexdigest()[:8]
for name in ["ltc-firebase.js", "manifest.webmanifest", "robots.txt"]:
    shutil.copy(os.path.join(SRC, name), os.path.join(ROOT, name))
open(os.path.join(ROOT, "sw.js"), "w").write(open(os.path.join(SRC, "sw.js")).read().replace("__BUILD__", build))
open(os.path.join(ROOT, "firestore.rules"), "w").write(open(os.path.join(SRC, "firestore.rules")).read().replace("__SHOP_EMAIL__", SHOP_EMAIL))
os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
for f in os.listdir(os.path.join(SRC, "icons")):
    shutil.copy(os.path.join(SRC, "icons", f), os.path.join(ROOT, "icons", f))
assert os.path.exists(os.path.join(ROOT, "tessdata", "eng.wasm")), "tessdata/eng.wasm is missing"
print("built", build)
