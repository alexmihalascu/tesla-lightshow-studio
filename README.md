# Light Show Studio

Studio local pentru Tesla Light Show: transformă o melodie într-un show, îl previzualizează pe mașina ta (2D și 3D, cu modelele oficiale Tesla) și îl copiază pe stick.

- **Generator**: analizează melodia (tempo, beat-uri, bas, refrene) și scrie un `.fseq` v2 necomprimat, validat după limitele oficiale Tesla.
- **Emulator pe model**: Model 3, Model 3 (până în oct. 2020), Model Y, Model S, Model X și Cybertruck, plus regiunea (Europa sau America de Nord) și tipul de faruri. Aplică regulile din documentația oficială: canalele 4–6 combinate pe 3/Y, lumini de poziție combinate, remaparea Cybertruck, ce închideri are fiecare model.
- **Player**: vederi 2D (lateral, față, spate), 3D cu modelele oficiale (piesele Model S se mișcă: portbagaj, oglinzi, geamuri, trapă, uși Falcon emulate) sau ambele. Include timeline-ul show-ului și unghiuri de cameră.
- **Proiecte**: biblioteca de pe calculator și de pe stick, cu amprenta de activitate a fiecărui show.
- **Documentație**: harta canalelor, ramp-uri, închideri și particularitățile fiecărui model, pe `/docs.html`.

## Pornire

Cerințe: Python 3.10+, [ffmpeg](https://ffmpeg.org/) în PATH.

```sh
pip install -r requirements.txt
python studio.py
```

Se deschide `http://127.0.0.1:8642`. Serverul ascultă doar local.

### Modelele 3D oficiale

Vederea 3D folosește proiectul oficial Tesla pentru xLights, care **nu** e inclus în acest repo. Descarcă [teslamotors/light-show](https://github.com/teslamotors/light-show), dezarhivează `xlights/tesla_xlights_show_folder.zip` și pune folderul `tesla_xlights_show_folder` într-unul dintre aceste locuri:

- lângă `studio.py`
- în `~/Downloads`
- oriunde, cu variabila de mediu `TESLA_XLIGHTS_DIR`

Tesla oferă oficial doar Model S și Cybertruck în 3D.

### Modele 3D proprii (Model 3, Y, Y Juniper, X)

Pune fișiere `.glb` (de exemplu de pe Sketchfab, cu licență Creative Commons) în folderul `models/`, care nu intră în git:

| Fișier | Folosit pentru |
|---|---|
| `models/model3.glb` | Model 3 |
| `models/modely.glb` | Model Y (2020–2024) |
| `models/modely-juniper.glb` | Model Y Juniper (2025+) |
| `models/modelx.glb` | Model X |

Studio orientează și scalează automat modelul, găsește lămpile după numele materialelor (sau le împarte pe față/spate și stânga/dreapta), decupează oglinzile și le pliază, iar unde modelul nu are piese separate (geamuri, portbagaj) folosește indicatori. Numele autorului și licența din fișier apar în vederea 3D, cum cer licențele CC-BY.

## Generator din linia de comandă

```sh
python generator/make_show.py melodie.mp3 --max --model m3 --out LightShow --name show1
```

- `--max`: geamuri care dansează, plus portbagaj (Y, S, X, Cybertruck) și mânere (S)
- `--model`: `m3`, `my`, `ms`, `mx` sau `ct`
- scrie `show1.fseq`, `show1.wav` (44,1 kHz) și `show1.xsq` pentru xLights

Ușile (inclusiv Falcon) nu sunt comandate niciodată: pe Model X, mișcarea geamurilor în timpul mișcării ușilor poate declanșa protecția anti-prindere.

## Stickul USB

Tesla citește show-urile din folderul `LightShow` din rădăcina unui stick exFAT sau FAT32. Stickul **nu** trebuie să conțină folderul `TeslaCam`; Studio te avertizează dacă îl găsește, dar nu șterge nimic.

## Verificare

```sh
python test_studio.py
```

Show-urile tale stau în `shows/` (ignorat de git).
