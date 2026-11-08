#!/usr/bin/env python3
"""
Télécharge de vrais enregistrements (loups, hibou, cloches, orage, musique médiévale…)
depuis Wikimedia Commons, uniquement sous licences libres (domaine public, CC0, CC BY,
CC BY-SA). Les auteurs sont notés dans sounds/lib/CREDITS.txt.

    python3 telecharger_sons.py                 -> télécharge tout ce qui manque
    python3 telecharger_sons.py loups           -> (re)télécharge seulement « loups »
    python3 telecharger_sons.py loups 2         -> essaie le 2e résultat (si le 1er ne plaît pas)
    python3 telecharger_sons.py --liste         -> affiche les sons gérés

Le pad utilise automatiquement chaque fichier de sounds/lib/ à la place du son synthétisé
du même nom. Tu peux aussi y déposer tes propres fichiers (ex. sounds/lib/medieval.mp3).
"""
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request

# Le Python de python.org sur Mac n'a pas de certificats : on prend ceux de « certifi »
try:
    import certifi
    CONTEXTE_SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CONTEXTE_SSL = ssl.create_default_context()

ICI = os.path.dirname(os.path.abspath(__file__))
DOSSIER = os.path.join(ICI, "sounds", "lib")
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "PadLoupGarou/1.1 (https://github.com/Maksyme63/breakpoint-ops; usage personnel) python-urllib"}

# nom du son -> (recherches, durée min, durée max en secondes)
SONS = {
    "loups":       (["wolf howl", "wolves howling", "howling wolf", "canis lupus howl", "loup hurlement"], 2, 300),
    "meute":       (["wolves howling", "wolf pack", "wolf chorus", "howling wolves"], 5, 600),
    "attaque":     (["wolf growl", "dog growling", "growl", "snarl", "dog barking aggressive"], 1, 60),
    "hibou":       (["owl", "tawny owl", "owl hoot", "strix aluco", "chouette"], 1, 120),
    "grillons":    (["crickets", "cricket", "night insects", "grillon", "cicada night"], 5, 900),
    "vent":        (["wind", "wind howling", "storm wind", "vent"], 5, 900),
    "pluie":       (["rain", "rain falling", "rainfall", "pluie"], 5, 1200),
    "tonnerre":    (["thunder", "thunderstorm", "thunderclap", "orage tonnerre"], 2, 120),
    "glas":        (["church bell", "bell tolling", "bells ringing", "cloche église", "glas"], 2, 180),
    "coq":         (["rooster", "rooster crowing", "cock crow", "gallus gallus", "coq"], 1, 40),
    "oiseaux":     (["birdsong", "dawn chorus", "bird song", "birds singing", "chant oiseaux"], 5, 1200),
    "feu":         (["fire crackling", "campfire", "crackling fire", "fireplace", "feu de bois"], 5, 1200),
    "foule":       (["crowd", "crowd noise", "people talking", "murmur", "market crowd"], 5, 1200),
    "medieval":    (["estampie", "saltarello", "medieval music", "medieval dance", "lute music", "musique médiévale"], 30, 1800),
    "corbeau":     (["crow", "raven", "corvus corax", "corvus corone", "corbeau"], 1, 90),
    "chaudron":    (["bubbling", "boiling water", "bubbles water", "boiling"], 3, 900),
    "harpe":       (["harp", "harp glissando", "celtic harp", "harpe"], 3, 600),
    "flute":       (["flute", "recorder", "pan flute", "tin whistle", "flûte"], 5, 600),
    "coup_de_feu": (["gunshot", "musket", "rifle shot", "shotgun", "gun shot"], 0.2, 20),
    "fanfare":     (["fanfare", "trumpet fanfare", "trumpet", "herald trumpet"], 2, 120),
    "grognement":  (["bear growl", "bear", "ursus arctos", "bear roar", "ours"], 1, 90),
    "marteau":     (["gavel", "knock wood", "knocking", "hammer wood"], 0.2, 30),
}
LICENCES_OK = re.compile(r"(public domain|domaine public|^pd|cc0|cc[- ]?by(?![- ]?nc)(?![- ]?nd)|gfdl|free art|fal)", re.I)
FORMATS_OK = ("audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/flac", "audio/x-flac", "audio/mp4")


def ouvrir(url, timeout=30):
    """Requête polie : une à la fois, avec pause et nouvel essai si Wikimedia demande de ralentir."""
    import time
    import urllib.error
    for essai in range(6):
        time.sleep(3.0)
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout, context=CONTEXTE_SSL)
        except urllib.error.HTTPError as e:
            if e.code != 429 or essai == 5:
                raise
            attente = max(int(e.headers.get("Retry-After") or 0), 60 * (essai + 1))
            print(f"   (Wikimedia demande de ralentir : pause de {attente} s…)")
            time.sleep(attente)


