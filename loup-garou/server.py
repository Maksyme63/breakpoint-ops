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
    "/ecran": ("ecran.html", "text/html; charset=utf-8"),          # page pour la TV / le projecteur
    "/ecran.html": ("ecran.html", "text/html; charset=utf-8"),
}
TYPES_AUDIO = {".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
               ".aac": "audio/aac", ".flac": "audio/flac"}
TYPES_VIDEO = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4"}


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

# Place de chaque ampoule dans la pièce (positions.json) : sert aux effets « dans l'espace »
def _normaliser(nom):
    return " ".join((nom or "").lower().split())

POSITIONS = {_normaliser(k): v for k, v in (charger_json("positions.json", {}) or {}).items() if not k.startswith("_")}
LAMPES = ("canape_g", "tv_g", "tv_d", "canape_d")  # les 4 lampes autour de la table, dans le sens du tour


def position_de(nom):
    return POSITIONS.get(_normaliser(nom))


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

    def scene_native(self, unites, vitesse, saut=False):
        self._dernier = 0
        self._log(f"dégradé intégré ({len(unites)} couleurs, vitesse {vitesse})")
        return True


ECART_MIN = 0.3          # secondes minimum entre deux ordres à une même ampoule
FENETRE = 10.0           # fenêtre de comptage (s)
MAX_PAR_FENETRE = 18     # ordres maximum par ampoule dans cette fenêtre


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
        self.historique = []  # instants des derniers ordres (protection contre la saturation)
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
            if cle is not None and cle == self.derniere_cmd and now - self.dernier_envoi < 20:
                return
            # Protection permanente : jamais moins de 0,3 s entre deux ordres, et au plus
            # 18 ordres par tranche de 10 s pour une même ampoule (au-delà elles décrochent)
            ecart = ECART_MIN if rapide else max(ECART_MIN, float(CONFIG["intervalle_effets"]))
            attente = ecart - (now - self.dernier_envoi)
            if attente > 0:
                time.sleep(attente)
            self.historique = [t for t in self.historique if time.time() - t < FENETRE]
            if len(self.historique) >= MAX_PAR_FENETRE:
                time.sleep(max(0.0, self.historique[0] + FENETRE - time.time()))
            self.historique.append(time.time())
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

    def _etat_complet(self, etape):
        """Ordre complet (allumage + mode + couleur/intensité) pour une étape.
        On n'utilise pas la mémoire interne de la bibliothèque, qui peut se tromper
        sur l'état réel de la lampe (lampe restée éteinte ou bloquée sur une couleur)."""
        ds = self.dev.dpset
        sw = ds.get("switch")
        if not sw:
            return None
        if etape == "eteint" or etape.get("eteint"):
            return {sw: False}
        hexf = ds.get("value_hexformat") or "hsv16"
        vmax = ds.get("value_max") or -1
        if vmax <= 0:
            vmax = 1000 if hexf == "hsv16" else 255
        vmin = ds.get("value_min") or -1
        if vmin < 0:
            vmin = 10 if vmax >= 1000 else 25
        lum = max(1, min(100, etape.get("lum", 100)))
        valeurs = {sw: True}
        if etape.get("blanc") or not ds.get("colour"):
            if ds.get("mode"):
                valeurs[ds["mode"]] = "white"
            if ds.get("brightness"):
                valeurs[ds["brightness"]] = int(vmin + (vmax - vmin) * lum / 100)
            if ds.get("colourtemp"):
                valeurs[ds["colourtemp"]] = int(vmax * max(0, min(100, etape.get("temp", 50))) / 100)
        else:
            r, g, b = [max(0, min(255, c)) / 255.0 for c in etape["couleur"]]
            h, s, _ = colorsys.rgb_to_hsv(r, g, b)
            if ds.get("mode"):
                valeurs[ds["mode"]] = "colour"
            valeurs[ds["colour"]] = self.dev.hsv_to_hexvalue(h, s, max(0.01, min(1.0, lum / 100.0)), hexf)
        return valeurs

    def couleur(self, rgb, lum, rapide=False):
        self.derniere = (list(rgb), lum)  # pour la respiration vers le noir entre deux boutons
        r, g, b = [max(0, min(255, c)) / 255.0 for c in rgb]
        h, s, _ = colorsys.rgb_to_hsv(r, g, b)
        h, s = round(h, 3), round(s, 2)
        v = round(max(0.01, min(1.0, lum / 100.0)), 2)
        etat = self._etat_complet({"couleur": rgb, "lum": lum}) if self.dev else None
        if etat:
            self._envoyer(("c", h, s, v), self.dev_appel("set_multiple_values"), etat, rapide=rapide)
        else:
            self._envoyer(("c", h, s, v), self.dev_appel("set_hsv"), h, s, v, rapide=rapide)

    def blanc(self, lum, temp):
        self.derniere = ([255, 214, 170], lum)
        lum = round(max(1, min(100, lum)))
        temp = round(max(0, min(100, temp)))
        etat = self._etat_complet({"blanc": True, "lum": lum, "temp": temp}) if self.dev else None
        if etat:
            self._envoyer(("b", lum, temp), self.dev_appel("set_multiple_values"), etat)
        else:
            self._envoyer(("b", lum, temp), self.dev_appel("set_white_percentage"), lum, temp)

    def eteindre(self):
        self.derniere = None
        etat = self._etat_complet("eteint") if self.dev else None
        if etat:
            self._envoyer(("off",), self.dev_appel("set_multiple_values"), etat)
        else:
            self._envoyer(("off",), self.dev_appel("turn_off"))

    def instantane(self, etape):
        """Flash : envoyé immédiatement (écart minimal), en attendant la confirmation de la lampe
        pour que ses réponses ne se mélangent pas avec les ordres suivants."""
        if not self.ok:
            return
        etat = self._etat_complet(etape) if self.dev else None
        if etat:
            self._envoyer(None, self.dev_appel("set_multiple_values"), etat, rapide=True)
        elif etape == "eteint" or etape.get("eteint"):
            self._envoyer(None, self.dev_appel("turn_off"), rapide=True)

    def scene_native(self, unites, vitesse, saut=False):
        """Dégradé fait par l'ampoule elle-même (mode « scène ») : une seule commande, parfaitement
        fluide. Renvoie False si l'ampoule ne sait pas le faire (on garde alors l'ancien effet)."""
        if not self.dev:
            return False
        ds = self.dev.dpset
        codes = {v.get("code"): str(dp) for dp, v in (self.info.get("mapping") or {}).items() if isinstance(v, dict)}
        dp_scene = codes.get("scene_data_v2") or codes.get("scene_data") or (None if codes else ds.get("scene"))
        if not (dp_scene and ds.get("switch") and ds.get("mode")) or (ds.get("value_hexformat") or "hsv16") != "hsv16":
            return False
        texte = "05"
        for rgb, lum in unites[:8]:
            r, g, b = [max(0, min(255, c)) / 255.0 for c in rgb]
            h, s, _ = colorsys.rgb_to_hsv(r, g, b)
            v = int(max(10, min(1000, lum * 10)))
            texte += f"{vitesse:02x}{vitesse:02x}{'01' if saut else '02'}{int(round(h * 360)) % 360:04x}{int(round(s * 1000)):04x}{v:04x}00000000"
        # l'ampoule repasse d'abord par une couleur normale, sinon elle garde parfois l'ancien dégradé
        couleur = self._etat_complet({"couleur": unites[0][0], "lum": unites[0][1]})
        if couleur:
            self._envoyer(None, self.dev_appel("set_multiple_values"), couleur)
        etat = {ds["switch"]: True, ds["mode"]: "scene", dp_scene: texte}
        self._envoyer(None, self.dev_appel("set_multiple_values"), etat)
        plus_vive = max(unites, key=lambda u: u[1])  # la couleur la plus lumineuse du dégradé
        self.derniere = (list(plus_vive[0]), plus_vive[1])
        return True

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
        self.position = position_de(ampoule.nom)
        # rang dans le tour de la table (sens des aiguilles d'une montre) pour les chenillards
        self.rang = LAMPES.index(self.position) if self.position in LAMPES else \
            (len(LAMPES) if self.position == "cuisine" else index)
        self.changement = threading.Event()

    def jouer(self, programme):
        self.programme = programme
        self.changement.set()

    # -- utilitaires --
    def attendre(self, duree):
        """Dort `duree` secondes. Renvoie True si une nouvelle scène est arrivée."""
        return self.changement.wait(max(0.0, duree))

    def lum(self, valeur):
        if self.position == "cuisine" and getattr(self, "ruban_max", False):
            return 100  # le ruban en hauteur toujours au plus fort, pour bien le voir
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

    def resoudre(self, spec, prog):
        """Choisit l'effet de cette lampe selon sa place dans la pièce."""
        pp = spec.get("par_position")
        if not pp:
            return spec
        hasard = pp.get("au_hasard")  # ex. la place de la victime, tirée au sort à chaque fois
        if hasard:
            places = sorted(p.position for p in PILOTES if p.position in LAMPES)
            choisies = random.Random(prog.graine).sample(places, min(int(hasard.get("nombre", 1)), len(places)))
            if self.position in choisies:
                return hasard["spec"]
        return pp.get(self.position) or pp.get("autres") or {k: v for k, v in spec.items() if k != "par_position"}

    # -- moteur d'effets --
    def executer(self, prog):
        spec = prog.spec
        self.ruban_max = spec.get("mode", "static") not in ("battement", "pulse", "eclair", "off")
        pas = float(CONFIG["intervalle_effets"])

        # Séquence d'intro (flashs, noir…) jouée en même temps sur toutes les ampoules
        t = prog.depart
        for etape in spec.get("intro", []):
            if etape.get("fondu_noir"):
                # Respiration vers le noir, jouée par chaque ampoule elle-même (dégradé intégré, fluide),
                # toutes en même temps, quelle que soit la scène d'avant
                derniere = getattr(self.ampoule, "derniere", None)
                if derniere and self.ampoule.scene_native([derniere] + [(derniere[0], 1)] * 7, VITESSE_FONDU_NOIR):
                    if self.attendre(float(etape["fondu_noir"])):
                        return
                self.appliquer("eteint")
                self.depuis_noir = True  # la scène suivante remontera en fondu
            elif etape.get("vite"):
                self.depuis_noir = False  # la scène a sa propre entrée (flashs…) : pas de remontée
                self.ampoule.instantane(etape)  # flashs : envoyés sans attendre
            else:
                self.depuis_noir = False
                self.appliquer(etape)
            t += etape.get("duree", 0.2)
            if self.attendre(t - time.time()):
                return

        # Rôle propre à la place de cette lampe (par_position), avec un départ décalé éventuel
        sous = self.resoudre(spec, prog)
        if sous is not spec:
            if self.attendre(float(sous.get("delai", 0))):
                return
            return self.executer(Programme(sous, time.time(), prog.graine))

        mode = spec.get("mode", "static")
        debut = time.time()
        if getattr(self, "depuis_noir", False):
            # Remontée de la respiration, en même temps sur toutes les lampes, vers la couleur de la scène
            self.depuis_noir = False
            palette = spec.get("couleurs") or ([spec["couleur"]] if spec.get("couleur") else [])
            if palette and mode not in ("off", "eclair", "white"):
                c, l = palette[self.index % len(palette)], self.lum(spec.get("lum", 100))
                if self.ampoule.scene_native([(c, 1)] + [(c, l)] * 7, VITESSE_FONDU_NOIR):
                    self.actuel = (list(c), spec.get("lum", 100))
                    if self.attendre(MONTEE_RESPIRATION):
                        return

        if mode == "off":
            self.ampoule.eteindre()
            return
        if mode == "eclair":
            # chaque ampoule part avec un petit décalage : l'éclair semble traverser la pièce
            hasard = random.Random(prog.graine + self.index * 104729)
            if hasard.random() > spec.get("proba", 0.85) and self.index != 0:
                pass  # cette lampe reste dans l'ombre pour cet éclair
            else:
                if self.attendre(0 if spec.get("sans_delai") else hasard.uniform(0, 0.18)):
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
            # "couleurs" : une palette, chaque ampoule prend sa propre teinte
            palette = spec.get("couleurs") or [spec["couleur"]]
            cible = {"couleur": palette[self.index % len(palette)], "lum": spec.get("lum", 100)}
            self.appliquer(cible)
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
                    if spec.get("puis"):
                        return self.executer(Programme(spec["puis"], time.time(), prog.graine))
                    return
                if self.attendre(max(1.0, pas * 2.5)):
                    return

        if mode == "ambiance":
            # Une lampe sur trois reste fixe, une respire lentement, une glisse d'une couleur
            # à l'autre de la palette. Changements rares : l'ampoule fait elle-même un fondu doux.
            palette = spec.get("couleurs") or [spec["couleur"]]
            lum = spec.get("lum", 70)
            i = self.index % len(palette)
            role = self.index % 3 if len(palette) > 1 else (self.index % 2)
            role = {"fixe": 0, "respire": 1, "glisse": 2}.get(spec.get("role"), role)
            # Respiration / glissement : dégradé intégré à l'ampoule si possible (fluide, une seule commande)
            if role in (1, 2):
                if self.attendre(float(spec.get("decalage_depart", 0)) * self.rang):
                    return
                if role == 1:
                    unites = [(palette[i], self.lum(lum)), (palette[i], self.lum(spec.get("bas", max(3, lum * 0.4))))]
                    vitesse = int(spec.get("vitesse", 0x32))
                else:
                    unites = [(palette[(i + k) % len(palette)], self.lum(lum)) for k in range(len(palette))]
                    vitesse = int(spec.get("vitesse", 0x14))
                if self.ampoule.scene_native(unites, vitesse):
                    self.actuel = None
                    while not self.attendre(3600):
                        pass
                    return
            self.appliquer({"couleur": palette[i], "lum": lum})
            haut = True
            while True:
                if role == 0:
                    if self.attendre(3600):
                        return
                elif role == 1:
                    if self.attendre(float(spec.get("respiration", 4.5))):
                        return
                    haut = not haut
                    self.appliquer({"couleur": palette[i], "lum": lum if haut else max(3, lum * 0.4)})
                else:
                    if self.attendre(float(spec.get("derive", 6))):
                        return
                    i = (i + 1) % len(palette)
                    self.appliquer({"couleur": palette[i], "lum": lum})

        if mode == "feu":
            # feu de cheminée : chaque lampe vacille à son rythme, dans des teintes de flammes
            hasard = random.Random(prog.graine + self.index * 7919)
            palette = spec.get("couleurs") or [spec["couleur"]]
            bas, haut = spec.get("min", 35), spec.get("max", 80)
            lum = (bas + haut) / 2
            if spec.get("natif"):
                flammes = [(palette[(self.rang + k) % len(palette)], self.lum(hasard.uniform(bas, haut))) for k in range(8)]
                if self.ampoule.scene_native(flammes, int(spec.get("vitesse", 0x64)), bool(spec.get("saut"))):
                    self.actuel = None
                    while not self.attendre(3600):
                        pass
                    return
            while True:
                lum = max(bas, min(haut, lum * 0.5 + hasard.uniform(bas, haut) * 0.5))
                coul = palette[(self.index + hasard.randrange(len(palette))) % len(palette)] if hasard.random() < 0.3 \
                    else palette[self.index % len(palette)]
                self.ampoule.couleur(coul, self.lum(lum))
                if self.attendre(hasard.uniform(0.45, 0.9)):
                    return

        if mode == "flashs":
            # couleur de fond, avec de temps en temps un flash bref (ex. éclairs blancs sur le ruban)
            hasard = random.Random(prog.graine + self.index * 31)
            fond = {"couleur": spec["couleur"], "lum": spec.get("lum", 90)}
            eclat = spec.get("eclat", {"blanc": True, "lum": 100, "temp": 100})
            self.appliquer(fond)
            while True:
                if self.attendre(hasard.uniform(float(spec.get("min", 2)), float(spec.get("max", 5)))):
                    return
                self.ampoule.instantane(eclat)
                if self.attendre(0.35):
                    return
                self.appliquer(fond)

        if mode == "tour":
            # une lueur passe d'une lampe à l'autre dans le sens des aiguilles d'une montre
            base = {"couleur": spec["couleur"], "lum": spec.get("lum", 30)}
            eclat = spec.get("eclat", {"couleur": [255, 200, 80], "lum": 100})
            pas, duree = float(spec.get("pas", 1.2)), float(spec.get("duree_eclat", 1.0))
            cycle = pas * len(LAMPES)
            self.appliquer(base)
            if self.position not in LAMPES:
                while not self.attendre(3600):
                    pass
                return
            k = int((time.time() - prog.depart) / cycle)
            while True:
                debut_eclat = prog.depart + k * cycle + self.rang * pas
                if self.attendre(debut_eclat - time.time()):
                    return
                self.appliquer(eclat)
                if self.attendre(duree):
                    return
                self.appliquer(base)
                k = max(k + 1, int((time.time() - prog.depart) / cycle))

        if mode == "fondu_natif":
            # vrai fondu sans à-coups, joué par l'ampoule (repli : fondu par étapes)
            etapes = spec["etapes"]
            unites = [((e.get("couleur") or [255, 220, 170]), self.lum(e.get("lum", 100))) for e in etapes]
            unites += [unites[-1]] * max(0, 8 - len(unites))  # la fin tient longtemps
            if self.ampoule.scene_native(unites[:8], int(spec.get("vitesse", 0x14))):
                self.actuel = None
                if self.attendre(float(spec.get("duree", 12))):
                    return
                self.appliquer(etapes[-1])
                return
            return self.executer(Programme(dict(spec, mode="fade"), time.time(), prog.graine))

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
                decalage = float(spec.get("decalage", 0)) * self.rang  # vague d'une lampe à l'autre
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
                i = (int((time.time() - prog.depart) / periode) + int(spec.get("decalage", 0)) * self.rang) % len(couleurs)
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


