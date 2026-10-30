# Light Show Studio

A local studio for Tesla Light Shows: turn a song into a show, preview it on your car (2D and 3D), and copy it to your USB drive.

- **Generator**: analyzes the song (tempo, beats, bars, kick/snare/hi-hat, sections) and writes an uncompressed `.fseq` v2 that respects Tesla's official limits. Quiet parts "breathe", verses pulse, build-ups chase left to right, choruses sweep the headlights like a matrix.
- **Per-model emulator**: Model 3, Model 3 (before Oct 2020), Model Y, Model Y Juniper, Model S, Model X and Cybertruck, plus region (Europe or North America) and headlight type. It applies the rules from Tesla's docs: combined channels 4–6 on 3/Y, combined park lights, Cybertruck remapping, which closures each model has.
- **Player**: 2D (side, front, rear), 3D, or both side by side, with camera angles, a channel timeline and a sync offset for Bluetooth/speaker latency.
- **Projects**: shows on your computer and on the drive, with an activity fingerprint and a live hover preview on every card. Presentation mode plays them back to back, full screen.
- **Docs**: channel map, ramps, closures and per-model details at `/docs.html`.

## Running

Requires Python 3.10+ and [ffmpeg](https://ffmpeg.org/) on your PATH.

```sh
pip install -r requirements.txt
python studio.py
```

Opens `http://127.0.0.1:8642`. The server only listens locally.

### Official 3D models

The 3D view uses Tesla's official xLights project, which is **not** included here. Download [teslamotors/light-show](https://github.com/teslamotors/light-show), unzip `xlights/tesla_xlights_show_folder.zip` and put the `tesla_xlights_show_folder` folder in one of these places:

- next to `studio.py`
- in `~/Downloads`
- anywhere, with the `TESLA_XLIGHTS_DIR` environment variable

Tesla only ships Model S and Cybertruck in 3D.

### Your own 3D models (Model 3, Y, Y Juniper, X)

Put `.glb` files (for example from Sketchfab, under a Creative Commons license) in the `models/` folder, which is ignored by git:

| File | Used for |
|---|---|
| `models/model3.glb` | Model 3 |
| `models/modely.glb` | Model Y (2020–2024) |
| `models/modely-juniper.glb` | Model Y Juniper (2025+) |
| `models/modelx.glb` | Model X |

Studio orients and scales the model automatically, finds the lamps by material name (or splits them into front/rear and left/right), cuts out the mirrors and folds them, and shows markers for parts the model doesn't have separately (windows, liftgate). The author and license stored in the file are shown in the 3D view, as CC-BY requires.

## Command-line generator

```sh
python generator/make_show.py song.mp3 --max --model m3 --out LightShow --name show1
```

- `--max`: windows dance, plus the liftgate (Y, S, X, Cybertruck) and door handles (S)
- `--model`: `m3`, `my`, `ms`, `mx` or `ct`
- writes `show1.fseq`, `show1.wav` (44.1 kHz) and `show1.xsq` for xLights

Doors (including Falcon Wing) are never commanded: on Model X, moving windows while the doors move can trigger pinch protection and stop the show.

## USB drive

Tesla reads shows from a `LightShow` folder at the root of an exFAT or FAT32 drive. The drive must **not** have a `TeslaCam` folder; Studio warns you if it finds one, but never deletes anything.

## Check

```sh
python test_studio.py
```

Your shows live in `shows/` (ignored by git).
