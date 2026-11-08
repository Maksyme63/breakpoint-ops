#!/usr/bin/env python3
"""
Narrateur avec une voix IA réaliste (ElevenLabs), bien plus naturelle que les voix du Mac.

1. Crée un compte gratuit sur https://elevenlabs.io (l'offre gratuite suffit : tout le
   texte du narrateur fait environ 4 400 caractères).
2. Récupère ta clé : icône de profil > « API Keys » > « Create API Key ».
3. Lance :
       python3 generer_voix_ia.py
   La clé est demandée sans s'afficher et n'est enregistrée nulle part.

Options :
    python3 generer_voix_ia.py --voix-liste        -> les voix de ton compte
    python3 generer_voix_ia.py --voix <ID>          -> choisir une autre voix
    python3 generer_voix_ia.py --seulement loups    -> refaire seulement certaines répliques
    python3 generer_voix_ia.py --tout               -> tout régénérer (sinon reprend où il s'était arrêté)

Les fichiers sont écrits dans sounds/voix/ (ex. loups-reveil.mp3) et remplacent ceux du Mac.
"""
import getpass
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
DOSSIER = os.path.join(ICI, "sounds", "voix")
API = "https://api.elevenlabs.io/v1"
# « George » : voix masculine chaude de conteur, parle très bien français avec le modèle multilingue
VOIX_PAR_DEFAUT = "JBFqnCBsd6RMkjVDRZzb"

try:
    import certifi
    SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL = ssl.create_default_context()


def requete(chemin, cle, corps=None):
    req = urllib.request.Request(
        API + chemin,
        data=json.dumps(corps).encode() if corps is not None else None,
        headers={"xi-api-key": cle, "Content-Type": "application/json", "Accept": "audio/mpeg, application/json"},
        method="POST" if corps is not None else "GET")
    return urllib.request.urlopen(req, timeout=120, context=SSL)


def main():
    args = sys.argv[1:]
    cle = os.environ.get("ELEVENLABS_API_KEY") or getpass.getpass("Clé API ElevenLabs (invisible pendant la saisie) : ").strip()
    if not cle:
        sys.exit("Pas de clé : rien à faire.")

    if "--voix-liste" in args:
        with requete("/voices", cle) as r:
            for v in json.load(r).get("voices", []):
                print(f"{v['voice_id']}  {v.get('name')}  ({(v.get('labels') or {}).get('description', '')})")
        return

    voix = args[args.index("--voix") + 1] if "--voix" in args else VOIX_PAR_DEFAUT
    seulement = set(args[args.index("--seulement") + 1:]) if "--seulement" in args else None
    # Par défaut on reprend là où on s'était arrêté ; --tout pour tout régénérer
    tout = "--tout" in args or bool(seulement)

    with open(os.path.join(ICI, "scenes.json"), encoding="utf-8") as f:
        donnees = json.load(f)
    os.makedirs(DOSSIER, exist_ok=True)

    total = 0
    for scene in donnees.get("roles", []) + donnees.get("scenes", []):
        if seulement and scene["id"] not in seulement:
            continue
        for cle_texte, texte in (scene.get("voix") or {}).items():
            nom = f"{scene['id']}-{cle_texte}"
            if not tout and os.path.exists(os.path.join(DOSSIER, nom + ".mp3")):
                continue
            corps = {
                "text": texte,
                "model_id": "eleven_multilingual_v2",
                "language_code": "fr",
                # stabilité moyenne = voix expressive de conteur, sans dérapages
                "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True},
            }
            audio = None
            for essai in range(5):
                try:
                    with requete(f"/text-to-speech/{voix}?output_format=mp3_44100_128", cle, corps) as r:
                        audio = r.read()
                    break
                except urllib.error.HTTPError as e:
                    detail = e.read().decode("utf-8", "replace")[:300]
                    if e.code == 429 and essai < 2:
                        time.sleep(15)
                        continue
                    if e.code == 401:
                        sys.exit("Clé refusée : vérifie la clé API copiée depuis ElevenLabs.")
                    sys.exit(f"Erreur ElevenLabs ({e.code}) : {detail}")
                except (urllib.error.URLError, OSError) as e:
                    # coupure réseau passagère : on patiente et on réessaie
                    if essai == 4:
                        sys.exit(f"Connexion impossible ({e}). Relance le programme : il reprendra où il s'est arrêté.")
                    print(f"   (connexion interrompue, nouvel essai dans 5 s…)")
                    time.sleep(5)
            # l'ancienne version du Mac (.m4a) est retirée pour que le pad prenne la nouvelle
            for ext in (".m4a", ".mp3", ".wav"):
                vieux = os.path.join(DOSSIER, nom + ext)
                if os.path.exists(vieux):
                    os.remove(vieux)
            with open(os.path.join(DOSSIER, nom + ".mp3"), "wb") as f:
                f.write(audio)
            total += 1
            print(f"   ✅ {nom}")
            time.sleep(0.5)
    print(f"\n{total} répliques générées dans sounds/voix/. Relance le pad pour les entendre.")


if __name__ == "__main__":
    main()
