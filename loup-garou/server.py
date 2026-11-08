#!/usr/bin/env python3
"""
Pad Loup-Garou : serveur local qui pilote les ampoules LSC Smart Connect (Action).

Les ampoules LSC Smart Connect sont des ampoules Tuya : on les pilote directement
sur le Wi-Fi de la maison avec la bibliothèque `tinytuya`, sans passer par l'appli.

Lancement :
    pip install tinytuya
    python server.py            -> ouvre http://<ip-du-pc>:8000 sur ton téléphone

Sans fichier devices.json, le serveur tourne en mode SIMULATION (aucune ampoule,
les commandes s'affichent dans la console) : pratique pour tester les sons.
"""

import colorsys
import json
import math
import os
import random
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ICI = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))

# Catégories Tuya correspondant à des lampes / ampoules / rubans LED
CATEGORIES_LUMIERE = {"dj", "dd", "xdd", "fwd", "dc", "fsd", "tyndj", "tgq", "tgkg"}

# Fichiers que le serveur accepte d'envoyer au navigateur (jamais devices.json !)
FICHIERS_AUTORISES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/sons.js": ("sons.js", "application/javascript; charset=utf-8"),
    "/scenes.json": ("scenes.json", "application/json; charset=utf-8"),
}
TYPES_AUDIO = {".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4"}


def charger_json(nom, defaut=None):
    chemin = os.path.join(ICI, nom)
    if not os.path.exists(chemin):
        return defaut
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


CONFIG = {
    # Délai minimum entre deux commandes envoyées à une même ampoule pendant un effet.
    # Augmente-le (0.4, 0.5…) si les ampoules saccadent ou décrochent.
    "intervalle_effets": 0.25,
    # Liste de noms d'ampoules à utiliser (vide = toutes les lumières de devices.json)
    "ampoules": [],
}
CONFIG.update(charger_json("config.json", {}) or {})


# --------------------------------------------------------------------------- #
#  Ampoules                                                                   #
# --------------------------------------------------------------------------- #

class AmpouleSimulee:
    """Remplace une vraie ampoule : affiche les commandes au lieu de les envoyer."""

    def __init__(self, nom):
        self.nom = nom
        self._dernier = 0

    def _log(self, txt):
        now = time.time()
        if now - self._dernier > 1.0:  # évite d'inonder la console pendant les effets
            print(f"  [simu] {self.nom}: {txt}")
            self._dernier = now

    def couleur(self, rgb, lum):
        self._log(f"couleur {rgb} {round(lum)}%")

    def blanc(self, lum, temp):
        self._log(f"blanc {round(lum)}% temp {temp}")

    def eteindre(self):
        self._log("éteinte")


class AmpouleTuya:
    """Vraie ampoule LSC / Tuya pilotée en local avec tinytuya."""

    def __init__(self, info):
        import tinytuya

        self.nom = info.get("name") or info["id"]
        ip = info.get("ip") or "Auto"
        version = float(info.get("version") or 3.3)
        self.dev = tinytuya.BulbDevice(info["id"], ip, info["key"], version=version,
                                       connection_timeout=3, connection_retry_limit=2,
                                       connection_retry_delay=1)
        self.dev.set_socketPersistent(True)
        self.dev.status()  # détecte le type d'ampoule (DP 1-5 ou 20-24)
        self.ok = True

    def _essayer(self, fn, *args):
        try:
            fn(*args)
            self.ok = True
        except Exception as e:  # une ampoule qui décroche ne doit pas tout bloquer
            self.ok = False
            print(f"  ! {self.nom}: {e}")

    def couleur(self, rgb, lum):
        r, g, b = [max(0, min(255, c)) / 255.0 for c in rgb]
        h, s, _ = colorsys.rgb_to_hsv(r, g, b)
        v = max(0.01, min(1.0, lum / 100.0))
        self._essayer(self.dev.set_hsv, h, s, v, True)

    def blanc(self, lum, temp):
        lum = max(1, min(100, lum))
        self._essayer(self.dev.set_white_percentage, lum, max(0, min(100, temp)), True)

    def eteindre(self):
        self._essayer(self.dev.turn_off, 0, True)


