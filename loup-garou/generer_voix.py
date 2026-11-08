#!/usr/bin/env python3
"""
Enregistre la voix du narrateur (Mac uniquement) avec les voix françaises de macOS.

    python3 generer_voix.py              -> choisit la meilleure voix française installée
    python3 generer_voix.py --liste      -> affiche les voix françaises disponibles
    python3 generer_voix.py --voix "Thomas (Premium)"

Les fichiers sont créés dans sounds/voix/ (ex. loups-reveil.m4a). Le pad les joue
automatiquement, avec un léger écho de grande salle. Tu peux aussi remplacer
n'importe lequel par ton propre enregistrement (même nom, en .m4a ou .mp3).

Pour une voix bien plus naturelle : Réglages Système > Accessibilité > Contenu énoncé >
Voix du système > Gérer les voix… > Français > coche « Thomas (Premium) » ou
« Audrey (Premium) », puis relance ce programme.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

ICI = os.path.dirname(os.path.abspath(__file__))
DOSSIER = os.path.join(ICI, "sounds", "voix")


def voix_francaises():
    try:
        sortie = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        sys.exit("La commande « say » est introuvable : ce programme fonctionne uniquement sur Mac.")
    voix = []
    for ligne in sortie.splitlines():
        m = re.match(r"^(.+?)\s{2,}(fr_[A-Z]{2})\s", ligne)
        if m:
            voix.append((m.group(1).strip(), m.group(2)))
    return voix


def meilleure(voix):
    def score(v):
        nom, langue = v
        s = 0
        if re.search(r"premium|enhanced|améliorée|amelioree", nom, re.I):
            s += 10
        if re.search(r"thomas|audrey|aurélie|aurelie|daniel|amélie|amelie", nom, re.I):
            s += 3
        if langue == "fr_FR":
            s += 2
        return s
    return max(voix, key=score) if voix else None


def preparer(texte):
    # Pauses dramatiques sur les points de suspension et les fins de phrase
    texte = texte.replace("…", ". [[slnc 450]] ")
    texte = re.sub(r"([.!?])\s", r"\1 [[slnc 300]] ", texte)
    return texte


def main():
    args = sys.argv[1:]
    voix = voix_francaises()
    if "--liste" in args:
        for nom, langue in voix:
            print(f"{nom}  ({langue})")
        return
    if "--voix" in args:
        nom = args[args.index("--voix") + 1]
    else:
        choix = meilleure(voix)
        if not choix:
            sys.exit("Aucune voix française installée (Réglages Système > Accessibilité > Contenu énoncé).")
        nom = choix[0]
    print(f"🎙️  Voix du narrateur : {nom}")
    if not re.search(r"premium|enhanced|améliorée", nom, re.I):
        print("   Astuce : installe « Thomas (Premium) » pour une voix bien plus naturelle (voir l'aide en haut du fichier).")

    with open(os.path.join(ICI, "scenes.json"), encoding="utf-8") as f:
        donnees = json.load(f)
    os.makedirs(DOSSIER, exist_ok=True)
    total = 0
    for scene in donnees.get("roles", []) + donnees.get("scenes", []):
        for cle, texte in (scene.get("voix") or {}).items():
            sortie = os.path.join(DOSSIER, f"{scene['id']}-{cle}.m4a")
            with tempfile.TemporaryDirectory() as tmp:
                aiff = os.path.join(tmp, "voix.aiff")
                # débit lent et posé, façon conteur
                subprocess.run(["say", "-v", nom, "-r", "150", "-o", aiff, preparer(texte)], check=True)
                subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "128000", aiff, sortie], check=True)
            total += 1
            print(f"   ✅ {scene['id']}-{cle}")
    print(f"\n{total} répliques enregistrées dans sounds/voix/. Relance le pad pour les entendre.")


if __name__ == "__main__":
    main()
