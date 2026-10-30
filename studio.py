"""Tesla Light Show Studio — local server: show library, player, generator, copy to USB drive.
Run: python studio.py   (then open http://127.0.0.1:8642)
"""
import json, os, re, shutil, string, struct, sys, tempfile, threading, webbrowser
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
SHOWS = ROOT / "shows"
PORT = 8642
# Official Tesla xLights project (3D models + light positions). Not redistributed: read from disk.
TESLA_CANDIDATES = [os.environ.get("TESLA_XLIGHTS_DIR", ""), ROOT / "tesla_xlights_show_folder",
                    Path.home() / "Downloads" / "tesla_xlights_show_folder"]
TESLA_FILES = (".obj", ".mtl", ".png", ".jpg")
MODELS_DIR = ROOT / "models"  # your own 3D models (.glb), not in git
AUDIO = (".wav", ".mp3")
NAME_RE = re.compile(r"^[\w\- ]{1,60}$")
CLOSURES = {"mirrors": (34, 20), "windows": (36, 6), "liftgate": (40, 6), "chargePort": (45, 3)}
_stats_cache = {}


def usb_drives():
    """Every removable drive (USB sticks; internal disks are skipped even with a TeslaCam backup on them).
    [{"drive": "F", "label": "LIGHTSHOW", "lightShow": bool, "teslaCam": bool}]"""
    if os.name != "nt":
        return []
    import ctypes
    k32, out = ctypes.windll.kernel32, []
    for letter in string.ascii_uppercase[3:]:
        root = f"{letter}:\\"
        if k32.GetDriveTypeW(root) != 2:  # DRIVE_REMOVABLE
            continue
        label = ctypes.create_unicode_buffer(261)
        if not k32.GetVolumeInformationW(root, label, 261, None, None, None, None, 0):
            continue  # card reader slot without a card
        p = Path(root)
        out.append({"drive": letter, "label": label.value, "lightShow": (p / "LightShow").is_dir(),
                    "teslaCam": (p / "TeslaCam").is_dir()})
    return out


def target_drive(drives):
    """Where shows get copied: a drive that already has LightShow/, else one labelled LIGHTSHOW,
    else any drive without TeslaCam/ (Tesla won't list shows on a drive that has it)."""
    for ok in (lambda d: d["lightShow"] and not d["teslaCam"], lambda d: d["lightShow"],
               lambda d: d["label"].upper() == "LIGHTSHOW", lambda d: not d["teslaCam"]):
        found = next((d["drive"] for d in drives if ok(d)), None)
        if found:
            return found
    return None


def usb_dir(letter):
    return Path(f"{letter}:/LightShow")


def tesla_dir():
    for c in TESLA_CANDIDATES:
        if c and (Path(c) / "xlights_rgbeffects.xml").is_file():
            return Path(c)
    return None


def tesla_layout():
    """Light/closure models and 3D meshes from xlights_rgbeffects.xml (xLights coordinates, Y up),
    plus your own 3D models in models/*.glb (e.g. model3.glb, modely.glb)."""
    custom = sorted(p.stem for p in MODELS_DIR.glob("*.glb"))
    folder = tesla_dir()
    if not folder:
        return {"models": [], "meshes": [], "custom": custom} if custom else None
    root = ET.parse(folder / "xlights_rgbeffects.xml").getroot()
    num = lambda e, k, d=0.0: float(e.get(k, d))
    models = []
    for m in root.iter("model"):
        start = re.fullmatch(r"!Model S:(\d+)", m.get("StartChannel", ""))
        if not start or m.get("Active", "1") == "0" or m.get("LayoutGroup") == "hidden":
            continue
        pts = [float(x) for x in m.get("PointData", "").split(",") if x]
        models.append({
            "points": [pts[i:i + 3] for i in range(0, len(pts), 3)],
            "segs": [int(m.get(f"Seg{i}", 0)) for i in (1, 2, 3)] if m.get("IndivSegs") == "1" else [],
            "name": m.get("name"), "ch": int(start[1]) - 1, "type": m.get("DisplayAs"),
            "string": m.get("StringType", ""), "nodes": int(m.get("parm2", 1)) if "Node" in m.get("StringType", "") else 1,
            "rgb": "RGB" in m.get("StringType", ""),
            "pos": [num(m, "WorldPosX"), num(m, "WorldPosY"), num(m, "WorldPosZ")],
            "end": [num(m, "X2"), num(m, "Y2"), num(m, "Z2")],
            "scale": [num(m, "ScaleX", 1), num(m, "ScaleY", 1), num(m, "ScaleZ", 1)],
            "ct": m.get("name", "").startswith("CT ") or "Light Bar" in m.get("name", "") or "Frunk" in m.get("name", ""),
        })
    meshes = []
    for v in root.iter("view_object"):
        if v.get("DisplayAs") != "Mesh" or not v.get("ObjFile"):
            continue
        parts = Path(v.get("ObjFile").replace("\\", "/")).parts[-2:]  # e.g. Model_S/ModelS.obj
        meshes.append({"name": v.get("name"), "obj": "/".join(parts),
                       "pos": [num(v, "WorldPosX"), num(v, "WorldPosY"), num(v, "WorldPosZ")],
                       "scale": [num(v, "ScaleX", 1), num(v, "ScaleY", 1), num(v, "ScaleZ", 1)],
                       "rot": [num(v, "RotateX"), num(v, "RotateY"), num(v, "RotateZ")]})
    return {"models": models, "meshes": meshes, "custom": custom}