def charger_ampoules():
    devices = charger_json("devices.json")
    if not devices:
        print("⚠️  Pas de devices.json -> MODE SIMULATION (aucune ampoule pilotée).")
        print("    Lis le README pour récupérer les clés de tes ampoules LSC.")
        return [AmpouleSimulee("ampoule-demo-1"), AmpouleSimulee("ampoule-demo-2")], True

    # snapshot.json (python -m tinytuya scan) contient les adresses IP trouvées
    ips = {}
    snap = charger_json("snapshot.json", {}) or {}
    for d in snap.get("devices", []):
        if d.get("id") and d.get("ip"):
            ips[d["id"]] = (d["ip"], d.get("ver") or d.get("version"))

    choix = [n.lower() for n in CONFIG.get("ampoules") or []]
    ampoules = []
    for info in devices:
        if not info.get("key"):
            continue
        nom = (info.get("name") or "").lower()
        if choix:
            if nom not in choix:
                continue
        elif info.get("category") and info["category"] not in CATEGORIES_LUMIERE:
            continue
        if info["id"] in ips:
            info.setdefault("ip", ips[info["id"]][0])
            if ips[info["id"]][1]:
                info["version"] = ips[info["id"]][1]
        try:
            print(f"🔌 Connexion à « {info.get('name')} » ({info.get('ip') or 'recherche auto'})…")
            ampoules.append(AmpouleTuya(info))
            print("   ✅ OK")
        except Exception as e:
            print(f"   ❌ Impossible de joindre cette ampoule : {e}")

    if not ampoules:
        print("⚠️  Aucune ampoule joignable -> MODE SIMULATION.")
        return [AmpouleSimulee("ampoule-demo")], True
    return ampoules, False


# --------------------------------------------------------------------------- #
#  Effets lumineux : un fil d'exécution par ampoule                           #
# --------------------------------------------------------------------------- #

class Programme:
    """Ce que doit jouer une ampoule : la scène + l'heure de départ partagée."""

    def __init__(self, spec, depart, graine):
        self.spec = spec
        self.depart = depart
        self.graine = graine


