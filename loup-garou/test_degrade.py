#!/usr/bin/env python3
"""
Test des dégradés intégrés aux ampoules (aucune modification du pad).

L'ampoule reçoit UNE seule commande « scène » et fait elle-même le dégradé, sans
aucun autre ordre : c'est ce qui permet des transitions parfaitement fluides.

    python3 test_degrade.py            -> teste sur la lampe TV droite
    python3 test_degrade.py tv_g       -> sur une autre place (tv_g, tv_d, canape_g, canape_d, cuisine)

Arrête le pad avant de lancer ce test (une ampoule n'accepte qu'une connexion).
"""
import json
import os
import sys
import time

import tinytuya

ICI = os.path.dirname(os.path.abspath(__file__))
place = sys.argv[1] if len(sys.argv) > 1 else "tv_d"


def charger(nom, defaut):
    try:
        with open(os.path.join(ICI, nom), encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return defaut


norm = lambda n: " ".join((n or "").lower().split())
positions = {norm(k): v for k, v in charger("positions.json", {}).items() if not k.startswith("_")}
ips = {d.get("id"): (d.get("ip"), d.get("ver") or d.get("version")) for d in charger("snapshot.json", {}).get("devices", [])}
lampe = next((d for d in charger("devices.json", []) if positions.get(norm(d.get("name"))) == place), None)
if not lampe:
    sys.exit(f"Aucune ampoule à la place « {place} » (voir positions.json).")

ip, ver = ips.get(lampe["id"], (None, None))
print(f"Lampe testée : {lampe['name']} ({place}, {ip or 'recherche auto'})")
b = tinytuya.BulbDevice(lampe["id"], ip or "Auto", lampe["key"], version=float(ver or lampe.get("version") or 3.5))
b.set_socketPersistent(True)
b.status()
ds = b.dpset
if not ds.get("scene"):
    sys.exit("Cette ampoule n'annonce pas de mode « scène » : dégradés intégrés impossibles.")
print(f"Réglages détectés : interrupteur={ds['switch']} mode={ds['mode']} scène={ds['scene']}")


def unite(teinte, saturation, valeur, vitesse):
    # intervalle, durée du changement, mode 02 = dégradé, puis teinte / saturation / luminosité (0-1000)
    return f"{vitesse:02x}{vitesse:02x}02{teinte:04x}{saturation:04x}{valeur:04x}00000000"


def scene(unites, numero=5):
    return f"{numero:02x}" + "".join(unites)


TESTS = [
    ("1/4  Respiration violette LENTE", scene([unite(270, 1000, 1000, 0x14), unite(270, 1000, 150, 0x14)])),
    ("2/4  Respiration violette MOYENNE", scene([unite(270, 1000, 1000, 0x32), unite(270, 1000, 150, 0x32)])),
    ("3/4  Respiration violette RAPIDE", scene([unite(270, 1000, 1000, 0x50), unite(270, 1000, 150, 0x50)])),
    ("4/4  Fondu ROUGE <-> ORANGE", scene([unite(0, 1000, 1000, 0x32), unite(30, 1000, 1000, 0x32)])),
]

for titre, donnees in TESTS:
    print(f"\n>>> {titre}  (regarde la lampe pendant 15 s)")
    r = b.set_multiple_values({ds["switch"]: True, ds["mode"]: "scene", ds["scene"]: donnees})
    if isinstance(r, dict) and r.get("Error"):
        print(f"   ! refusé par l'ampoule : {r.get('Error')}")
    time.sleep(15)

print("\nFin du test : retour en blanc.")
b.set_white_percentage(60, 40)
