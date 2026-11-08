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
UA = {"User-Agent": "PadLoupGarou/1.0 (usage personnel; script de telechargement de sons libres)"}

# nom du son -> (recherches, durée min, durée max en secondes)
SONS = {
    "loups":       (["wolf howl", "wolves howling", "gray wolf howling"], 3, 120),
    "meute":       (["wolves howling chorus", "wolf pack howling", "wolves howling"], 10, 300),
    "attaque":     (["wolf growl", "dog growling snarling", "dog snarl"], 2, 30),
    "hibou":       (["tawny owl", "owl hoot", "eagle owl call"], 2, 60),
    "grillons":    (["crickets night", "cricket chirping", "field cricket"], 15, 600),
    "vent":        (["wind howling", "strong wind", "wind sound"], 15, 600),
    "pluie":       (["rain sound", "rain falling", "heavy rain"], 20, 900),
    "tonnerre":    (["thunder", "thunderclap", "thunder rumble"], 3, 40),
    "glas":        (["church bell toll", "church bell ringing", "bell tolling"], 4, 90),
    "coq":         (["rooster crowing", "rooster crow", "cockerel"], 1, 20),
    "oiseaux":     (["dawn chorus", "birdsong morning", "bird song forest"], 20, 900),
    "feu":         (["fire crackling", "campfire crackling", "fireplace"], 15, 900),
    "foule":       (["crowd murmur", "crowd talking", "people chatter"], 15, 900),
    "medieval":    (["estampie", "saltarello medieval", "medieval dance music", "medieval music"], 60, 1200),
    "corbeau":     (["crow caw", "raven call", "common raven"], 1, 40),
    "chaudron":    (["boiling water bubbling", "bubbling water", "boiling"], 10, 600),
    "coeur":       (["heartbeat", "heart beat sound"], 5, 300),
    "tambour":     (["war drum", "drum roll", "timpani roll"], 5, 120),
    "harpe":       (["harp glissando", "harp arpeggio", "celtic harp"], 3, 300),
    "flute":       (["flute melody", "recorder medieval", "pan flute"], 10, 400),
    "coup_de_feu": (["musket shot", "gunshot", "rifle shot"], 0.3, 10),
    "fanfare":     (["fanfare trumpet", "trumpet fanfare", "herald trumpets"], 2, 60),
    "grognement":  (["bear growl", "brown bear growling", "bear roar"], 1, 40),
    "marteau":     (["gavel", "gavel bang", "wood knock"], 0.3, 15),
}
LICENCES_OK = re.compile(r"(public domain|^pd|cc0|cc[- ]by(?![- ]?nc)(?![- ]?nd))", re.I)
FORMATS_OK = ("audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac", "audio/mp4")


def appel(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30, context=CONTEXTE_SSL) as r:
        return json.load(r)


def candidats(nom):
    recherches, dmin, dmax = SONS[nom]
    vus, liste = set(), []
    for q in recherches:
        try:
            r = appel({"action": "query", "generator": "search", "gsrsearch": f"{q} filetype:audio",
                       "gsrnamespace": 6, "gsrlimit": 15, "prop": "videoinfo",
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
            licence = (meta.get("LicenseShortName") or {}).get("value", "")
            duree = float(vi.get("duration") or 0)
            if not LICENCES_OK.search(licence) or not (dmin <= duree <= dmax):
                continue
            # fichier lisible par Safari : l'original s'il est en mp3/wav/flac, sinon la version mp3
            src = vi["url"] if vi.get("mime") in FORMATS_OK else None
            for d in vi.get("derivatives") or []:
                if not src and "audio/mpeg" in d.get("type", ""):
                    src = d["src"]
            if not src:
                continue
            auteur = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "inconnu")).strip()
            liste.append({"titre": p["title"], "url": src, "licence": licence, "auteur": auteur,
                          "page": vi.get("descriptionurl", ""), "duree": duree})
    return liste


def telecharger(nom, rang=1):
    print(f"🔎 {nom}…")
    liste = candidats(nom)
    if len(liste) < rang:
        print(f"   ❌ rien trouvé (le son synthétisé sera utilisé)")
        return None
    c = liste[rang - 1]
    ext = os.path.splitext(urllib.parse.urlparse(c["url"]).path)[1].lower() or ".mp3"
    for vieux in os.listdir(DOSSIER):
        if os.path.splitext(vieux)[0] == nom:
            os.remove(os.path.join(DOSSIER, vieux))
    chemin = os.path.join(DOSSIER, nom + ext)
    req = urllib.request.Request(c["url"], headers=UA)
    with urllib.request.urlopen(req, timeout=120, context=CONTEXTE_SSL) as r, open(chemin, "wb") as f:
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