class Pilote(threading.Thread):
    def __init__(self, ampoule, index):
        super().__init__(daemon=True)
        self.ampoule = ampoule
        self.index = index
        self.programme = None
        self.changement = threading.Event()

    def jouer(self, programme):
        self.programme = programme
        self.changement.set()

    # -- utilitaires --
    def attendre(self, duree):
        """Dort `duree` secondes. Renvoie True si une nouvelle scène est arrivée."""
        return self.changement.wait(max(0.0, duree))

    def lum(self, valeur):
        return max(1, min(100, valeur * ETAT["luminosite"] / 100.0))

    def appliquer(self, etape):
        if etape == "eteint" or etape.get("eteint"):
            self.ampoule.eteindre()
        elif etape.get("blanc"):
            self.ampoule.blanc(self.lum(etape.get("lum", 100)), etape.get("temp", 50))
        else:
            self.ampoule.couleur(etape["couleur"], self.lum(etape.get("lum", 100)))

    def run(self):
        while True:
            self.changement.wait()
            self.changement.clear()
            prog = self.programme
            if prog is None:
                continue
            try:
                self.executer(prog)
            except Exception as e:
                print(f"  ! effet interrompu sur {self.ampoule.nom}: {e}")

    # -- moteur d'effets --
    def executer(self, prog):
        spec = prog.spec
        pas = float(CONFIG["intervalle_effets"])

        # Séquence d'intro (flashs, noir…) jouée en même temps sur toutes les ampoules
        t = prog.depart
        for etape in spec.get("intro", []):
            self.appliquer(etape)
            t += etape.get("duree", 0.2)
            if self.attendre(t - time.time()):
                return

        mode = spec.get("mode", "static")
        debut = time.time()

        if mode == "off":
            self.ampoule.eteindre()
            return
        if mode == "static":
            self.appliquer({"couleur": spec["couleur"], "lum": spec.get("lum", 100)})
            return
        if mode == "white":
            self.appliquer({"blanc": True, "lum": spec.get("lum", 100), "temp": spec.get("temp", 50)})
            return

        if mode == "fade":
            etapes = spec["etapes"]
            duree = float(spec.get("duree", 5))
            while True:
                x = min(1.0, (time.time() - debut) / duree) * (len(etapes) - 1)
                i = min(int(x), len(etapes) - 2)
                a, b, f = etapes[i], etapes[i + 1], x - i
                if b.get("blanc") and f > 0.5:
                    self.appliquer(b)
                else:
                    ca = a.get("couleur", [255, 200, 150])
                    cb = b.get("couleur", [255, 200, 150])
                    coul = [round(ca[k] + (cb[k] - ca[k]) * f) for k in range(3)]
                    lum = a.get("lum", 100) + (b.get("lum", 100) - a.get("lum", 100)) * f
                    self.ampoule.couleur(coul, self.lum(lum))
                if x >= len(etapes) - 1:
                    self.appliquer(etapes[-1])
                    return
                if self.attendre(pas * 1.6):
                    return

        if mode == "pulse":
            c1 = spec["couleur"]
            c2 = spec.get("couleur2", c1)
            bas, haut = spec.get("min", 10), spec.get("max", 100)
            periode = float(spec.get("periode", 2))
            while True:
                phase = ((time.time() - prog.depart) % periode) / periode
                onde = (1 - math.cos(2 * math.pi * phase)) / 2  # 0 -> 1 -> 0
                coul = [round(c2[k] + (c1[k] - c2[k]) * onde) for k in range(3)]
                self.ampoule.couleur(coul, self.lum(bas + (haut - bas) * onde))
                if self.attendre(pas):
                    return

        if mode == "flicker":  # feu / chaudron : chaque ampoule vacille différemment
            hasard = random.Random(prog.graine + self.index * 7919)
            c1 = spec["couleur"]
            c2 = spec.get("couleur2", c1)
            bas, haut = spec.get("min", 20), spec.get("max", 100)
            while True:
                f = hasard.random() ** 2
                coul = [round(c1[k] + (c2[k] - c1[k]) * f) for k in range(3)]
                self.ampoule.couleur(coul, self.lum(hasard.uniform(bas, haut)))
                if self.attendre(pas + hasard.uniform(0, pas * 1.5)):
                    return

        if mode == "cycle":
            couleurs = spec["couleurs"]
            periode = max(pas, float(spec.get("periode", 1)))
            lum = spec.get("lum", 100)
            n = -1
            while True:
                i = int((time.time() - prog.depart) / periode) % len(couleurs)
                if i != n:
                    n = i
                    c = couleurs[i]
                    self.appliquer("eteint" if c == "eteint" else {"couleur": c, "lum": lum})
                prochain = periode - ((time.time() - prog.depart) % periode)
                if self.attendre(prochain + 0.01):
                    return

        if mode == "lightning":  # même graine pour toutes les ampoules = éclairs synchronisés
            hasard = random.Random(prog.graine)
            fond = {"couleur": spec.get("couleur", [0, 20, 90]), "lum": spec.get("lum", 10)}
            self.appliquer(fond)
            t = time.time()
            while True:
                t += hasard.uniform(4, 11)
                if self.attendre(t - time.time()):
                    return
                for _ in range(hasard.randint(1, 3)):
                    self.appliquer({"blanc": True, "lum": 100, "temp": 100})
                    if self.attendre(0.12):
                        return
                    self.appliquer(fond)
                    if self.attendre(hasard.uniform(0.08, 0.3)):
                        return
                t = time.time()


ETAT = {"scene": None, "luminosite": 100, "derniere_spec": None}
AMPOULES, SIMULATION = charger_ampoules()
PILOTES = [Pilote(a, i) for i, a in enumerate(AMPOULES)]
for p in PILOTES:
    p.start()

