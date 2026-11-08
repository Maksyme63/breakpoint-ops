# 🐺 Pad Loup-Garou — lumières LSC + sons

Un pad avec de gros boutons (sur téléphone, tablette ou PC) : tu appuies sur
**« Les Loups-Garous se réveillent »** et toutes les ampoules LSC passent en rouge
qui pulse, pendant que les loups hurlent sur une musique angoissante.
Pareil pour la nuit, le jour, la voyante, la sorcière, le vote, le bûcher, etc.

## Pourquoi on ne « clone » pas l'appli LSC

L'appli LSC Smart Connect (Action) est une version rebadgée de l'appli **Tuya**.
Pas besoin de la copier : les ampoules LSC sont des ampoules Tuya qui acceptent des
commandes directement sur le Wi-Fi de la maison, à condition de connaître leur
**clé locale**. Le pad utilise la bibliothèque libre [`tinytuya`](https://github.com/jasonacox/tinytuya)
pour leur parler en direct (rapide, sans passer par Internet pendant la partie).

```
Téléphone (pad)  ──Wi-Fi──▶  PC (server.py)  ──Wi-Fi local──▶  Ampoules LSC
   boutons + sons                tinytuya
```

Le son sort du téléphone/PC qui affiche le pad (branche-le sur une enceinte Bluetooth 🔊).

## Installation (une seule fois, ~20 min)

### 1. Python
Installe Python 3 depuis <https://www.python.org/downloads/> (sous Windows, coche
**« Add Python to PATH »**), puis :

```
pip install tinytuya
```

### 2. Récupérer les clés des ampoules
1. Crée un compte gratuit sur <https://iot.tuya.com> (choisis « Skip » pour les questions).
2. **Cloud → Development → Create Cloud Project**
   - Industry : *Smart Home* · Development method : *Smart Home*
   - Data center : **Central Europe**
   - Accepte les services proposés (notamment *IoT Core*).
3. Dans le projet : **Devices → Link App Account → Add App Account**. Un QR code apparaît.
   - Dans l'appli **LSC Smart Connect** : onglet *Moi / Profil* → icône de scan en haut à droite → scanne le QR code.
   - ⚠️ Si l'appli LSC refuse ou n'a pas de scanner : installe l'appli **Smart Life**
     (gratuite, même système), ajoute-y tes ampoules (elles sont compatibles) et scanne le QR code avec Smart Life.
4. Tes ampoules apparaissent dans l'onglet *Devices*. Note l'**Access ID** et l'**Access Secret**
   (onglet *Overview* du projet).
5. Dans un terminal, **dans ce dossier `loup-garou`** :

   ```
   python -m tinytuya wizard
   ```

   Colle l'Access ID, l'Access Secret, tape un des ID d'ampoule, région **eu**,
   et réponds **Y** quand il propose de scanner le réseau.
   Ça crée `devices.json` (les clés) et `snapshot.json` (les adresses IP).

> Ces fichiers contiennent des clés secrètes : ils sont exclus de git (`.gitignore`), ne les partage pas.
> Si tu ré-appaires une ampoule dans l'appli, sa clé change : relance le wizard.

### 3. Lancer le pad
- Windows : double-clic sur **`lancer.bat`**
- Mac : double-clic sur **`lancer-mac.command`** (la première fois : clic droit → *Ouvrir* → *Ouvrir*)
- Linux : `./lancer.sh`

La console affiche l'adresse à ouvrir sur le téléphone, par ex. `http://192.168.1.20:8000`
(le téléphone doit être sur le **même Wi-Fi**). Ajoute la page à l'écran d'accueil pour l'avoir comme une appli.

Sans `devices.json`, le pad démarre en **mode simulation** : les sons marchent, les
commandes lumière s'affichent dans la console. Parfait pour tester avant la soirée.

## Choisir les personnages