VITESSE_FONDU_NOIR = 0x55  # vitesse de la respiration intégrée (descente/remontée), plus grand = plus rapide
MONTEE_RESPIRATION = 1.3   # secondes laissées à la remontée avant que la scène prenne la main
NOIR_ENTRE_SCENES = 1.1  # secondes : les lumières descendent lentement au noir, puis la scène remonte avec la vidéo


def lancer_spec(spec, noir_avant=False):
    ETAT["derniere_spec"] = spec  # sans le noir : les éclairs, yeux… reviennent directement à l'ambiance
    if noir_avant:
        spec = dict(spec, intro=[{"fondu_noir": 0.5, "duree": NOIR_ENTRE_SCENES}] + list(spec.get("intro", [])))
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


def pic():
    """Un « glouglou » vient d'être entendu : éclat bref sur les lampes réactives de la scène."""
    spec = ETAT["derniere_spec"]
    reactif = (spec or {}).get("reactif")
    if not reactif or time.time() - ETAT.get("dernier_pic", 0) < float(reactif.get("ecart", 1.0)):
        return
    ETAT["dernier_pic"] = time.time()
    if reactif.get("tour"):
        # au rythme de la musique : la lueur passe à la lampe suivante autour de la table
        lampes = sorted((p for p in PILOTES if p.position in LAMPES), key=lambda p: LAMPES.index(p.position)) or PILOTES
        ETAT["aiguille"] = (ETAT.get("aiguille", -1) + 1) % len(lampes)
        motif = [dict(reactif.get("eclat", {"couleur": [255, 200, 90], "lum": 100}), duree=float(reactif.get("duree", 0.35)))]
        lampes[ETAT["aiguille"]].jouer(Programme({"mode": "eclair", "motif": motif, "retour": spec, "proba": 1.0,
                                                  "sans_delai": True}, time.time(), 0))
        return
    for p in PILOTES:
        if p.position in reactif.get("lampes", []):
            eclat = (reactif.get("eclats") or {}).get(p.position) or reactif.get("eclat", {"couleur": [120, 255, 120], "lum": 100})
            motif = [dict(eclat, duree=0.25)]
            p.jouer(Programme({"mode": "eclair", "motif": motif, "retour": spec, "proba": 1.0},
                              time.time(), random.randrange(1 << 30)))