def scenes():
    return {s["id"]: s for s in charger_json("scenes.json", {"scenes": []})["scenes"]}


def lancer_spec(spec):
    ETAT["derniere_spec"] = spec
    prog = Programme(spec, time.time() + 0.05, random.randrange(1 << 30))
    for p in PILOTES:
        p.jouer(prog)


def lancer_scene(scene_id):
    scene = scenes().get(scene_id)
    if not scene:
        return False
    ETAT["scene"] = scene_id
    print(f"🎬 Scène : {scene.get('emoji', '')} {scene['nom']}")
    lancer_spec(scene.get("lumiere", {"mode": "off"}))
    return True


# --------------------------------------------------------------------------- #
#  Serveur web                                                                #
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def envoyer(self, code, corps, type_="application/json; charset=utf-8"):
        if isinstance(corps, (dict, list)):
            corps = json.dumps(corps, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corps)

    def etat(self):
        return {
            "simulation": SIMULATION,
            "scene": ETAT["scene"],
            "luminosite": ETAT["luminosite"],
            "ampoules": [{"nom": a.nom, "ok": getattr(a, "ok", True)} for a in AMPOULES],
        }

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        chemin = self.path.split("?")[0]
        if chemin == "/api/etat":
            return self.envoyer(200, self.etat())
        if chemin == "/api/sons":  # mp3 perso présents dans sounds/
            dossier = os.path.join(ICI, "sounds")
            noms = sorted(f for f in os.listdir(dossier) if os.path.splitext(f)[1].lower() in TYPES_AUDIO) \
                if os.path.isdir(dossier) else []
            return self.envoyer(200, ["sounds/" + f for f in noms])
        if chemin in FICHIERS_AUTORISES:
            nom, type_ = FICHIERS_AUTORISES[chemin]
            with open(os.path.join(ICI, nom), "rb") as f:
                return self.envoyer(200, f.read(), type_)
        if chemin.startswith("/sounds/"):
            nom = os.path.basename(chemin)
            ext = os.path.splitext(nom)[1].lower()
            fichier = os.path.join(ICI, "sounds", nom)
            if ext in TYPES_AUDIO and os.path.isfile(fichier):
                with open(fichier, "rb") as f:
                    return self.envoyer(200, f.read(), TYPES_AUDIO[ext])
        self.envoyer(404, {"erreur": "introuvable"})

    def do_POST(self):
        chemin = self.path.split("?")[0]
        longueur = int(self.headers.get("Content-Length") or 0)
        try:
            donnees = json.loads(self.rfile.read(longueur) or b"{}")
        except ValueError:
            donnees = {}

        if chemin.startswith("/api/scene/"):
            ok = lancer_scene(chemin.rsplit("/", 1)[1])
            return self.envoyer(200 if ok else 404, self.etat())
        if chemin == "/api/luminosite":
            ETAT["luminosite"] = max(5, min(100, int(donnees.get("valeur", 100))))
            if ETAT["derniere_spec"]:
                lancer_spec(ETAT["derniere_spec"])
            return self.envoyer(200, self.etat())
        if chemin == "/api/couleur":  # bouton couleur libre
            lancer_spec({"mode": "static", "couleur": donnees.get("couleur", [255, 255, 255]),
                         "lum": donnees.get("lum", 100)})
            ETAT["scene"] = None
            return self.envoyer(200, self.etat())
        self.envoyer(404, {"erreur": "introuvable"})


def ip_locale():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    serveur = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print()
    print("🐺  Pad Loup-Garou prêt !")
    print(f"    Sur ce PC        : http://localhost:{PORT}")
    print(f"    Sur le téléphone : http://{ip_locale()}:{PORT}   (même Wi-Fi)")
    print(f"    Ampoules         : {len(AMPOULES)} {'(SIMULATION)' if SIMULATION else ''}")
    print("    Ctrl+C pour arrêter.")
    print()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nAu revoir 🌙")
        sys.exit(0)
