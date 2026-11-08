#!/bin/bash
# Double-clic sur ce fichier (Mac) pour lancer le Pad Loup-Garou.
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python n'est pas installé : télécharge-le sur https://www.python.org/downloads/"
  read -p "Appuie sur Entrée pour fermer."
  exit 1
fi
if ! python3 -c "import tinytuya" 2>/dev/null; then
  echo "Installation de tinytuya (une seule fois)…"
  PIP="python3 -m pip install -q --disable-pip-version-check"
  $PIP --user --no-deps tinytuya 2>/dev/null || $PIP --no-deps tinytuya
  $PIP --user requests colorama pyaes 2>/dev/null || $PIP requests colorama pyaes
  # Chiffrement rapide seulement s'il existe déjà compilé (jamais de compilation Rust)
  $PIP --user --only-binary=:all: cryptography 2>/dev/null || $PIP --only-binary=:all: cryptography 2>/dev/null || true
fi
(sleep 3; open "http://localhost:8000") &
python3 server.py