def oeil():
    """Un hurlement vient d'être joué : une lampe différente s'allume en rouge, comme des yeux."""
    spec = ETAT["derniere_spec"]
    if not spec or not spec.get("yeux"):
        return
    lampes = sorted((p for p in PILOTES if p.position in LAMPES), key=lambda p: LAMPES.index(p.position)) or PILOTES
    ETAT["oeil"] = (ETAT.get("oeil", -1) + 1) % len(lampes)
    motif = [{"couleur": [255, 0, 0], "lum": 100, "duree": 1.6}, {"couleur": [150, 0, 0], "lum": 35, "duree": 0.8}]
    lampes[ETAT["oeil"]].jouer(Programme({"mode": "eclair", "motif": motif, "retour": spec, "proba": 1.0},
                                         time.time(), random.randrange(1 << 30)))


def eclair():
    """Éclair déclenché par le tonnerre de la page : flash puis retour à l'ambiance d'orage."""
    spec = ETAT["derniere_spec"]
    if not spec:
        return
    motif = random.choice(MOTIFS_ECLAIR)
    prog = Programme({"mode": "eclair", "motif": motif, "retour": spec}, time.time(), random.randrange(1 << 30))
    for p in PILOTES:
        p.jouer(prog)


def lancer_scene(scene_id, noir=True):
    scene = scenes().get(scene_id)
    if not scene:
        return False
    ETAT["scene"] = scene_id
    print(f"🎬 Scène : {scene.get('emoji', '')} {scene['nom']}")
    ETAT["spec_scene"] = scene.get("lumiere", {"mode": "off"})
    ETAT["tic_bloque"] = False
    ETAT["aiguille"] = -1
    ETAT["n_scene"] = ETAT.get("n_scene", 0) + 1  # même bouton rappuyé : l'écran le voit aussi
    ETAT["noir"] = noir  # noir seulement quand on appuie sur un bouton, pas dans un enchaînement automatique
    lancer_spec(ETAT["spec_scene"], noir_avant=noir)
    return True


