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
TYPES_AUDIO = {".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
               ".aac": "audio/aac", ".flac": "audio/flac"}


def charger_json(nom, defaut=None):
    chemin = os.path.join(ICI, nom)
    if not os.path.exists(chemin):
        return defaut
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


CONFIG = {
    # Délai minimum entre deux commandes envoyées à une même ampoule pendant un effet.
    # Augmente-le (0.4, 0.5…) si les ampoules saccadent ou décrochent.
    "intervalle_effets": 0.4,
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

    def couleur(self, rgb, lum, rapide=False):
        self._log(f"couleur {rgb} {round(lum)}%")

    def blanc(self, lum, temp):
        self._log(f"blanc {round(lum)}% temp {temp}")

    def eteindre(self):
        self._log("éteinte")

    def instantane(self, etape):
        self._dernier = 0
        self._log(f"éclair {etape}")


class AmpouleTuya:
    """Vraie ampoule LSC / Tuya pilotée en local avec tinytuya.

    Les ampoules Tuya saturent si on les bombarde de commandes sans lire leurs
    réponses : elles coupent alors la connexion et n'obéissent plus. Ici chaque
    commande attend la réponse de l'ampoule, les envois sont espacés, les
    commandes identiques ne sont pas renvoyées, et en cas de coupure on se
    reconnecte automatiquement.
    """

    def __init__(self, info):
        import tinytuya

        self.tinytuya = tinytuya
        self.info = info
        self.nom = info.get("name") or info["id"]
        self.verrou = threading.Lock()
        self.dernier_envoi = 0.0
        self.derniere_cmd = None
        self.echecs = 0
        self.prochain_essai = 0.0
        self.ok = False
        self.dev = None
        self.raison = None
        try:
            self._connecter(patient=True)
        except Exception as e:
            self.ok = False
            self.raison = str(e)
        if not self.ok:
            self.echecs = 1  # on réessaiera pendant la partie

    def _connecter(self, patient=False):
        info = self.info
        try:
            if self.dev:
                self.dev.close()
        except Exception:
            pass
        self.dev = self.tinytuya.BulbDevice(
            info["id"], info.get("ip") or "Auto", info["key"],
            version=float(info.get("version") or 3.3),
            # au démarrage on est patient ; pendant la partie, une ampoule lente ne doit pas tout ralentir
            connection_timeout=4 if patient else 1.5, connection_retry_limit=2 if patient else 1,
            connection_retry_delay=1 if patient else 0.3)
        self.dev.set_socketPersistent(True)
        r = self.dev.status()  # détecte le type d'ampoule (DP 1-5 ou 20-24)
        # Certaines ampoules répondent à vide : seule une vraie erreur compte
        self.raison = r.get("Error") if isinstance(r, dict) else None
        self.ok = not self.raison
        self.derniere_cmd = None
        try:
            self.dev.set_socketTimeout(1.5)
            self.dev.set_socketRetryLimit(1)
        except Exception:
            pass
        if self.ok:
            self._configurer_selon_cloud()
        return self.ok

    def _configurer_selon_cloud(self):
        """Rubans LED (RGBIC…) : la détection automatique échoue souvent.
        On utilise alors la liste des fonctions fournie par le cloud Tuya
        (champ "mapping" de devices.json) pour savoir quel numéro pilote quoi."""
        d = self.dev
        if d.bulb_configured and d.bulb_type not in (None, "None") and d.dpset.get("colour"):
            return  # ampoule classique bien reconnue
        codes, valeurs = {}, {}
        for dp, v in (self.info.get("mapping") or {}).items():
            if isinstance(v, dict) and v.get("code"):
                codes[v["code"]] = str(dp)
                val = v.get("values")
                if isinstance(val, str):
                    try:
                        val = json.loads(val)
                    except ValueError:
                        val = {}
                valeurs[v["code"]] = val if isinstance(val, dict) else {}

        def choisir(*noms):
            return next((codes[n] for n in noms if n in codes), None)

        caps = {
            "switch": choisir("switch_led", "switch_led_1", "led_switch", "switch"),
            "mode": choisir("work_mode"),
            "brightness": choisir("bright_value_v2", "bright_value", "bright_value_1"),
            "colourtemp": choisir("temp_value_v2", "temp_value"),
            "colour": choisir("colour_data_v2", "colour_data"),
        }
        if not caps["switch"] or not (caps["colour"] or caps["brightness"]):
            return
        # Échelle : 0-1000 (format récent « hsv16 ») ou 0-255 (ancien format)
        nom_lum = next((n for n in ("bright_value_v2", "bright_value", "bright_value_1") if n in codes), None)
        nom_coul = next((n for n in ("colour_data_v2", "colour_data") if n in codes), None)
        lum = valeurs.get(nom_lum, {}) if nom_lum else {}
        sat = (valeurs.get(nom_coul, {}) or {}).get("s", {}) if nom_coul else {}
        maxi = int(lum.get("max") or (1000 if "_v2" in (nom_lum or "") else 255))
        grand = maxi >= 1000 or int((sat or {}).get("max") or 0) >= 1000 or "_v2" in (nom_coul or "")
        caps.update({"value_min": int(lum.get("min") or (10 if grand else 25)), "value_max": maxi,
                     "value_hexformat": "hsv16" if grand else "rgb8"})
        if d.bulb_type in (None, "None"):
            d.bulb_type = "B" if caps["switch"] == "20" else "A"
        d.set_bulb_capabilities(caps)
        d.bulb_configured = True
        print(f"   ℹ️  {self.nom} : réglages lus depuis le cloud Tuya ({', '.join(f'{k}={v}' for k, v in caps.items() if not k.startswith('value'))})")


    def _envoyer(self, cle, fn, *args, rapide=False):
        with self.verrou:
            now = time.time()
            # Inutile de renvoyer la même chose (sauf toutes les 20 s pour garder la connexion)
            if cle == self.derniere_cmd and now - self.dernier_envoi < 20:
                return
            ecart = 0.08 if rapide else float(CONFIG["intervalle_effets"])
            attente = ecart - (now - self.dernier_envoi)
            if attente > 0:
                time.sleep(attente)
            try:
                if not self.ok and time.time() < self.prochain_essai:
                    return  # ampoule injoignable : on réessaie un peu plus tard
                if not self.ok and not self._connecter():
                    raise RuntimeError(self.raison or "toujours injoignable")
                r = fn(*args)  # attend la réponse de l'ampoule
                if isinstance(r, dict) and r.get("Error"):
                    raise RuntimeError(r.get("Error"))
                if not self.ok or self.echecs:
                    print(f"  ✅ {self.nom} répond de nouveau")
                self.ok = True
                self.echecs = 0
                self.derniere_cmd = cle
            except Exception as e:
                self.echecs += 1
                if self.ok or self.echecs in (1, 5, 20):
                    print(f"  ! {self.nom} ne répond pas ({e}) -> nouvel essai automatique")
                self.ok = False
                self.derniere_cmd = None
                self.prochain_essai = time.time() + min(5, 1 + self.echecs)
                try:
                    self.dev.close()
                except Exception:
                    pass
            finally:
                self.dernier_envoi = time.time()

    def couleur(self, rgb, lum, rapide=False):
        r, g, b = [max(0, min(255, c)) / 255.0 for c in rgb]
        h, s, _ = colorsys.rgb_to_hsv(r, g, b)
        h, s = round(h, 3), round(s, 2)
        v = round(max(0.01, min(1.0, lum / 100.0)), 2)
        self._envoyer(("c", h, s, v), self.dev_appel("set_hsv"), h, s, v, rapide=rapide)

    def blanc(self, lum, temp):
        lum = round(max(1, min(100, lum)))
        temp = round(max(0, min(100, temp)))
        self._envoyer(("b", lum, temp), self.dev_appel("set_white_percentage"), lum, temp)

    def eteindre(self):
        self._envoyer(("off",), self.dev_appel("turn_off"))

    def instantane(self, etape):
        """Commande éclair : envoyée tout de suite, sans attendre la réponse (flashs d'orage)."""
        if not self.ok:
            return
        with self.verrou:
            try:
                if etape == "eteint" or etape.get("eteint"):
                    self.dev.turn_off(0, True)
                elif etape.get("blanc"):
                    self.dev.set_white_percentage(round(max(1, min(100, etape.get("lum", 100)))), etape.get("temp", 100), True)
                else:
                    r, g, b = [max(0, min(255, c)) / 255.0 for c in etape["couleur"]]
                    h, sa, _ = colorsys.rgb_to_hsv(r, g, b)
                    self.dev.set_hsv(h, sa, max(0.01, min(1.0, etape.get("lum", 100) / 100.0)), True)
            except Exception:
                pass
            self.derniere_cmd = None
            self.dernier_envoi = time.time()

    def dev_appel(self, nom):
        # self.dev peut être recréé lors d'une reconnexion : on le relit au moment de l'appel
        return lambda *a: getattr(self.dev, nom)(*a)


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
            a = AmpouleTuya(info)
            ampoules.append(a)
            print("   ✅ OK" if a.ok else f"   ⚠️  Pas de réponse pour l'instant ({a.raison}) : nouvel essai pendant la partie")
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
        self.actuel = None  # dernière couleur envoyée, pour les transitions douces
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
            self.actuel = None
        elif etape.get("blanc"):
            self.ampoule.blanc(self.lum(etape.get("lum", 100)), etape.get("temp", 50))
            self.actuel = None
        else:
            self.ampoule.couleur(etape["couleur"], self.lum(etape.get("lum", 100)))
            self.actuel = (list(etape["couleur"]), etape.get("lum", 100))

    def fondu_depuis_actuel(self, cible, prog, duree=1.6):
        """Transition douce depuis la couleur actuelle. Renvoie True si interrompue."""
        if not getattr(self, "actuel", None):
            return False
        (c0, l0), c1, l1 = self.actuel, cible["couleur"], cible.get("lum", 100)
        debut, pas = time.time(), float(CONFIG["intervalle_effets"])
        while True:
            f = min(1.0, (time.time() - debut) / duree)
            coul = [round(c0[k] + (c1[k] - c0[k]) * f) for k in range(3)]
            self.ampoule.couleur(coul, self.lum(l0 + (l1 - l0) * f))
            if f >= 1.0:
                self.actuel = (list(c1), l1)
                return False
            if self.attendre(pas):
                return True

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
        if mode == "eclair":
            # chaque ampoule part avec un petit décalage : l'éclair semble traverser la pièce
            hasard = random.Random(prog.graine + self.index * 104729)
            if hasard.random() > spec.get("proba", 0.85) and self.index != 0:
                pass  # cette lampe reste dans l'ombre pour cet éclair
            else:
                if self.attendre(hasard.uniform(0, 0.18)):
                    return
                for etape in spec["motif"]:
                    self.ampoule.instantane(etape)
                    if self.attendre(etape.get("duree", 0.08)):
                        return
            self.actuel = None
            retour = spec.get("retour")
            if retour:
                self.executer(Programme(retour, time.time(), prog.graine))
            return
        if mode == "static":
            # un seul changement net : les ampoules font elles-mêmes une transition douce
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
                if self.attendre(max(1.0, pas * 2.5)):
                    return

        if mode == "battement":
            # battement de cœur : flashs très courts sur une lumière sombre, synchronisés entre les lampes
            c = spec["couleur"]
            base, flash = spec.get("lum_base", 10), spec.get("lum_flash", 100)
            periode = float(spec.get("periode", 1.1))
            self.ampoule.couleur(c, self.lum(base), rapide=True)
            k = int((time.time() - prog.depart) / periode) + 1
            while True:
                if self.attendre(prog.depart + k * periode - time.time()):
                    return
                self.ampoule.couleur(c, self.lum(flash), rapide=True)
                self.ampoule.couleur(c, self.lum(base), rapide=True)
                if spec.get("double"):
                    if self.attendre(0.12):
                        return
                    self.ampoule.couleur(c, self.lum(flash * 0.6), rapide=True)
                    self.ampoule.couleur(c, self.lum(base), rapide=True)
                k = max(k + 1, int((time.time() - prog.depart) / periode) + 1)

        if mode == "pulse":
            c1 = spec["couleur"]
            c2 = spec.get("couleur2", c1)
            bas, haut = spec.get("min", 10), spec.get("max", 100)
            periode = float(spec.get("periode", 2))
            while True:
                decalage = float(spec.get("decalage", 0)) * self.index  # vague d'une lampe à l'autre
                phase = (((time.time() - prog.depart) / periode) + decalage) % 1.0
                onde = (1 - math.cos(2 * math.pi * phase)) / 2  # 0 -> 1 -> 0
                coul = [round(c2[k] + (c1[k] - c2[k]) * onde) for k in range(3)]
                self.ampoule.couleur(coul, self.lum(bas + (haut - bas) * onde))
                self.actuel = (coul, bas + (haut - bas) * onde)
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
                lenteur = float(spec.get("lenteur", 1))
                if self.attendre(pas * lenteur + hasard.uniform(0, pas * 1.5 * lenteur)):
                    return

        if mode == "cycle":
            couleurs = spec["couleurs"]
            periode = max(pas, float(spec.get("periode", 1)))
            lum = spec.get("lum", 100)
            n = -1
            while True:
                i = (int((time.time() - prog.depart) / periode) + int(spec.get("decalage", 0)) * self.index) % len(couleurs)
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
    donnees = charger_json("scenes.json", {"scenes": []})
    return {s["id"]: s for s in donnees.get("roles", []) + donnees["scenes"]}


def lancer_spec(spec):
    ETAT["derniere_spec"] = spec
    prog = Programme(spec, time.time() + 0.05, random.randrange(1 << 30))
    for p in PILOTES:
        p.jouer(prog)


MOTIFS_ECLAIR = [
    # double flash classique
    [{"blanc": True, "lum": 100, "duree": 0.07}, {"eteint": True, "duree": 0.09}, {"blanc": True, "lum": 100, "duree": 0.18}],
    # long éclair aveuglant
    [{"blanc": True, "lum": 100, "duree": 0.35}],
    # éclair qui crépite
    [{"blanc": True, "lum": 60, "duree": 0.05}, {"eteint": True, "duree": 0.06}, {"blanc": True, "lum": 100, "duree": 0.06},
     {"eteint": True, "duree": 0.12}, {"blanc": True, "lum": 80, "duree": 0.15}],
    # éclair lointain bleuté
    [{"couleur": [150, 170, 255], "lum": 70, "duree": 0.12}, {"eteint": True, "duree": 0.1}, {"couleur": [190, 200, 255], "lum": 50, "duree": 0.1}],
]


def eclair():
    """Éclair déclenché par le tonnerre de la page : flash puis retour à l'ambiance d'orage."""
    spec = ETAT["derniere_spec"]
    if not spec:
        return
    motif = random.choice(MOTIFS_ECLAIR)
    prog = Programme({"mode": "eclair", "motif": motif, "retour": spec}, time.time(), random.randrange(1 << 30))
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
        if chemin == "/api/sons":  # fichiers audio présents dans sounds/ (et sounds/lib, sounds/voix)
            dossier = os.path.join(ICI, "sounds")
            noms = []
            for racine, _, fichiers in os.walk(dossier):
                for f in fichiers:
                    if os.path.splitext(f)[1].lower() in TYPES_AUDIO:
                        rel = os.path.relpath(os.path.join(racine, f), ICI).replace(os.sep, "/")
                        noms.append(rel)
            return self.envoyer(200, sorted(noms))
        if chemin in FICHIERS_AUTORISES:
            nom, type_ = FICHIERS_AUTORISES[chemin]
            with open(os.path.join(ICI, nom), "rb") as f:
                return self.envoyer(200, f.read(), type_)
        if chemin.startswith("/sounds/"):
            from urllib.parse import unquote
            dossier = os.path.realpath(os.path.join(ICI, "sounds"))
            fichier = os.path.realpath(os.path.join(ICI, unquote(chemin).lstrip("/")))
            ext = os.path.splitext(fichier)[1].lower()
            if fichier.startswith(dossier + os.sep) and ext in TYPES_AUDIO and os.path.isfile(fichier):
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
        if chemin == "/api/eclair":
            eclair()
            return self.envoyer(200, {"ok": True})
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
    nom_local = socket.gethostname().split(".")[0]
    if nom_local and sys.platform == "darwin":
        print(f"    Adresse fixe     : http://{nom_local}.local:{PORT}   (à mettre en favori sur l'iPhone)")
    print(f"    Ampoules         : {len(AMPOULES)} {'(SIMULATION)' if SIMULATION else ''}")
    print("    Ctrl+C pour arrêter.")
    print()
    if os.environ.get("OUVRIR_NAVIGATEUR"):  # lanceur Mac : ouvre le pad une fois prêt
        import webbrowser
        threading.Timer(0.5, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nAu revoir 🌙")
        sys.exit(0)
