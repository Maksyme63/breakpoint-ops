#!/usr/bin/env python3
"""
Diagnostic d'une lumière Tuya / LSC (n'affiche jamais la clé secrète).

    python3 diagnostic.py ledstrip      -> les appareils dont le nom contient « ledstrip »
    python3 diagnostic.py               -> tous les appareils
"""
import json
import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
filtre = (sys.argv[1] if len(sys.argv) > 1 else "").lower()

with open(os.path.join(ICI, "devices.json"), encoding="utf-8") as f:
    devices = json.load(f)
ips = {}
try:
    with open(os.path.join(ICI, "snapshot.json"), encoding="utf-8") as f:
        for d in json.load(f).get("devices", []):
            ips[d.get("id")] = (d.get("ip"), d.get("ver") or d.get("version"))
except OSError:
    pass

import tinytuya

for info in devices:
    nom = info.get("name") or info.get("id")
    if filtre and filtre not in nom.lower():
        continue
    ip, ver = ips.get(info["id"], (info.get("ip"), info.get("version")))
    print("=" * 70)
    print(f"{nom}")
    print(f"  catégorie : {info.get('category')}   produit : {info.get('product_name')}")
    print(f"  ip : {ip}   version : {ver or info.get('version')}")
    print("  fonctions déclarées dans le cloud :")
    for dp, v in sorted((info.get("mapping") or {}).items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 999):
        if isinstance(v, dict):
            valeurs = json.dumps(v.get("values"), ensure_ascii=False)
            if len(valeurs) > 90:
                valeurs = valeurs[:90] + "…"
            print(f"    DP {dp:>3}  {v.get('code', ''):<28} {v.get('type', ''):<8} {valeurs}")
    if not ip:
        print("  (pas d'adresse IP : relance python3 -m tinytuya scan)")
        continue
    try:
        d = tinytuya.BulbDevice(info["id"], ip, info["key"], version=float(ver or info.get("version") or 3.3),
                                connection_timeout=3)
        st = d.status()
        print(f"  état actuel : {json.dumps(st, ensure_ascii=False)[:600]}")
        print(f"  type détecté : {d.bulb_type}   réglages : {d.dpset}")
    except Exception as e:
        print(f"  erreur de connexion : {e}")