def voix(phase):
    """Le narrateur commence (phase « debut ») ou finit (« fin ») : effet prévu par la scène."""
    spec = ETAT.get("spec_scene") or {}
    cle = "pendant_voix" if phase == "debut" else "apres_voix"
    if phase == "debut" and spec.get("pendant_voix"):
        ETAT["tic_bloque"] = True  # l'aiguille s'arrête quand le narrateur parle
    if spec.get(cle):
        lancer_spec(spec[cle])


def tic():
    """Un tic de l'horloge : la lumière avance d'une lampe, comme une aiguille."""
    spec = ETAT.get("spec_scene") or {}
    aig = spec.get("aiguille")
    if not aig or ETAT.get("tic_bloque"):
        return
    lampes = sorted((p for p in PILOTES if p.position in LAMPES), key=lambda p: LAMPES.index(p.position)) or PILOTES
    ETAT["aiguille"] = (ETAT.get("aiguille", -1) + 1) % len(lampes)
    motif = [dict(aig.get("eclat", {"couleur": [255, 150, 0], "lum": 100}), duree=0.3)]
    lampes[ETAT["aiguille"]].jouer(Programme({"mode": "eclair", "motif": motif, "retour": ETAT["derniere_spec"],
                                              "proba": 1.0, "sans_delai": True}, time.time(), 0))


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

    def envoyer_fichier(self, chemin, type_):
        """Envoie un fichier audio par morceaux (en-tête Range), indispensable à Safari pour lire
        les longues musiques en continu sans tout charger."""
        import re as _re
        taille = os.path.getsize(chemin)
        debut, fin, code = 0, taille - 1, 200
        m = _re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                debut = int(m.group(1))
                fin = min(int(m.group(2)), taille - 1) if m.group(2) else taille - 1
            else:  # « les N derniers octets »
                debut = max(0, taille - int(m.group(2)))
            if debut > fin or debut >= taille:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{taille}")
                self.end_headers()
                return
            code = 206
        longueur = fin - debut + 1
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(longueur))
        if code == 206:
            self.send_header("Content-Range", f"bytes {debut}-{fin}/{taille}")
        # les vidéos de l'écran peuvent rester en mémoire de la TV : elles repartent plus vite
        est_video = os.path.splitext(chemin)[1].lower() in TYPES_VIDEO
        self.send_header("Cache-Control", "max-age=86400" if est_video else "no-store")
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(chemin, "rb") as f:
                f.seek(debut)
                reste = longueur
                while reste > 0:
                    bloc = f.read(min(256 * 1024, reste))
                    if not bloc:
                        break
                    self.wfile.write(bloc)
                    reste -= len(bloc)
        except (BrokenPipeError, ConnectionResetError):
            pass  # le navigateur a arrêté la lecture : normal

    def etat(self):
        return {
            "simulation": SIMULATION,
            "scene": ETAT["scene"],
            "luminosite": ETAT["luminosite"],
            "ampoules": [{"nom": a.nom, "ok": getattr(a, "ok", True)} for a in AMPOULES],
            "evt": ETAT.get("evt", {}),
            "noir": ETAT.get("noir", True), "n_scene": ETAT.get("n_scene", 0),  # l'écran passe par le noir avec les lumières (bouton appuyé)  # compteurs d'événements (hurlement, tic, glouglou…) pour l'écran
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
        if chemin == "/api/videos":  # vidéos de l'écran présentes dans videos/
            dossier = os.path.join(ICI, "videos")
            noms = sorted("videos/" + f for f in os.listdir(dossier)
                          if os.path.splitext(f)[1].lower() in TYPES_VIDEO) if os.path.isdir(dossier) else []
            return self.envoyer(200, noms)
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
                return self.envoyer_fichier(fichier, TYPES_AUDIO[ext])
        if chemin.startswith("/videos/"):
            from urllib.parse import unquote
            dossier = os.path.realpath(os.path.join(ICI, "videos"))
            fichier = os.path.realpath(os.path.join(ICI, unquote(chemin).lstrip("/")))
            ext = os.path.splitext(fichier)[1].lower()
            if fichier.startswith(dossier + os.sep) and ext in TYPES_VIDEO and os.path.isfile(fichier):
                return self.envoyer_fichier(fichier, TYPES_VIDEO[ext])
        self.envoyer(404, {"erreur": "introuvable"})

    def do_POST(self):
        chemin = self.path.split("?")[0]
        longueur = int(self.headers.get("Content-Length") or 0)
        try:
            donnees = json.loads(self.rfile.read(longueur) or b"{}")
        except ValueError:
            donnees = {}

        if chemin.startswith("/api/scene/"):
            ok = lancer_scene(chemin.rsplit("/", 1)[1], noir=not donnees.get("suite"))
            return self.envoyer(200 if ok else 404, self.etat())
        if chemin in ("/api/voix", "/api/tic", "/api/pic", "/api/oeil", "/api/eclair"):
            nom = chemin.rsplit("/", 1)[1]
            if nom == "voix":
                nom = "voix_" + str(donnees.get("phase"))
            compteurs = ETAT.setdefault("evt", {})
            compteurs[nom] = compteurs.get(nom, 0) + 1
        if chemin == "/api/voix":
            voix(donnees.get("phase"))
            return self.envoyer(200, {"ok": True})
        if chemin == "/api/tic":
            tic()
            return self.envoyer(200, {"ok": True})
        if chemin == "/api/pic":
            pic()
            return self.envoyer(200, {"ok": True})
        if chemin == "/api/oeil":
            oeil()
            return self.envoyer(200, {"ok": True})
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