def fseq_stats(path):
    """Duration, lights used and closure commands (Open/Dance/Close) from an uncompressed .fseq v2."""
    key = (str(path), path.stat().st_mtime)
    if key in _stats_cache:
        return _stats_cache[key]
    b = path.read_bytes()
    off, = struct.unpack("<H", b[4:6])
    ch, frames = struct.unpack("<II", b[10:18])
    step, compressed = b[18], b[20] & 0x0F
    stats = {"duration": frames * step / 1000, "channels": ch, "compressed": bool(compressed)}
    if not compressed:
        data = b[off:off + ch * frames]
        stats["lights"] = sum(max(data[c::ch], default=0) > 127 for c in range(30))
        # Fingerprint for project cards: 96 buckets, how many lights are on / whether anything moves
        buckets = 96
        lit, moving = [0] * buckets, [0] * buckets
        for c in range(30):
            for f, v in enumerate(data[c::ch]):
                if v > 127:
                    lit[f * buckets // frames] += 1
        for c in range(30, min(46, ch)):
            for f, v in enumerate(data[c::ch]):
                if 1 <= (v // 32 + 1) // 2 <= 3:
                    moving[f * buckets // frames] = 1
        per_bucket = 30 * frames / buckets
        stats["activity"] = [round(min(1, x / per_bucket * 2.5), 2) for x in lit]
        stats["moving"] = moving
        for key_, (c, _limit) in CLOSURES.items():
            prev, count = 0, 0
            for v in data[c::ch]:
                state = (v // 32 + 1) // 2
                if state != prev and state in (1, 2, 3):
                    count += 1
                prev = state
            stats[key_] = count
    _stats_cache[key] = stats
    return stats


def list_shows(folder, source):
    if not folder or not folder.is_dir():
        return []
    shows = []
    for fseq in sorted(folder.glob("*.fseq"), key=lambda p: p.stem.lower()):
        audio = next((fseq.with_suffix(e) for e in AUDIO if fseq.with_suffix(e).exists()), None)
        if audio:
            shows.append({"name": fseq.stem, "source": source, "audio": audio.suffix,
                          "size": fseq.stat().st_size + audio.stat().st_size, **fseq_stats(fseq)})
    return shows


def show_files(folder, name):
    fseq = folder / f"{name}.fseq"
    audio = next((fseq.with_suffix(e) for e in AUDIO if fseq.with_suffix(e).exists()), None)
    return fseq, audio


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / "player"), **kw)

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def folder(self, source):
        if source == "local":
            return SHOWS
        return usb_dir(source) if any(d["drive"] == source for d in usb_drives()) else None

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/shows":
            drives = usb_drives()
            for d in drives:
                d["shows"] = list_shows(usb_dir(d["drive"]), d["drive"])
            return self.send_json({"local": list_shows(SHOWS, "local"), "drives": drives,
                                   "target": target_drive(drives)})
        if path == "/api/layout":
            layout = tesla_layout()
            return self.send_json(layout or {"error": "Can't find the Tesla xLights project (tesla_xlights_show_folder)."},
                                  200 if layout else 404)
        m = re.fullmatch(r"/models/([\w\-]+\.glb)", path)
        if m:
            target = MODELS_DIR / m[1]
            if not target.is_file():
                return self.send_json({"error": "3D model not found."}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "model/gltf-binary")
            self.send_header("Content-Length", str(target.stat().st_size))
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            with open(target, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return
        if path.startswith("/tesla/"):
            folder = tesla_dir()
            rel = Path(path[len("/tesla/"):])
            target = (folder / rel).resolve() if folder else None
            if not target or folder.resolve() not in target.parents or target.suffix.lower() not in TESLA_FILES \
                    or not target.is_file():
                return self.send_json({"error": "File not found."}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "image/png" if target.suffix.lower() == ".png" else
                             "image/jpeg" if target.suffix.lower() == ".jpg" else "text/plain")
            self.send_header("Content-Length", str(target.stat().st_size))
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            with open(target, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return
        m = re.fullmatch(r"/files/(local|[D-Z])/([^/]+)", path)
        if m:
            folder, fname = self.folder(m[1]), m[2]
            target = folder / fname if folder else None
            if not target or Path(fname).suffix not in (".fseq", *AUDIO) or not NAME_RE.match(Path(fname).stem) \
                    or not target.is_file():
                return self.send_json({"error": "File not found."}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(target.stat().st_size))
            self.end_headers()
            with open(target, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return
        return super().do_GET()

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        length = int(self.headers.get("Content-Length", 0))
        if path == "/api/generate":
            name = unquote(self.headers.get("X-Name", "")).strip()
            if not NAME_RE.match(name):
                return self.send_json({"error": "Names can only contain letters, digits, spaces and dashes."}, 400)
            if (SHOWS / f"{name}.fseq").exists():
                return self.send_json({"error": f"A show named \"{name}\" already exists. Pick another name."}, 409)
            suffix = Path(unquote(self.headers.get("X-Filename", "x.mp3"))).suffix or ".mp3"
            with tempfile.TemporaryDirectory() as tmp:
                src = Path(tmp) / f"source{suffix}"
                with open(src, "wb") as f:
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(remaining, 1 << 20))
                        if not chunk:
                            break
                        f.write(chunk)
                        remaining -= len(chunk)
                try:
                    sys.path.insert(0, str(ROOT / "generator"))
                    import make_show
                    _data, bpm, nbeats, _dance = make_show.generate(src, SHOWS, name,
                                                                     self.headers.get("X-Max") == "1",
                                                                     self.headers.get("X-Model", "m3"))
                except Exception as e:  # noqa: BLE001 — any generator error is shown in the UI
                    return self.send_json({"error": f"Generation failed: {e}"}, 500)
            return self.send_json({"name": name, "bpm": round(bpm), "beats": nbeats})
        if path == "/api/copy-to-usb":
            name = json.loads(self.rfile.read(length) or b"{}").get("name", "")
            letter = target_drive(usb_drives())
            if not letter:
                return self.send_json({"error": "Can't find the Tesla drive. Plug it in and try again."}, 404)
            usb = usb_dir(letter)
            fseq, audio = show_files(SHOWS, name)
            if not NAME_RE.match(name) or not fseq.exists() or not audio:
                return self.send_json({"error": "That show isn't in the library."}, 404)
            need = fseq.stat().st_size + audio.stat().st_size
            if shutil.disk_usage(usb.parent).free < need:
                return self.send_json({"error": "Not enough free space on the drive."}, 507)
            usb.mkdir(exist_ok=True)
            for other in AUDIO:  # one audio file per show, otherwise the car may pick the wrong one
                (usb / f"{name}{other}").unlink(missing_ok=True)
            for f in (fseq, audio):
                shutil.copyfile(f, usb / f.name)
                if (usb / f.name).stat().st_size != f.stat().st_size:
                    return self.send_json({"error": f"Copying {f.name} didn't finish correctly."}, 500)
            return self.send_json({"copied": name, "drive": str(usb.parent)[:2]})
        return self.send_json({"error": "Unknown route."}, 404)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    SHOWS.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Tesla Light Show Studio running at {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
