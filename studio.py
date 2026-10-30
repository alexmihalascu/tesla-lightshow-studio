"""Tesla Light Show Studio — server local: bibliotecă de show-uri, player, generator, copiere pe stick.
Pornire: python studio.py   (apoi http://127.0.0.1:8642)
"""
import json, os, re, shutil, string, struct, sys, tempfile, threading, webbrowser
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
SHOWS = ROOT / "shows"
PORT = 8642
# Proiectul oficial Tesla xLights (modele 3D + poziții lumini). Nu e redistribuit în repo: se citește local.
TESLA_CANDIDATES = [os.environ.get("TESLA_XLIGHTS_DIR", ""), ROOT / "tesla_xlights_show_folder",
                    Path.home() / "Downloads" / "tesla_xlights_show_folder"]
TESLA_FILES = (".obj", ".mtl", ".png", ".jpg")
MODELS_DIR = ROOT / "models"  # modele 3D proprii (.glb), nu intră în git
AUDIO = (".wav", ".mp3")
NAME_RE = re.compile(r"^[\w\- ]{1,60}$")
CLOSURES = {"mirrors": (34, 20), "windows": (36, 6), "liftgate": (40, 6), "chargePort": (45, 3)}
_stats_cache = {}


def usb_dir():
    """Stickul Tesla = primul drive (D:..Z:) care are LightShow/ sau TeslaCam/."""
    for letter in string.ascii_uppercase[3:]:
        root = Path(f"{letter}:/")
        try:
            if (root / "LightShow").is_dir() or (root / "TeslaCam").is_dir():
                return root / "LightShow"
        except OSError:
            continue
    return None


def tesla_dir():
    for c in TESLA_CANDIDATES:
        if c and (Path(c) / "xlights_rgbeffects.xml").is_file():
            return Path(c)
    return None


def tesla_layout():
    """Modelele de lumini/închideri și mesh-urile 3D din xlights_rgbeffects.xml (coordonate xLights, Y în sus),
    plus modelele 3D proprii din models/*.glb (ex. model3.glb, modely.glb)."""
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
        parts = Path(v.get("ObjFile").replace("\\", "/")).parts[-2:]  # ex. Model_S/ModelS.obj
        meshes.append({"name": v.get("name"), "obj": "/".join(parts),
                       "pos": [num(v, "WorldPosX"), num(v, "WorldPosY"), num(v, "WorldPosZ")],
                       "scale": [num(v, "ScaleX", 1), num(v, "ScaleY", 1), num(v, "ScaleZ", 1)],
                       "rot": [num(v, "RotateX"), num(v, "RotateY"), num(v, "RotateZ")]})
    return {"models": models, "meshes": meshes, "custom": custom}


def fseq_stats(path):
    """Durată, lumini folosite și comenzi de închideri (Open/Dance/Close) dintr-un .fseq v2 necomprimat."""
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
        # Amprenta pentru cardurile de proiect: 96 de intervale, cât din lumini e aprins / dacă se mișcă ceva
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
        return SHOWS if source == "local" else usb_dir() if source == "usb" else None

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/shows":
            usb = usb_dir()
            return self.send_json({"local": list_shows(SHOWS, "local"), "usb": list_shows(usb, "usb"),
                                   "usbDrive": str(usb.parent)[:2] if usb else None,
                                   # Tesla: stickul NU trebuie să aibă TeslaCam în rădăcină, altfel show-urile nu apar
                                   "usbHasTeslaCam": bool(usb and (usb.parent / "TeslaCam").is_dir())})
        if path == "/api/layout":
            layout = tesla_layout()
            return self.send_json(layout or {"error": "Nu găsesc proiectul Tesla xLights (tesla_xlights_show_folder)."},
                                  200 if layout else 404)
        m = re.fullmatch(r"/models/([\w\-]+\.glb)", path)
        if m:
            target = MODELS_DIR / m[1]
            if not target.is_file():
                return self.send_json({"error": "Modelul 3D nu există."}, 404)
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
                return self.send_json({"error": "Fișierul nu există."}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "image/png" if target.suffix.lower() == ".png" else
                             "image/jpeg" if target.suffix.lower() == ".jpg" else "text/plain")
            self.send_header("Content-Length", str(target.stat().st_size))
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            with open(target, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return
        m = re.fullmatch(r"/files/(local|usb)/([^/]+)", path)
        if m:
            folder, fname = self.folder(m[1]), m[2]
            target = folder / fname if folder else None
            if not target or Path(fname).suffix not in (".fseq", *AUDIO) or not NAME_RE.match(Path(fname).stem) \
                    or not target.is_file():
                return self.send_json({"error": "Fișierul nu există."}, 404)
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
                return self.send_json({"error": "Numele poate avea doar litere, cifre, spații și cratime."}, 400)
            if (SHOWS / f"{name}.fseq").exists():
                return self.send_json({"error": f"Există deja un show numit „{name}”. Alege alt nume."}, 409)
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
                except Exception as e:  # noqa: BLE001 — orice eroare a generatorului ajunge în UI
                    return self.send_json({"error": f"Generarea a eșuat: {e}"}, 500)
            return self.send_json({"name": name, "bpm": round(bpm), "beats": nbeats})
        if path == "/api/copy-to-usb":
            name = json.loads(self.rfile.read(length) or b"{}").get("name", "")
            usb = usb_dir()
            if not usb:
                return self.send_json({"error": "Nu găsesc stickul Tesla. Conectează-l și încearcă din nou."}, 404)
            fseq, audio = show_files(SHOWS, name)
            if not NAME_RE.match(name) or not fseq.exists() or not audio:
                return self.send_json({"error": "Show-ul nu există în bibliotecă."}, 404)
            need = fseq.stat().st_size + audio.stat().st_size
            if shutil.disk_usage(usb.parent).free < need:
                return self.send_json({"error": "Nu e destul spațiu liber pe stick."}, 507)
            usb.mkdir(exist_ok=True)
            for other in AUDIO:  # un singur fișier audio per show, altfel mașina poate alege greșit
                (usb / f"{name}{other}").unlink(missing_ok=True)
            for f in (fseq, audio):
                shutil.copyfile(f, usb / f.name)
                if (usb / f.name).stat().st_size != f.stat().st_size:
                    return self.send_json({"error": f"Copierea lui {f.name} nu s-a terminat corect."}, 500)
            return self.send_json({"copied": name, "drive": str(usb.parent)[:2]})
        return self.send_json({"error": "Rută necunoscută."}, 404)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    SHOWS.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Tesla Light Show Studio rulează la {url}  (Ctrl+C pentru oprire)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