def appel(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    with ouvrir(url) as r:
        return json.load(r)


def candidats(nom, rang_voulu=1):
    recherches, dmin, dmax = SONS[nom]
    vus, liste = set(), []
    ecartes = {"licence": 0, "durée": 0, "format": 0}
    for q in recherches:
        if len(liste) >= rang_voulu:
            break  # assez de choix : inutile d'interroger davantage Wikimedia
        try:
            r = appel({"action": "query", "generator": "search", "gsrsearch": f"{q} filetype:audio",
                       "gsrnamespace": 6, "gsrlimit": 40, "prop": "videoinfo",
                       "viprop": "url|size|mime|extmetadata|derivatives"})
        except Exception as e:
            print(f"   (recherche « {q} » impossible : {e})")
            continue
        pages = sorted((r.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
        for p in pages:
            if p["title"] in vus or not p.get("videoinfo"):
                continue
            vus.add(p["title"])
            vi = p["videoinfo"][0]
            meta = vi.get("extmetadata") or {}
            licence = (meta.get("LicenseShortName") or {}).get("value", "") or (meta.get("License") or {}).get("value", "")
            duree = float(vi.get("duration") or 0)
            description = re.sub(r"<[^>]+>", "", (meta.get("ImageDescription") or {}).get("value", "")).lower()
            if re.search(r"voice|spoken|speech|narrat|comment|lecture|talk|announc|interview|explain", description + " " + p["title"].lower()):
                ecartes.setdefault("voix parlée", 0)
                ecartes["voix parlée"] += 1
                continue
            if not LICENCES_OK.search(licence):
                ecartes["licence"] += 1
                continue
            if duree and not (dmin <= duree <= dmax):
                ecartes["durée"] += 1
                continue
            # fichier lisible par Safari : l'original s'il est en mp3/wav/flac, sinon une version mp3
            src = vi["url"] if (vi.get("mime") or "").split(";")[0] in FORMATS_OK else None
            for d in vi.get("derivatives") or []:
                t = d.get("type", "")
                if not src and ("mpeg" in t or "mp3" in t or d.get("src", "").endswith(".mp3")):
                    src = d["src"]
            if not src:
                ecartes["format"] += 1
                continue
            auteur = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "inconnu")).strip()
            liste.append({"titre": p["title"], "url": src, "licence": licence, "auteur": auteur,
                          "page": vi.get("descriptionurl", ""), "duree": duree})
    if not liste:
        print(f"   ({len(vus)} fichiers vus, écartés : {ecartes})")
    return liste


def telecharger(nom, rang=1):
    print(f"🔎 {nom}…")
    liste = candidats(nom, rang)
    if len(liste) < rang:
        print(f"   ❌ rien trouvé (le son synthétisé sera utilisé)")
        return None
    c = liste[rang - 1]
    ext = os.path.splitext(urllib.parse.urlparse(c["url"]).path)[1].lower() or ".mp3"
    for vieux in os.listdir(DOSSIER):
        if os.path.splitext(vieux)[0] == nom:
            os.remove(os.path.join(DOSSIER, vieux))
    chemin = os.path.join(DOSSIER, nom + ext)
    with ouvrir(c["url"], timeout=120) as r, open(chemin, "wb") as f:
        f.write(r.read())
    print(f"   ✅ {c['titre']} ({round(c['duree'])} s, {c['licence']})")
    return c


def main():
    args = sys.argv[1:]
    if "--liste" in args:
        print("\n".join(SONS))
        return
    os.makedirs(DOSSIER, exist_ok=True)
    credits_path = os.path.join(DOSSIER, "credits.json")
    credits = {}
    if os.path.exists(credits_path):
        with open(credits_path, encoding="utf-8") as f:
            credits = json.load(f)

    if args and args[0] in SONS:
        a_faire = [(args[0], int(args[1]) if len(args) > 1 else 1)]
    else:
        existants = {os.path.splitext(f)[0] for f in os.listdir(DOSSIER)}
        a_faire = [(n, 1) for n in SONS if n not in existants]
    for nom, rang in a_faire:
        try:
            c = telecharger(nom, rang)
            if c:
                credits[nom] = c
        except Exception as e:
            print(f"   ❌ échec : {e}")

    with open(credits_path, "w", encoding="utf-8") as f:
        json.dump(credits, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DOSSIER, "CREDITS.txt"), "w", encoding="utf-8") as f:
        f.write("Enregistrements issus de Wikimedia Commons (licences libres)\n\n")
        for nom, c in sorted(credits.items()):
            f.write(f"{nom}: « {c['titre']} » par {c['auteur']} — {c['licence']} — {c['page']}\n")
    print("\nTerminé. Relance le pad pour entendre les vrais sons. Crédits : sounds/lib/CREDITS.txt")
    print("Un son ne te plaît pas ? Essaie le suivant : python3 telecharger_sons.py <nom> 2")


if __name__ == "__main__":
    main()
