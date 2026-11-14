# Port Mirage — jeu Roblox en monde ouvert

Un jeu d'action en ville ouverte, original, dans le genre « bac à sable urbain » :
on conduit, on livre des colis, on braque des supérettes et on sème la police.
Toute la ville est construite par script, sans aucun modèle externe.

## Lancer le jeu

1. Installe [Roblox Studio](https://create.roblox.com/) (gratuit).
2. Ouvre le fichier **`PortMirage.rbxlx`** avec Roblox Studio (double-clic, ou *Fichier > Ouvrir depuis un fichier*).
3. Appuie sur **Jouer** (F5).
4. Pour le mettre en ligne : *Fichier > Publier sur Roblox*.

Pour que l'argent et les voitures soient sauvegardés entre deux parties, publie le jeu puis active
*Paramètres du jeu > Sécurité > Activer l'accès de Studio aux services API*.

## Ce qu'on peut faire

| Activité | Comment |
| --- | --- |
| Conduire | Approche d'une voiture garée et appuie sur **E** ; **ZQSD / flèches** pour rouler, **Espace** pour descendre |
| Livraisons | Tableau « LIVRAISONS » chez Mirage Express, puis suis la balise jaune (bonus si tu es rapide) |
| Braquages | Maintiens **E** sur la caisse verte d'une supérette : gros gain, mais 2 étoiles |
| Police | Les policiers te poursuivent ; s'ils te touchent à pied ou à l'arrêt, amende et retour au poste. Éloigne-toi pour perdre tes étoiles |
| Acheter une voiture | Chez Mirage Motors, puis bouton **Garage** à gauche de l'écran pour la faire venir |
| Billets | Des billets verts sont cachés dans la ville et sur la plage |

## Modifier le jeu

Presque tous les réglages (prix, vitesses, récompenses, taille de la ville, durée du jour)
sont dans `src/shared/Config.luau` — dans Studio : `ReplicatedStorage > Shared > Config`.

| Fichier | Rôle |
| --- | --- |
| `src/server/Main.server.luau` | Démarrage, ambiance, concessionnaire, braquages, billets |
| `src/server/CityBuilder.luau` | Construction de la ville |
| `src/server/VehicleService.luau` | Voitures et conduite |
| `src/server/WantedService.luau` | Étoiles et policiers |
| `src/server/MissionService.luau` | Livraisons |
| `src/server/EconomyService.luau` | Argent et sauvegarde |
| `src/client/Hud.client.luau` | Interface du joueur |

Après une modification des fichiers `src/`, régénère le fichier Studio avec
`python3 tools/build_place.py` (ou utilise [Rojo](https://rojo.space) avec `default.project.json`).
