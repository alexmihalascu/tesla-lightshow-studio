"""Quick check: python test_studio.py (no framework)."""
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "generator"))
import make_show  # noqa: E402
import studio  # noqa: E402


def test_fseq_roundtrip_and_stats():
    frames = 500
    data = np.zeros((frames, 48), np.uint8)
    data[10:20, 0] = 255                       # left outer main beam on
    data[50:60, make_show.L_MIRROR] = make_show.C_CLOSE
    data[200:210, make_show.L_MIRROR] = make_show.C_OPEN
    data[300:400, make_show.CHARGE_PORT] = make_show.C_DANCE
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "t.fseq"
        make_show.write_fseq(path, data)
        raw = path.read_bytes()
        assert raw[:4] == b"PSEQ" and raw[6:8] == b"\x00\x02" and raw[20] == 0  # v2.0, uncompressed
        stats = studio.fseq_stats(path)
    assert stats["duration"] == frames * make_show.STEP_MS / 1000
    assert stats["lights"] == 1
    assert stats["mirrors"] == 2 and stats["chargePort"] == 1 and stats["windows"] == 0
    assert len(stats["activity"]) == 96 and sum(stats["moving"]) > 0


def test_closure_command_counting():
    col = np.array([0, 64, 64, 0, 128, 128, 192, 0, 255, 0], np.uint8)  # Open, Dance, Close, Stop
    assert make_show.closure_commands(col) == 3  # Stop doesn't count toward the limit


def test_name_validation():
    assert studio.NAME_RE.match("Sculati presedintele")
    assert not studio.NAME_RE.match("../etc")
    assert not studio.NAME_RE.match("a/b")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