Au lancement, le pad affiche la liste des personnages (Loups-Garous, Voyante, Sorcière,
Cupidon, Petite Fille, Salvateur, Chasseur, Infect Père des Loups, Grand Méchant Loup,
Loup-Garou Blanc, Voleur, Enfant Sauvage, Chien-Loup, Deux Sœurs, Trois Frères, Renard,
Corbeau, Joueur de Flûte, Montreur d'Ours, Ancien, Chevalier, Idiot, Bouc Émissaire,
Juge Bègue, Servante, Ange). Coche ceux de ta partie : le pad n'affiche que leurs boutons,
la nuit dans l'ordre d'appel (« APPEL 1, 2, 3… »). Le choix est mémorisé ; le bouton
👥 Personnages permet de le changer.

## Les scènes

| Groupe | Bouton | Lumière | Son |
|---|---|---|---|
| Préparation | 🏡 Accueil au village | feu de cheminée orange qui vacille | musique médiévale + feu |
| Nuit | 🌙 La nuit tombe | coucher de soleil → bleu nuit | vent, grillons, hibou |
| | 💘 Cupidon | rose qui respire | harpe magique |
| | 🔮 La Voyante | violet mystique | nappe scintillante |
| | 🐺 **Les Loups-Garous** | noir, flash, rouge qui pulse | hurlements + musique de peur + cœur |
| | 🧪 La Sorcière | vert / violet vacillant | chaudron qui bouillonne |
| | 🛡️ Le Salvateur | bleu ciel doux | chœur céleste |
| Jour | 🌅 Le jour se lève | lever de soleil → blanc | coq + oiseaux |
| | 💀 La victime | double flash puis rouge sombre | cri d'horreur + glas |
| | 🗣️ Le débat | blanc chaud | murmures de foule |
| | ⚖️ Le vote | orange qui bat comme un cœur | tambour qui accélère + cœur |
| | 🔥 Le bûcher | flammes | feu, glas, foule |
| | 🏹 Le Chasseur | flash + noir puis orange | coup de fusil |
| Ambiances | ⛈️ Orage | bleu nuit + éclairs synchronisés | pluie, vent, tonnerre |
| | 😨 Suspense | violet très faible | musique de peur + cœur |
| Fin | 🏆 Victoire du village | or / vert / blanc en alternance | fanfare |
| | 🩸 Victoire des loups | stroboscope rouge | meute + peur + cri |
| Contrôle | 💡 Lumière normale / ⏹️ Tout éteindre | | |

Réglages en haut du pad : volume, luminosité générale, couleur libre et bouton 🔇
pour couper le son. Sur PC : raccourcis clavier (chiffres/lettres affichés sur les boutons), **Espace** = silence.

## Personnaliser

- **Tes propres musiques** : dépose `loups.mp3`, `nuit.mp3`… dans `sounds/` (liste dans
  `sounds/LISEZMOI.txt`). Ils remplacent les sons générés pour la scène correspondante.
- **Modifier / ajouter une scène** : édite `scenes.json` (couleurs en `[R, V, B]`,
  modes `static`, `white`, `pulse`, `flicker`, `fade`, `cycle`, `lightning`, `off`,
  avec une `intro` facultative de flashs). Sons disponibles : voir `SONS.xxx` dans `sons.js`.
- **Choisir les ampoules** : copie `config.exemple.json` en `config.json` et liste les noms
  des ampoules à utiliser (sinon toutes les lumières sont prises).

## Dépannage

- **Une ampoule ne répond pas** : vérifie qu'elle est allumée à l'interrupteur, relance
  `python -m tinytuya scan` pour mettre à jour `snapshot.json`, et ferme l'appli LSC sur
  les téléphones (certaines ampoules n'acceptent qu'une connexion locale à la fois).
- **Effets saccadés** : mets `"intervalle_effets": 0.6` dans `config.json` (copie de `config.exemple.json`).
- **Pas de son sur iPhone** : désactive le mode silencieux (bouton sur le côté) et touche
  « Commencer la partie ».
- **Le téléphone n'ouvre pas la page** : même Wi-Fi que le PC ? Autorise Python dans le pare-feu Windows (réseau privé).
