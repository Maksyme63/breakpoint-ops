#!/bin/bash
# Double-clic sur ce fichier (Mac) pour lancer le Pad Loup-Garou.
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python n'est pas installé : télécharge-le sur https://www.python.org/downloads/"
  read -p "Appuie sur Entrée pour fermer."
  exit 1
fi
python3 -m pip install -q --user -r requirements.txt 2>/dev/null || python3 -m pip install -q -r requirements.txt
(sleep 3; open "http://localhost:8000") &
python3 server.py
